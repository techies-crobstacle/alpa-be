const prisma = require("../config/prisma");
const { generateSalesReportCSV } = require("../utils/csvExport");
const { sendSellerApprovedEmail, sendSellerLowStockEmail, sendSellerProductApprovedEmail, sendSellerProductRejectedEmail } = require("../utils/emailService");
const {
  notifySellerApproved,
  notifySellerApprovalRejected,
  notifySellerProductRecommendation,
  notifySellerProductStatusChange,
  notifySellerLowStock
} = require("./notification");
const { backfillOrderNotifications } = require("./orderNotification");
const { getCommissionForSeller } = require("./commission");
const { log: auditLog, extractRequestMeta, AUDIT_ACTIONS, ENTITY_TYPES } = require("../utils/auditLogger");
const LOW_STOCK_THRESHOLD = 2;

// SCAN & DEACTIVATE ALL LOW-STOCK PRODUCTS (Admin only)
// Sweeps all products where stock <= threshold AND isActive = true,
// deactivates them and sends the seller a notification + email for each one.
exports.scanLowStockProducts = async (request, reply) => {
  try {
    // Use raw SQL — isActive was added via migration and may not be in the
    // regenerated Prisma client, so prisma.product.findMany({ where: { isActive } })
    // can silently skip the filter.
    const products = await prisma.$queryRaw`
      SELECT p.id, p.title, p.stock, p."sellerId",
             u.email AS "sellerEmail", u.name AS "sellerName"
      FROM "products" p
      JOIN "users" u ON u.id = p."sellerId"
      WHERE p."isActive" = true
        AND p.stock <= ${LOW_STOCK_THRESHOLD}
        AND p."deletedAt" IS NULL
    `;

    if (products.length === 0) {
      return reply.status(200).send({
        success: true,
        message: "No low-stock active products found.",
        deactivated: 0
      });
    }

    const results = [];
    for (const product of products) {
      // Deactivate
      await prisma.$executeRaw`
        UPDATE "products"
        SET "isActive" = false, status = 'INACTIVE'
        WHERE id = ${product.id}
      `;

      // In-app notification (non-blocking)
      notifySellerLowStock(
        product.sellerId,
        product.id,
        product.title,
        Number(product.stock)
      ).catch(err => console.error("Low stock notification error:", err.message));

      // Email (non-blocking)
      if (product.sellerEmail) {
        sendSellerLowStockEmail(
          product.sellerEmail,
          product.sellerName || "Seller",
          product.title,
          Number(product.stock),
          product.id
        ).then(result => {
          if (!result.success) console.warn(`⚠️  [Admin scan] Email not sent to ${product.sellerEmail}: ${result.error}`);
          else console.log(`✅ [Admin scan] Email sent to ${product.sellerEmail} for "${product.title}"`);
        }).catch(err => console.error("Low stock email error:", err.message));
      } else {
        console.warn(`⚠️  [Admin scan] No email for seller ${product.sellerId} — email skipped`);
      }

      results.push({ productId: product.id, title: product.title, stock: Number(product.stock) });
      console.log(`⚠️  [Admin scan] Deactivated "${product.title}" — stock: ${product.stock}`);
    }

    return reply.status(200).send({
      success: true,
      message: `Scan complete. ${results.length} low-stock product(s) deactivated and sellers notified.`,
      deactivated: results.length,
      products: results
    });
  } catch (error) {
    console.error("scanLowStockProducts error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GET ORDERS BY SELLER ID (ADMIN ONLY  )
exports.getOrdersBySellerId = async (request, reply) => {
  try {
    // Only admin can access (route preHandler should enforce, but double-check)
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }
    const { sellerId } = request.params;
    // Find all orders that contain at least one product from this seller
    const orders = await prisma.order.findMany({
      where: {
        items: {
          some: {
            product: {
              sellerId: sellerId
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        items: {
          include: {
            product: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
            createdAt: true
          }
        }
      }
    });
    reply.send({ success: true, orders, count: orders.length });
  } catch (error) {
    console.error('Get orders by sellerId error:', error);
    reply.status(500).send({ success: false, error: error.message });
  }
};

// GET ALL USERS (role: "CUSTOMER")
exports.getAllUsers = async (request, reply) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: "CUSTOMER" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isVerified: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return reply.status(200).send({ success: true, users, count: users.length });
  } catch (err) {
    console.error("Get all users error:", err);
    reply.status(500).send({ success: false, error: err.message });
  }
};

// GET ALL SELLERS (from seller_profiles)
exports.getAllSellers = async (request, reply) => {
  try {
    const { status } = request.query || {};

    let rows;
    if (status) {
      const upperStatus = status.toUpperCase();
      rows = await prisma.$queryRaw`
        SELECT sp.id, sp."userId" AS "sellerId", sp."businessName", sp."storeName",
               sp."businessType", sp."businessAddress" AS address,
               sp."productCount", sp.status::text AS status,
               sp."minimumProductsUploaded", sp."onboardingStep",
               sp."bankDetails", sp."kycSubmitted",
               sp."createdAt", sp."updatedAt",
               u.email, u.name AS "contactPerson", u.phone,
               c.id AS "commission_id", c.title AS "commission_title",
               c.type::text AS "commission_type", c.value AS "commission_value",
               c.description AS "commission_description",
               c."isDefault" AS "commission_isDefault",
               c."isActive" AS "commission_isActive"
        FROM seller_profiles sp
        JOIN users u ON u.id = sp."userId"
        LEFT JOIN commissions c ON c.id = sp.commission_id
        WHERE sp.status::text = ${upperStatus}
        ORDER BY sp."createdAt" DESC
      `;
    } else {
      rows = await prisma.$queryRaw`
        SELECT sp.id, sp."userId" AS "sellerId", sp."businessName", sp."storeName",
               sp."businessType", sp."businessAddress" AS address,
               sp."productCount", sp.status::text AS status,
               sp."minimumProductsUploaded", sp."onboardingStep",
               sp."bankDetails", sp."kycSubmitted",
               sp."createdAt", sp."updatedAt",
               u.email, u.name AS "contactPerson", u.phone,
               c.id AS "commission_id", c.title AS "commission_title",
               c.type::text AS "commission_type", c.value AS "commission_value",
               c.description AS "commission_description",
               c."isDefault" AS "commission_isDefault",
               c."isActive" AS "commission_isActive"
        FROM seller_profiles sp
        JOIN users u ON u.id = sp."userId"
        LEFT JOIN commissions c ON c.id = sp.commission_id
        ORDER BY sp."createdAt" DESC
      `;
    }

    const formattedSellers = rows.map(row => ({
      id: row.id,
      applicationNumber: row.id,
      sellerId: row.sellerId,
      email: row.email,
      businessName: row.businessName,
      storeName: row.storeName,
      contactPerson: row.contactPerson,
      phone: row.phone,
      businessType: row.businessType,
      address: row.address,
      productCount: row.productCount,
      status: row.status,
      minimumProductsUploaded: row.minimumProductsUploaded,
      onboardingStep: row.onboardingStep,
      kycSubmitted: row.kycSubmitted,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      bankDetails: row.bankDetails,
      commission: row.commission_id ? {
        id: row.commission_id,
        title: row.commission_title,
        type: row.commission_type,
        value: row.commission_value,
        description: row.commission_description,
        isDefault: row.commission_isDefault,
        isActive: row.commission_isActive
      } : null
    }));

    return reply.status(200).send({ 
      success: true, 
      sellers: formattedSellers,
      count: formattedSellers.length 
    });
  } catch (err) {
    console.error("Get all sellers error:", err);
    reply.status(500).send({ success: false, error: err.message });
  }
};

// GET SINGLE SELLER DETAILS
exports.getSellerDetails = async (request, reply) => {
  try {
    const sellerId = request.params.id;
    
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: sellerId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            createdAt: true
          }
        }
      }
    });
    
    if (!seller) {
      return reply.status(404).send({ 
        success: false, 
        message: "Seller not found" 
      });
    }

    // Use raw SQL so featuredImage is included in product responses
    const products = await prisma.$queryRaw`
      SELECT p.id, p.title, p.description, p.price, p.category, p.stock,
             p."sellerId", p."sellerName", p."artistName", p.status, p."isActive",
             p.featured, p.tags, p."featuredImage", p.images AS "galleryImages",
             p."createdAt", p."updatedAt"
      FROM "products" p
      WHERE p."sellerId" = ${sellerId}
      ORDER BY p."createdAt" DESC
    `;

    // Get seller's orders (orders containing seller's products)
    const orders = await prisma.order.findMany({
      where: {
        items: {
          some: {
            product: {
              sellerId
            }
          }
        }
      },
      include: {
        items: {
          include: {
            product: true
          }
        }
      }
    });

    // Fetch commission assigned to this seller
    const commission = await getCommissionForSeller(sellerId).catch(() => null);

    return reply.status(200).send({ 
      success: true, 
      seller: {
        // Basic Info
        id: seller.id,
        sellerId: seller.userId,
        contactPerson: seller.contactPerson,
        
        // Business Info
        businessName: seller.businessName,
        businessType: seller.businessType,
        businessAddress: seller.businessAddress,
        abn: seller.abn,
        yearsInBusiness: seller.yearsInBusiness,
        
        // Store Info
        storeName: seller.storeName,
        storeDescription: seller.storeDescription,
        storeLogo: seller.storeLogo,
        storeBanner: seller.storeBanner,
        storeLocation: seller.storeLocation,
        
        // Artist Info
        artistName: seller.artistName,
        artistDescription: seller.artistDescription,
        
        // KYC Documents
        kycDocuments: seller.kycDocuments || [],
        kycSubmitted: seller.kycSubmitted,
        
        // Bank Details
        bankDetails: seller.bankDetails,
        
        // Commission
        commission: commission || null,
        
        // Status & Metrics
        status: seller.status,
        productCount: seller.productCount,
        minimumProductsUploaded: seller.minimumProductsUploaded,
        onboardingStep: seller.onboardingStep,
        
        // Admin Notes
        adminNotes: seller.adminNotes,
        
        // Verification Info
        verificationDocs: seller.verificationDocs,
        
        // Dates
        createdAt: seller.createdAt,
        updatedAt: seller.updatedAt,
        approvedAt: seller.approvedAt,
        rejectedAt: seller.rejectedAt,
        suspendedAt: seller.suspendedAt,
        activatedAt: seller.activatedAt,
        submittedForReviewAt: seller.submittedForReviewAt,
        
        // User Info
        userEmail: seller.user.email,
        userPhone: seller.user.phone,
        userCreatedAt: seller.user.createdAt
      },
      products,
      orders,
      statistics: {
        totalProducts: products.length,
        totalOrders: orders.length,
        activeProducts: products.filter(p => p.status === "ACTIVE").length,
        pendingOrders: orders.filter(o => o.status === "PENDING").length
      }
    });
  } catch (err) {
    console.error("Get seller details error:", err);
    reply.status(500).send({ success: false, error: err.message });
  }
};

// GET PRODUCTS OF A SPECIFIC SELLER
exports.getProductsBySeller = async (request, reply) => {
  try {
    const { sellerId } = request.params;
    
    // Check if seller exists
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: sellerId },
      include: { user: true }
    });
    
    if (!seller) {
      return reply.status(404).send({ 
        success: false, 
        message: "Seller not found" 
      });
    }

    const products = await prisma.$queryRaw`
      SELECT id, title, description, price, category, stock, "sellerId", "sellerName",
             "artistName", status, "isActive", featured, tags,
             "featuredImage", images AS "galleryImages",
             "rejectionReason", "createdAt", "updatedAt"
      FROM "products"
      WHERE "sellerId" = ${sellerId}
        AND "deletedAt" IS NULL
      ORDER BY "createdAt" DESC
    `;

    return reply.status(200).send({ 
      success: true, 
      products,
      count: products.length,
      seller: {
        id: seller.id,
        businessName: seller.businessName,
        storeName: seller.storeName
      }
    });
  } catch (err) {
    console.error("Get products by seller error:", err);
    reply.status(500).send({ success: false, error: err.message });
  }
};

// GET ALL PRODUCTS (Admin) — filterable by status + optional sellerId
// GET /admin/products?status=pending|approved|rejected|inactive|all&sellerId=xxx&page=1&limit=20
exports.getAllAdminProducts = async (request, reply) => {
  try {
    const { status = 'all', sellerId, page = 1, limit = 50 } = request.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Map friendly status names to DB enum values
    const statusMap = {
      pending:  'PENDING',
      approved: 'ACTIVE',
      active:   'ACTIVE',
      rejected: 'REJECTED',
      inactive: 'INACTIVE',
      all:      null
    };

    const dbStatus = statusMap[status.toLowerCase()] ?? null;

    // Build dynamic WHERE clause
    let products;
    if (dbStatus && sellerId) {
      products = await prisma.$queryRaw`
        SELECT p.id, p.title, p.description, p.price, p.category, p.stock,
               p."sellerId", p."sellerName", p."artistName", p.status, p."isActive",
               p.featured, p.tags, p."featuredImage", p.images AS "galleryImages",
               p."rejectionReason", p."createdAt", p."updatedAt",
               u.name AS "seller_name", u.email AS "seller_email",
               sp."storeName", sp."businessName"
        FROM "products" p
        JOIN "users" u ON p."sellerId" = u.id
        LEFT JOIN "seller_profiles" sp ON sp."userId" = p."sellerId"
        WHERE p.status = ${dbStatus}::"ProductStatus"
          AND p."sellerId" = ${sellerId}
          AND p."deletedAt" IS NULL
        ORDER BY p."createdAt" DESC
        LIMIT ${parseInt(limit)} OFFSET ${offset}
      `;
    } else if (dbStatus) {
      products = await prisma.$queryRaw`
        SELECT p.id, p.title, p.description, p.price, p.category, p.stock,
               p."sellerId", p."sellerName", p."artistName", p.status, p."isActive",
               p.featured, p.tags, p."featuredImage", p.images AS "galleryImages",
               p."rejectionReason", p."createdAt", p."updatedAt",
               u.name AS "seller_name", u.email AS "seller_email",
               sp."storeName", sp."businessName"
        FROM "products" p
        JOIN "users" u ON p."sellerId" = u.id
        LEFT JOIN "seller_profiles" sp ON sp."userId" = p."sellerId"
        WHERE p.status = ${dbStatus}::"ProductStatus"
          AND p."deletedAt" IS NULL
        ORDER BY p."createdAt" DESC
        LIMIT ${parseInt(limit)} OFFSET ${offset}
      `;
    } else if (sellerId) {
      products = await prisma.$queryRaw`
        SELECT p.id, p.title, p.description, p.price, p.category, p.stock,
               p."sellerId", p."sellerName", p."artistName", p.status, p."isActive",
               p.featured, p.tags, p."featuredImage", p.images AS "galleryImages",
               p."rejectionReason", p."createdAt", p."updatedAt",
               u.name AS "seller_name", u.email AS "seller_email",
               sp."storeName", sp."businessName"
        FROM "products" p
        JOIN "users" u ON p."sellerId" = u.id
        LEFT JOIN "seller_profiles" sp ON sp."userId" = p."sellerId"
        WHERE p."sellerId" = ${sellerId}
          AND p."deletedAt" IS NULL
        ORDER BY p."createdAt" DESC
        LIMIT ${parseInt(limit)} OFFSET ${offset}
      `;
    } else {
      products = await prisma.$queryRaw`
        SELECT p.id, p.title, p.description, p.price, p.category, p.stock,
               p."sellerId", p."sellerName", p."artistName", p.status, p."isActive",
               p.featured, p.tags, p."featuredImage", p.images AS "galleryImages",
               p."rejectionReason", p."createdAt", p."updatedAt",
               u.name AS "seller_name", u.email AS "seller_email",
               sp."storeName", sp."businessName"
        FROM "products" p
        JOIN "users" u ON p."sellerId" = u.id
        LEFT JOIN "seller_profiles" sp ON sp."userId" = p."sellerId"
        WHERE p."deletedAt" IS NULL
        ORDER BY p."createdAt" DESC
        LIMIT ${parseInt(limit)} OFFSET ${offset}
      `;
    }

    // Counts per status tab (always all sellers or filtered by sellerId)
    let counts;
    if (sellerId) {
      counts = await prisma.$queryRaw`
        SELECT status::text, COUNT(*)::int AS count
        FROM "products"
        WHERE "sellerId" = ${sellerId}
          AND "deletedAt" IS NULL
        GROUP BY status
      `;
    } else {
      counts = await prisma.$queryRaw`
        SELECT status::text, COUNT(*)::int AS count
        FROM "products"
        WHERE "deletedAt" IS NULL
        GROUP BY status
      `;
    }

    const countMap = { PENDING: 0, ACTIVE: 0, REJECTED: 0, INACTIVE: 0 };
    for (const row of counts) countMap[row.status] = row.count;

    // Shape each product
    const mapped = products.map(({ seller_name, seller_email, storeName, businessName, ...p }) => ({
      ...p,
      seller: {
        id: p.sellerId,
        name: seller_name,
        email: seller_email,
        storeName: storeName || null,
        businessName: businessName || null
      }
    }));

    return reply.send({
      success: true,
      products: mapped,
      count: mapped.length,
      counts: {
        all:      Object.values(countMap).reduce((a, b) => a + b, 0),
        pending:  countMap.PENDING,
        approved: countMap.ACTIVE,
        rejected: countMap.REJECTED,
        inactive: countMap.INACTIVE
      }
    });
  } catch (err) {
    console.error("Get all admin products error:", err);
    reply.status(500).send({ success: false, error: err.message });
  }
};

// GET PENDING SELLER APPROVALS
exports.getPendingSellers = async (request, reply) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT sp.id, sp."userId" AS "sellerId", sp."businessName", sp."storeName",
             sp."businessType", sp."businessAddress", sp."artistName",
             sp."storeDescription", sp."storeLogo", sp.abn, sp."kycSubmitted",
             sp."onboardingStep", sp."productCount", sp.status::text AS status,
             sp."submittedForReviewAt", sp."createdAt", sp."updatedAt",
             u.email, u.name, u.phone,
             c.id AS "commission_id", c.title AS "commission_title",
             c.type::text AS "commission_type", c.value AS "commission_value",
             c.description AS "commission_description",
             c."isDefault" AS "commission_isDefault",
             c."isActive" AS "commission_isActive"
      FROM seller_profiles sp
      JOIN users u ON u.id = sp."userId"
      LEFT JOIN commissions c ON c.id = sp.commission_id
      WHERE sp.status = 'PENDING'
      ORDER BY sp."createdAt" DESC
    `;

    const formattedSellers = rows.map(row => ({
      id: row.id,
      applicationNumber: row.id,
      sellerId: row.sellerId,
      email: row.email,
      businessName: row.businessName,
      storeName: row.storeName,
      contactPerson: row.name,
      phone: row.phone,
      abn: row.abn,
      businessAddress: row.businessAddress,
      businessType: row.businessType,
      artistName: row.artistName,
      storeDescription: row.storeDescription,
      storeLogo: row.storeLogo,
      kycSubmitted: row.kycSubmitted,
      onboardingStep: row.onboardingStep,
      submittedForReviewAt: row.submittedForReviewAt,
      productCount: row.productCount,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      commission: row.commission_id ? {
        id: row.commission_id,
        title: row.commission_title,
        type: row.commission_type,
        value: row.commission_value,
        description: row.commission_description,
        isDefault: row.commission_isDefault,
        isActive: row.commission_isActive
      } : null
    }));

    return reply.status(200).send({ 
      success: true, 
      sellers: formattedSellers,
      count: formattedSellers.length 
    });
  } catch (err) {
    console.error("Get pending sellers error:", err);
    reply.status(500).send({ success: false, error: err.message });
  }
};

// APPROVE SELLER
exports.approveSeller = async (request, reply) => {
  try {
    const sellerId = request.params.id;
    
    console.log("📝 Approve seller - ID:", sellerId);
    
    if (!sellerId) {
      return reply.status(400).send({ 
        success: false, 
        message: "Seller ID is required" 
      });
    }
    
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: sellerId },
      include: { user: true }
    });
    
    if (!seller) {
      return reply.status(404).send({ 
        success: false, 
        message: "Seller not found" 
      });
    }

    await prisma.sellerProfile.update({
      where: { userId: sellerId },
      data: {
        status: "APPROVED",
        approvedAt: new Date()
      }
    });

    // Send approval notification
    await notifySellerApproved(sellerId, seller.user.name);

    // Send approval email to seller
    try {
      await sendSellerApprovedEmail(seller.user.email, seller.user.name || "Seller");
    } catch (emailErr) {
      console.error("Seller approval email error (non-fatal):", emailErr.message);
    }
    
    // Send product recommendation notification
    await notifySellerProductRecommendation(sellerId, seller.user.name);

    return reply.status(200).send({ 
      success: true, 
      message: "Seller approved successfully" 
    });
  } catch (err) {
    console.error("Approve seller error:", err);
    reply.status(500).send({ success: false, error: err.message });
  }
};

// REJECT SELLER
exports.rejectSeller = async (request, reply) => {
  try {
    const sellerId = request.params.id;
    const { reason } = request.body;
    
    console.log("📝 Reject seller - ID:", sellerId);
    
    if (!sellerId) {
      return reply.status(400).send({ 
        success: false, 
        message: "Seller ID is required" 
      });
    }
    
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: sellerId },
      include: { user: true }
    });
    
    if (!seller) {
      return reply.status(404).send({ 
        success: false, 
        message: "Seller not found" 
      });
    }

    await prisma.sellerProfile.update({
      where: { userId: sellerId },
      data: {
        status: "REJECTED",
        rejectionReason: reason || "Not specified",
        rejectedAt: new Date()
      }
    });

    // Send rejection notification
    await notifySellerApprovalRejected(sellerId, reason || "Not specified", seller.user.name);

    return reply.status(200).send({ 
      success: true, 
      message: "Seller rejected" 
    });
  } catch (err) {
    console.error("Reject seller error:", err);
    reply.status(500).send({ success: false, error: err.message });
  }
};

// SUSPEND SELLER
exports.suspendSeller = async (request, reply) => {
  try {
    const { sellerId } = request.params;
    const { reason } = request.body;
    
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: sellerId }
    });
    
    if (!seller) {
      return reply.status(404).send({ 
        success: false, 
        message: "Seller not found" 
      });
    }

    await prisma.sellerProfile.update({
      where: { userId: sellerId },
      data: {
        status: "SUSPENDED",
        suspensionReason: reason || "Not specified",
        suspendedAt: new Date()
      }
    });

    return reply.status(200).send({ 
      success: true, 
      message: "Seller suspended" 
    });
  } catch (err) {
    console.error("Suspend seller error:", err);
    reply.status(500).send({ success: false, error: err.message });
  }
};

// UPDATE SELLER NOTES
exports.updateSellerNotes = async (request, reply) => {
  try {
    const sellerId = request.params.id;
    const { notes } = request.body;

    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: sellerId }
    });
    
    if (!seller) {
      return reply.status(404).send({ 
        success: false, 
        message: "Seller not found" 
      });
    }

    await prisma.sellerProfile.update({
      where: { userId: sellerId },
      data: {
        adminNotes: notes || ""
      }
    });

    reply.status(200).send({
      success: true,
      message: "Notes updated successfully"
    });
  } catch (error) {
    console.error("Update seller notes error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// ACTIVATE SELLER (GO LIVE)
exports.activateSeller = async (request, reply) => {
  try {
    const { id } = request.params;
    const adminId = request.user?.userId || "admin";

    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: id }
    });

    if (!seller) {
      return reply.status(404).send({
        success: false,
        message: "Seller not found"
      });
    }

    // Validation checks
    if (seller.status !== "APPROVED") {
      return reply.status(400).send({
        success: false,
        message: "Seller must be approved before activation"
      });
    }

    if (seller.productCount < 1) {
      return reply.status(400).send({
        success: false,
        message: "Seller must upload at least 1-2 products before going live. 5+ products recommended."
      });
    }

    // Update seller to active status and activate pending products in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update seller status
      const updatedSeller = await tx.sellerProfile.update({
        where: { userId: id },
        data: {
          status: "ACTIVE",
          activatedBy: adminId,
          activatedAt: new Date()
        }
      });

      // Activate all seller's pending products (status + isActive)
      const activatedProducts = await tx.product.updateMany({
        where: {
          sellerId: id,
          status: "PENDING"
        },
        data: {
          status: "ACTIVE"
        }
      });

      // Also flip isActive = true via raw SQL (field managed outside Prisma schema)
      await tx.$executeRaw`
        UPDATE "products"
        SET "isActive" = true
        WHERE "sellerId" = ${id} AND status = 'ACTIVE'
      `;

      return { updatedSeller, activatedCount: activatedProducts.count };
    });

    reply.status(200).send({
      success: true,
      message: `Seller is now LIVE! ${result.activatedCount} products activated and visible to customers.`,
      seller: result.updatedSeller,
      productsActivated: result.activatedCount
    });
  } catch (error) {
    console.error("Activate seller error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// ==================== CATEGORY MANAGEMENT ====================

// GET ALL CATEGORIES WITH PRODUCT COUNTS (Admin , Seller only)
exports.getAllCategories = async (request, reply) => {
  try {
    if (!request.user || (request.user.role !== 'ADMIN' && request.user.role !== 'SELLER')) {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }

    // Get all products with their categories
    const products = await prisma.product.findMany({
      select: {
        id: true,
        category: true
      }
    });

    // Group categories manually after trimming whitespace
    const categoryMap = new Map();
    
    products.forEach(product => {
      const trimmedCategory = product.category?.trim();
      if (trimmedCategory) {
        if (categoryMap.has(trimmedCategory)) {
          categoryMap.set(trimmedCategory, categoryMap.get(trimmedCategory) + 1);
        } else {
          categoryMap.set(trimmedCategory, 1);
        }
      }
    });

    // Convert to array and sort by product count (highest first)
    const categories = Array.from(categoryMap.entries())
      .map(([name, productCount]) => ({ name, productCount }))
      .sort((a, b) => b.productCount - a.productCount);

    // Get total categories and total products
    const totalProducts = await prisma.product.count();
    const totalCategories = categories.length;

    reply.send({
      success: true,
      categories,
      summary: {
        totalCategories,
        totalProducts
      }
    });
  } catch (error) {
    console.error('Get all categories error:', error);
    reply.status(500).send({ success: false, error: error.message });
  }
};

// ==================== COUPON MANAGEMENT ====================

// CREATE COUPON (Admin only)
exports.createCoupon = async (request, reply) => {
  try {
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }

    const {
      code,
      discountType = 'percentage',
      discountValue,
      expiresAt,
      usageLimit,
      usagePerUser,
      minCartValue,
      maxDiscount,
      isActive = true
    } = request.body;

    if (!code || discountValue === undefined || !expiresAt) {
      return reply.status(400).send({
        success: false,
        message: 'Coupon code, discountValue, and expiry date are required'
      });
    }

    if (!['percentage', 'fixed'].includes(discountType)) {
      return reply.status(400).send({ success: false, message: 'discountType must be "percentage" or "fixed"' });
    }

    if (discountType === 'percentage' && (discountValue <= 0 || discountValue > 100)) {
      return reply.status(400).send({ success: false, message: 'Percentage discount must be between 1 and 100' });
    }

    if (discountType === 'fixed' && discountValue <= 0) {
      return reply.status(400).send({ success: false, message: 'Fixed discount must be greater than 0' });
    }

    if (discountType === 'percentage' && (discountValue <= 0 || discountValue > 100)) {
      return reply.status(400).send({ success: false, message: 'Percentage discount must be between 1 and 100' });
    }

    if (discountType === 'flat' && discountValue <= 0) {
      return reply.status(400).send({ success: false, message: 'Flat discount must be greater than 0' });
    }

    const existingCoupon = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
    if (existingCoupon) {
      return reply.status(400).send({ success: false, message: 'Coupon code already exists' });
    }

    const coupon = await prisma.coupon.create({
      data: {
        code: code.toUpperCase(),
        discountType,
        discountValue: parseFloat(discountValue),
        expiresAt: new Date(expiresAt),
        usageLimit: usageLimit ? parseInt(usageLimit) : null,
        usagePerUser: usagePerUser ? parseInt(usagePerUser) : null,
        minCartValue: minCartValue ? parseFloat(minCartValue) : null,
        maxDiscount: maxDiscount ? parseFloat(maxDiscount) : null,
        isActive,
        createdBy: request.user.userId || request.user.uid
      }
    });

    reply.status(201).send({ success: true, message: 'Coupon created successfully', coupon });
  } catch (error) {
    console.error('Create coupon error:', error);
    reply.status(500).send({ success: false, error: error.message });
  }
};

// GET ALL COUPONS (Public)
exports.getAllCoupons = async (request, reply) => {
  try {
    const coupons = await prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' }
    });

    reply.send({
      success: true,
      coupons,
      count: coupons.length
    });
  } catch (error) {
    console.error('Get all coupons error:', error);
    reply.status(500).send({ success: false, error: error.message });
  }
};

// GET ACTIVE COUPONS (Public — for users to browse available offers)
exports.getActiveCoupons = async (request, reply) => {
  try {
    const now = new Date();
    const coupons = await prisma.coupon.findMany({
      where: {
        isActive: true,
        expiresAt: { gt: now }
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id:            true,
        code:          true,
        discountType:  true,
        discountValue: true,
        maxDiscount:   true,
        minCartValue:  true,
        expiresAt:     true,
        usagePerUser:  true
      }
    });

    reply.send({
      success: true,
      coupons,
      count: coupons.length
    });
  } catch (error) {
    console.error('Get active coupons error:', error);
    reply.status(500).send({ success: false, error: error.message });
  }
};

// UPDATE COUPON (Admin only)
exports.updateCoupon = async (request, reply) => {
  try {
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }

    const { id } = request.params;
    const { code, discountType, discountValue, expiresAt, usageLimit, usagePerUser, minCartValue, maxDiscount, isActive } = request.body;

    // Check if coupon exists
    const existingCoupon = await prisma.coupon.findUnique({ where: { id } });
    if (!existingCoupon) {
      return reply.status(404).send({ success: false, message: 'Coupon not found' });
    }

    const updateData = {};
    if (code) updateData.code = code.toUpperCase();
    if (discountType !== undefined) {
      if (!['percentage', 'fixed'].includes(discountType)) {
        return reply.status(400).send({ success: false, message: 'discountType must be "percentage" or "fixed"' });
      }
      updateData.discountType = discountType;
    }
    if (discountValue !== undefined) {
      const type = discountType || existingCoupon.discountType;
      if (type === 'percentage' && (discountValue <= 0 || discountValue > 100)) {
        return reply.status(400).send({ success: false, message: 'Percentage discount must be between 1 and 100' });
      }
      if (type === 'fixed' && discountValue <= 0) {
        return reply.status(400).send({ success: false, message: 'Fixed discount must be greater than 0' });
      }
      updateData.discountValue = parseFloat(discountValue);
    }
    if (expiresAt) updateData.expiresAt = new Date(expiresAt);
    if (usageLimit !== undefined) updateData.usageLimit = usageLimit !== null ? parseInt(usageLimit) : null;
    if (usagePerUser !== undefined) updateData.usagePerUser = usagePerUser !== null ? parseInt(usagePerUser) : null;
    if (minCartValue !== undefined) updateData.minCartValue = minCartValue !== null ? parseFloat(minCartValue) : null;
    if (maxDiscount !== undefined) updateData.maxDiscount = maxDiscount !== null ? parseFloat(maxDiscount) : null;
    if (isActive !== undefined) updateData.isActive = isActive;

    if (code) {
      const upper = code.toUpperCase();
      if (upper !== existingCoupon.code) {
        const conflict = await prisma.coupon.findUnique({ where: { code: upper } });
        if (conflict) return reply.status(400).send({ success: false, message: 'Coupon code already exists' });
      }
      updateData.code = upper;
    }

    if (discountType !== undefined) {
      if (!['percentage', 'flat'].includes(discountType))
        return reply.status(400).send({ success: false, message: "discountType must be 'percentage' or 'flat'" });
      updateData.discountType = discountType;
    }

    const effectiveType = discountType || existingCoupon.discountType;
    if (discountValue !== undefined) {
      if (effectiveType === 'percentage' && (discountValue <= 0 || discountValue > 100))
        return reply.status(400).send({ success: false, message: 'Percentage discount must be between 1 and 100' });
      if (effectiveType === 'flat' && discountValue <= 0)
        return reply.status(400).send({ success: false, message: 'Flat discount must be greater than 0' });
      updateData.discountValue = parseFloat(discountValue);
    }

    if (maxDiscount  !== undefined) updateData.maxDiscount  = maxDiscount  ? parseFloat(maxDiscount)  : null;
    if (minCartValue !== undefined) updateData.minCartValue = minCartValue ? parseFloat(minCartValue) : null;
    if (expiresAt    !== undefined) updateData.expiresAt    = new Date(expiresAt);
    if (usageLimit   !== undefined) updateData.usageLimit   = usageLimit   ? parseInt(usageLimit)     : null;
    if (usagePerUser !== undefined) updateData.usagePerUser = parseInt(usagePerUser);
    if (isActive     !== undefined) updateData.isActive     = Boolean(isActive);

    const updatedCoupon = await prisma.coupon.update({ where: { id }, data: updateData });

    reply.send({ success: true, message: 'Coupon updated successfully', coupon: updatedCoupon });
  } catch (error) {
    console.error('Update coupon error:', error);
    reply.status(500).send({ success: false, error: error.message });
  }
};

// DELETE COUPON (Admin only)
exports.deleteCoupon = async (request, reply) => {
  try {
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }

    const { id } = request.params;

    // Check if coupon exists
    const existingCoupon = await prisma.coupon.findUnique({
      where: { id }
    });

    if (!existingCoupon) {
      return reply.status(404).send({
        success: false,
        message: 'Coupon not found'
      });
    }

    await prisma.coupon.delete({
      where: { id }
    });

    reply.send({
      success: true,
      message: 'Coupon deleted successfully'
    });
  } catch (error) {
    console.error('Delete coupon error:', error);
    reply.status(500).send({ success: false, error: error.message });
  }
};

// VALIDATE COUPON (Customer use — preview discount before checkout)
exports.validateCoupon = async (request, reply) => {
  try {
    const { code, orderTotal } = request.body;

    if (!code) {
      return reply.status(400).send({ success: false, message: 'Coupon code is required' });
    }

    const coupon = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });

    if (!coupon) {
      return reply.status(404).send({ success: false, message: 'Invalid coupon code' });
    }

    if (!coupon.isActive) {
      return reply.status(400).send({ success: false, message: 'This coupon is no longer active' });
    }

    if (new Date() > coupon.expiresAt) {
      return reply.status(400).send({ success: false, message: 'Coupon has expired' });
    }

    if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
      return reply.status(400).send({ success: false, message: 'Coupon usage limit has been reached' });
    }

    // Validate orderTotal and calculate discount
    let discountAmount = null;
    let finalTotal = null;

    if (orderTotal !== undefined) {
      const total = parseFloat(orderTotal);
      if (isNaN(total) || total <= 0) {
        return reply.status(400).send({ success: false, message: 'Order total must be a positive number' });
      }

      if (coupon.minCartValue !== null && total < coupon.minCartValue) {
        return reply.status(400).send({
          success: false,
          message: `Minimum cart value of $${coupon.minCartValue.toFixed(2)} required for this coupon`
        });
      }

      if (coupon.discountType === 'percentage') {
        discountAmount = parseFloat(((total * coupon.discountValue) / 100).toFixed(2));
        if (coupon.maxDiscount !== null) discountAmount = Math.min(discountAmount, coupon.maxDiscount);
      } else {
        discountAmount = Math.min(coupon.discountValue, total);
      }
    }

    reply.send({
      success: true,
      message: 'Coupon is valid',
      coupon: {
        id: coupon.id,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        expiresAt: coupon.expiresAt,
        usageLimit: coupon.usageLimit,
        usageCount: coupon.usageCount,
        minCartValue: coupon.minCartValue,
        maxDiscount: coupon.maxDiscount,
        discountAmount
      }
    });
  } catch (error) {
    console.error('Validate coupon error:', error);
    reply.status(500).send({ success: false, error: error.message });
  }
};


// Get Analysis and Sales Reports (Admin only)

// GET SALES ANALYTICS (ADMIN)
exports.getSalesAnalytics = async (request, reply) => {
  try {
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }

    // Get all orders with items, products, user, and seller info
    const orders = await prisma.order.findMany({
      include: {
        items: { include: { product: { include: { seller: true } } } },
        user: { select: { id: true, name: true } }
      }
    });

    let totalRevenue = 0;
    let totalOrders = orders.length;
    let totalItemsSold = 0;
    let statusBreakdown = {
      PENDING: 0,
      CONFIRMED: 0,
      PROCESSING: 0,
      SHIPPED: 0,
      DELIVERED: 0,
      CANCELLED: 0,
      REFUND: 0,
      PARTIAL_REFUND: 0
    };
    let productSales = {};
    let topProducts = [];

    orders.forEach(order => {
      totalRevenue += Number(order.totalAmount || 0);
      statusBreakdown[order.status] = (statusBreakdown[order.status] || 0) + 1;
      order.items.forEach(item => {
        totalItemsSold += item.quantity;
        const pid = item.productId;
        if (!productSales[pid]) {
          productSales[pid] = {
            productId: pid,
            title: item.product.title,
            sellerId: item.product.sellerId,
            sellerName: item.product.seller?.storeName || item.product.seller?.businessName || '',
            quantity: 0,
            revenue: 0
          };
        }
        productSales[pid].quantity += item.quantity;
        productSales[pid].revenue += Number(item.price) * item.quantity;
      });
    });

    // Top products by quantity sold
    topProducts = Object.values(productSales)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    const averageOrderValue = totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : "0.00";

    reply.send({
      success: true,
      analytics: {
        totalRevenue: totalRevenue.toFixed(2),
        totalOrders,
        totalItemsSold,
        averageOrderValue,
        statusBreakdown,
        topProducts,
        period: { startDate: "All time", endDate: "Present" }
      }
    });
  } catch (error) {
    console.error("Sales analytics error:", error);
    reply.status(500).send({ success: false, message: error.message });
  }
};

// EXPORT SALES CSV (ADMIN)
exports.exportSalesCSV = async (request, reply) => {
  try {
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }

    // Get all orders with items, products, user, and seller info
    const orders = await prisma.order.findMany({
      include: {
        items: { include: { product: { include: { seller: true } } } },
        user: { select: { id: true, name: true, email: true, phone: true } }
      }
    });

    // Transform orders for CSV utility
    const csvOrders = orders.map(order => ({
      id: order.id,
      createdAt: order.createdAt,
      status: order.status,
      paymentMethod: order.paymentMethod,
      trackingNumber: order.trackingNumber,
      estimatedDelivery: order.estimatedDelivery,
      customerName: order.user?.name,
      customerEmail: order.user?.email || order.customerEmail,
      customerPhone: order.user?.phone || order.customerPhone,
      shippingAddress: order.shippingAddress,
      shippingAddressLine: order.shippingAddressLine,
      shippingCity: order.shippingCity,
      shippingState: order.shippingState,
      shippingZipCode: order.shippingZipCode,
      shippingCountry: order.shippingCountry,
      shippingPhone: order.shippingPhone,
      products: order.items.map(item => ({
        productId: item.productId,
        title: item.product.title,
        price: item.price,
        quantity: item.quantity,
        sellerId: item.product.sellerId,
        sellerName: item.product.seller?.storeName || item.product.seller?.businessName || ''
      }))
    }));

    const csv = generateSalesReportCSV(csvOrders);

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="sales_report.csv"');
    reply.send(csv);
  } catch (error) {
    console.error("Export sales CSV error:", error);
    reply.status(500).send({ success: false, message: error.message });
  }
};

// ==================== PRODUCT APPROVAL MANAGEMENT ====================

// GET ALL PENDING PRODUCTS (Admin only)
exports.getPendingProducts = async (request, reply) => {
  try {
    // Only admin can access
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }

    const products = await prisma.$queryRaw`
      SELECT p.id, p.title, p.description, p.price, p.category, p.stock,
             p."sellerId", p."sellerName", p."artistName", p.status, p."isActive",
             p.featured, p.tags, p."featuredImage", p.images AS "galleryImages",
             p."rejectionReason", p."createdAt", p."updatedAt",
             u.id AS "seller_id", u.name AS "seller_name", u.email AS "seller_email"
      FROM "products" p
      JOIN "users" u ON p."sellerId" = u.id
      WHERE p.status = 'PENDING'
      ORDER BY p."createdAt" DESC
    `;

    const mapped = products.map(({ seller_id, seller_name, seller_email, ...p }) => ({
      ...p,
      seller: { id: seller_id, name: seller_name, email: seller_email }
    }));

    reply.send({ 
      success: true, 
      products: mapped, 
      count: mapped.length,
      message: `${mapped.length} products pending approval`
    });
  } catch (error) {
    console.error("Get pending products error:", error);
    reply.status(500).send({ success: false, message: error.message });
  }
};

// APPROVE PRODUCT (Admin only)
exports.approveProduct = async (request, reply) => {
  try {
    // Only admin can access
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }

    const { productId } = request.params;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        seller: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!product) {
      return reply.status(404).send({
        success: false,
        message: "Product not found"
      });
    }

    // Update product to ACTIVE and clear any previous rejection reason
    const approvedProduct = await prisma.product.update({
      where: { id: productId },
      data: {
        status: "ACTIVE",
        rejectionReason: null  // clear any previous rejection reason
      }
    });

    // Update isActive using raw SQL since client doesn't recognize it yet
    await prisma.$executeRaw`UPDATE "products" SET "isActive" = true WHERE "id" = ${productId}`;

    // ── Audit log: product approved ───────────────────────────────────────
    auditLog({
      entityType:   ENTITY_TYPES.PRODUCT,
      entityId:     productId,
      action:       AUDIT_ACTIONS.PRODUCT_APPROVED,
      previousData: product,
      newData:      { ...product, status: 'ACTIVE', isActive: true, rejectionReason: null },
      ...extractRequestMeta(request),
    });

    // Send notification to seller about product approval
    await notifySellerProductStatusChange(product.sellerId, productId, "ACTIVE", product.title);
    console.log(`✅ [approveProduct] In-app notification sent to seller ${product.sellerId} for product "${product.title}"`);

    // Send email to seller about product approval
    if (product.seller?.email) {
      console.log(`📧 [approveProduct] Sending approval email to ${product.seller.email}`);
      sendSellerProductApprovedEmail(product.seller.email, product.seller.name, {
        productTitle: product.title,
        productId
      }).catch(e => console.error('Seller product approved email error:', e.message));
    } else {
      console.warn(`⚠️  [approveProduct] No seller email found for product ${productId} — seller email skipped`);
    }

    // Fetch updated product with featuredImage via raw SQL
    const rows = await prisma.$queryRaw`
      SELECT id, title, description, price, category, stock, "sellerId", "sellerName",
             "artistName", status, "isActive", featured, tags,
             "featuredImage", images AS "galleryImages",
             "rejectionReason", "createdAt", "updatedAt"
      FROM "products"
      WHERE id = ${productId}
    `;

    reply.send({
      success: true,
      message: "Product approved successfully",
      product: rows[0] || approvedProduct
    });
  } catch (error) {
    console.error("Approve product error:", error);
    reply.status(500).send({ success: false, message: error.message });
  }
};

// REJECT PRODUCT (Admin only)
exports.rejectProduct = async (request, reply) => {
  try {
    // Only admin can access
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }

    const { productId } = request.params;
    const body = request.body || {};
    const query = request.query || {};
    
    // Handle body or query params, and both 'reason' and 'rejectionReason' field names
    const reason = body.reason || body.rejectionReason || query.reason || query.rejectionReason;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        seller: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!product) {
      return reply.status(404).send({
        success: false,
        message: "Product not found"
      });
    }

    // Mark product as REJECTED (distinct from INACTIVE so admin can track it)
    await prisma.product.update({
      where: { id: productId },
      data: {
        status: "REJECTED",
        rejectionReason: reason || "No reason provided"
      }
    });
    // isActive managed outside Prisma schema regeneration — keep via raw SQL
    await prisma.$executeRaw`UPDATE "products" SET "isActive" = false WHERE "id" = ${productId}`;

    // ── Audit log: product rejected ───────────────────────────────────────
    auditLog({
      entityType:   ENTITY_TYPES.PRODUCT,
      entityId:     productId,
      action:       AUDIT_ACTIONS.PRODUCT_REJECTED,
      previousData: product,
      newData:      { ...product, status: 'REJECTED', isActive: false, rejectionReason: reason || 'No reason provided' },
      reason:       reason || 'No reason provided',
      ...extractRequestMeta(request),
    });

    // Send notification to seller about product rejection
    await notifySellerProductStatusChange(product.sellerId, productId, "REJECTED", product.title, reason || "No specific reason provided");
    console.log(`✅ [rejectProduct] In-app notification sent to seller ${product.sellerId} for product "${product.title}"`);

    // Send email to seller about product rejection
    if (product.seller?.email) {
      console.log(`📧 [rejectProduct] Sending rejection email to ${product.seller.email}`);
      sendSellerProductRejectedEmail(product.seller.email, product.seller.name, {
        productTitle: product.title,
        reason: reason || 'No specific reason provided',
        productId
      }).catch(e => console.error('Seller product rejected email error:', e.message));
    } else {
      console.warn(`⚠️  [rejectProduct] No seller email found for product ${productId} — seller email skipped`);
    }

    reply.send({
      success: true,
      message: "Product rejected successfully",
      reason: reason || "No specific reason provided"
    });
  } catch (error) {
    console.error("Reject product error:", error);
    reply.status(500).send({ success: false, message: error.message });
  }
};

// ACTIVATE PRODUCT (Admin only) - set product live
exports.activateProduct = async (request, reply) => {
  try {
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }

    const { productId } = request.params;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return reply.status(404).send({ success: false, message: 'Product not found' });
    }

    await prisma.product.update({
      where: { id: productId },
      data: { status: 'ACTIVE' }
    });

    await prisma.$executeRaw`UPDATE "products" SET "isActive" = true WHERE "id" = ${productId}`;

    // ── Audit log: product activated ──────────────────────────────────────
    auditLog({
      entityType:   ENTITY_TYPES.PRODUCT,
      entityId:     productId,
      action:       AUDIT_ACTIONS.PRODUCT_ACTIVATED,
      previousData: product,
      newData:      { ...product, status: 'ACTIVE', isActive: true },
      ...extractRequestMeta(request),
    });

    // Send notification to seller
    await notifySellerProductStatusChange(product.sellerId, productId, "ACTIVE", product.title);

    reply.send({ success: true, message: 'Product activated successfully' });
  } catch (error) {
    console.error('Activate product error:', error);
    reply.status(500).send({ success: false, message: error.message });
  }
};

// DEACTIVATE PRODUCT (Admin only) - hide product from public
exports.deactivateProduct = async (request, reply) => {
  try {
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }

    const { productId } = request.params;
    const body = request.body || {};
    const query = request.query || {};
    const reason = body.reason || body.rejectionReason || query.reason || query.rejectionReason;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return reply.status(404).send({ success: false, message: 'Product not found' });
    }

    await prisma.product.update({
      where: { id: productId },
      data: { 
        status: 'INACTIVE',
        rejectionReason: reason || null
      }
    });

    await prisma.$executeRaw`UPDATE "products" SET "isActive" = false WHERE "id" = ${productId}`;

    // ── Audit log: product deactivated ────────────────────────────────────
    auditLog({
      entityType:   ENTITY_TYPES.PRODUCT,
      entityId:     productId,
      action:       AUDIT_ACTIONS.PRODUCT_DEACTIVATED,
      previousData: product,
      newData:      { ...product, status: 'INACTIVE', isActive: false },
      reason:       reason || null,
      ...extractRequestMeta(request),
    });

    // Send notification to seller
    await notifySellerProductStatusChange(product.sellerId, productId, "INACTIVE", product.title, reason);

    reply.send({ success: true, message: 'Product deactivated successfully' });
  } catch (error) {
    console.error('Deactivate product error:', error);
    reply.status(500).send({ success: false, message: error.message });
  }
};

// BULK APPROVE PRODUCTS (Admin only)
exports.bulkApproveProducts = async (request, reply) => {
  try {
    // Only admin can access
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }

    const { productIds } = request.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return reply.status(400).send({
        success: false,
        message: "Product IDs array is required"
      });
    }

    const result = await prisma.product.updateMany({
      where: {
        id: { in: productIds },
        status: "PENDING" // Only approve pending products
      },
      data: {
        status: "ACTIVE"
      }
    });

    // Update isActive using raw SQL for bulk approval
    await prisma.$executeRaw`UPDATE "products" SET "isActive" = true WHERE "id" = ANY(${productIds})`;

    // ── Audit log: bulk approved ─────────────────────────────────────────────
    auditLog({
      entityType: ENTITY_TYPES.PRODUCT,
      entityId:   'BULK',
      action:     AUDIT_ACTIONS.PRODUCT_BULK_APPROVED,
      newData:    { productIds, approvedCount: result.count },
      reason:     `Bulk approval of ${result.count} product(s)`,
      ...extractRequestMeta(request),
    });

    reply.send({
      success: true,
      message: `${result.count} products approved successfully`,
      approvedCount: result.count
    });
  } catch (error) {
    console.error("Bulk approve products error:", error);
    reply.status(500).send({ success: false, message: error.message });
  }
};

// ==================== REVENUE & ORDERS CHART (ADMIN) ====================
// GET /admin/analytics/revenue-chart?period=7D|30D|1Y
// Returns daily (7D/30D) or monthly (1Y) revenue & order count for DELIVERED orders
exports.getRevenueOrdersChart = async (request, reply) => {
  try {
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }

    const period = (request.query.period || '7D').toUpperCase();
    const validPeriods = ['7D', '30D', '1Y'];
    if (!validPeriods.includes(period)) {
      return reply.status(400).send({ success: false, message: `Invalid period. Use one of: ${validPeriods.join(', ')}` });
    }

    // Determine interval and grouping
    const intervalMap = { '7D': 7, '30D': 30, '1Y': 365 };
    const days = intervalMap[period];
    const groupByMonth = period === '1Y';

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);

    // Query delivered orders grouped by date or month
    let rows;
    if (groupByMonth) {
      rows = await prisma.$queryRaw`
        SELECT
          TO_CHAR(DATE_TRUNC('month', "updatedAt"), 'YYYY-MM-DD') AS date,
          COUNT(*)::int                                            AS orders,
          COALESCE(SUM("totalAmount"), 0)::float                  AS revenue
        FROM orders
        WHERE status = 'DELIVERED'
          AND "updatedAt" >= ${startDate}
        GROUP BY DATE_TRUNC('month', "updatedAt")
        ORDER BY DATE_TRUNC('month', "updatedAt") ASC
      `;
    } else {
      rows = await prisma.$queryRaw`
        SELECT
          TO_CHAR(DATE("updatedAt"), 'YYYY-MM-DD') AS date,
          COUNT(*)::int                            AS orders,
          COALESCE(SUM("totalAmount"), 0)::float   AS revenue
        FROM orders
        WHERE status = 'DELIVERED'
          AND "updatedAt" >= ${startDate}
        GROUP BY DATE("updatedAt")
        ORDER BY DATE("updatedAt") ASC
      `;
    }

    // Build a complete date list for the period (fill missing dates with 0)
    const resultMap = {};
    for (const row of rows) {
      resultMap[row.date] = { orders: row.orders, revenue: Number(row.revenue) };
    }

    const chartData = [];
    if (groupByMonth) {
      // Iterate month by month
      const cursor = new Date(now.getFullYear(), now.getMonth() - 11, 1); // 12 months back
      for (let i = 0; i < 12; i++) {
        const key = cursor.toISOString().slice(0, 10); // YYYY-MM-DD (1st of month)
        chartData.push({
          date: key,
          orders: resultMap[key]?.orders ?? 0,
          revenue: resultMap[key]?.revenue ?? 0
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    } else {
      // Iterate day by day
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
        chartData.push({
          date: key,
          orders: resultMap[key]?.orders ?? 0,
          revenue: resultMap[key]?.revenue ?? 0
        });
      }
    }

    return reply.send({
      success: true,
      period,
      note: 'Revenue and order counts are based on orders with DELIVERED status.',
      data: chartData
    });
  } catch (error) {
    console.error('Revenue orders chart error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// BACKFILL ORDER NOTIFICATIONS (Admin only)
// Creates OrderNotification records for all orders that don't have one yet.
// Run once after deployment to populate historical data.
exports.backfillOrderNotifications = async (request, reply) => {
  try {
    const result = await backfillOrderNotifications();
    return reply.status(200).send({
      success: true,
      message: `Backfill complete. Created ${result.created} notification(s), skipped ${result.skipped} (already existed).`,
      ...result
    });
  } catch (error) {
    console.error('Backfill notifications error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ==================== PRODUCT RECYCLE BIN (Admin) ====================

/**
 * GET /admin/products/recycle-bin
 * Lists all soft-deleted products across all sellers.
 * Optional: ?sellerId=xxx &page=1 &limit=50
 */
exports.getAdminRecycleBin = async (request, reply) => {
  try {
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }

    const { sellerId, page = 1, limit = 50 } = request.query;
    const take   = Math.min(Number(limit), 200);
    const offset = (Number(page) - 1) * take;

    let products;
    if (sellerId) {
      products = await prisma.$queryRaw`
        SELECT p.id, p.title, p.price, p.category, p.stock, p."sellerId",
               p."sellerName", p.status, p."featuredImage",
               p."deletedAt", p."deletedBy", p."deletedByRole",
               p."createdAt", p."updatedAt",
               u.name AS "seller_name", u.email AS "seller_email"
        FROM "products" p
        JOIN "users" u ON u.id = p."sellerId"
        WHERE p."deletedAt" IS NOT NULL
          AND p."sellerId" = ${sellerId}
        ORDER BY p."deletedAt" DESC
        LIMIT ${take} OFFSET ${offset}
      `;
    } else {
      products = await prisma.$queryRaw`
        SELECT p.id, p.title, p.price, p.category, p.stock, p."sellerId",
               p."sellerName", p.status, p."featuredImage",
               p."deletedAt", p."deletedBy", p."deletedByRole",
               p."createdAt", p."updatedAt",
               u.name AS "seller_name", u.email AS "seller_email"
        FROM "products" p
        JOIN "users" u ON u.id = p."sellerId"
        WHERE p."deletedAt" IS NOT NULL
        ORDER BY p."deletedAt" DESC
        LIMIT ${take} OFFSET ${offset}
      `;
    }

    const countRows = sellerId
      ? await prisma.$queryRaw`SELECT COUNT(*)::int AS total FROM "products" WHERE "deletedAt" IS NOT NULL AND "sellerId" = ${sellerId}`
      : await prisma.$queryRaw`SELECT COUNT(*)::int AS total FROM "products" WHERE "deletedAt" IS NOT NULL`;
    const total = countRows[0]?.total ?? 0;

    return reply.send({
      success:  true,
      products: products.map(({ seller_name, seller_email, ...p }) => ({
        ...p,
        seller: { id: p.sellerId, name: seller_name, email: seller_email }
      })),
      meta: { total, page: Number(page), limit: take, pages: Math.ceil(total / take) }
    });
  } catch (error) {
    console.error('Get admin recycle bin error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

/**
 * DELETE /admin/products/:productId/permanent
 * Permanently (hard) deletes a product that is already in the Recycle Bin.
 */
exports.permanentlyDeleteProduct = async (request, reply) => {
  try {
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }

    const { productId } = request.params;

    const rows = await prisma.$queryRaw`SELECT * FROM "products" WHERE id = ${productId}`;
    const product = rows[0];

    if (!product) {
      return reply.status(404).send({ success: false, message: 'Product not found.' });
    }

    if (!product.deletedAt) {
      return reply.status(400).send({
        success: false,
        message: 'Product is not in the Recycle Bin. Soft-delete it first before permanently deleting.'
      });
    }

    // Audit log before hard delete — last chance to record it
    auditLog({
      entityType:   ENTITY_TYPES.PRODUCT,
      entityId:     productId,
      action:       AUDIT_ACTIONS.PRODUCT_PERMANENTLY_DELETED,
      previousData: product,
      reason:       request.body?.reason ?? 'Permanent deletion from Recycle Bin by Admin',
      ...extractRequestMeta(request),
    });

    await prisma.product.delete({ where: { id: productId } });

    return reply.send({
      success: true,
      message: 'Product permanently deleted. This action cannot be undone.'
    });
  } catch (error) {
    console.error('Permanent delete product error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ==================== AUDIT LOG QUERIES (Admin only) ====================

/**
 * GET /admin/audit-logs
 * Query params: entityType, entityId, actorId, action, from, to, page, limit
 */
exports.getAuditLogs = async (request, reply) => {
  try {
    const {
      entityType,
      entityId,
      actorId,
      action,
      from,
      to,
      page  = 1,
      limit = 50,
    } = request.query;

    const where = {};
    if (entityType) where.entityType = entityType;
    if (entityId)   where.entityId   = entityId;
    if (actorId)    where.actorId    = actorId;
    if (action)     where.action     = action;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to)   where.createdAt.lte = new Date(to);
    }

    const take = Math.min(Number(limit), 200); // hard cap
    const skip = (Number(page) - 1) * take;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return reply.send({
      success: true,
      data:    logs,
      meta: {
        total,
        page:  Number(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

/**
 * GET /admin/audit-logs/products/:productId
 * Full immutable history for a single product, newest first.
 */
exports.getProductAuditHistory = async (request, reply) => {
  try {
    const { productId } = request.params;
    const { page = 1, limit = 50 } = request.query;
    const callerRole = request.user?.role;
    const callerId   = request.user?.userId;

    // ── Role gate: only ADMIN or SELLER may call this endpoint ───────────────
    if (callerRole !== 'ADMIN' && callerRole !== 'SELLER') {
      return reply.status(403).send({
        success: false,
        message: 'Access denied. Admin or Seller account required.',
      });
    }

    // ── Seller ownership check ────────────────────────────────────────────────
    // Sellers may only view audit logs for their own products.
    if (callerRole === 'SELLER') {
      const product = await prisma.product.findUnique({
        where:  { id: productId },
        select: { sellerId: true },
      });

      if (!product) {
        return reply.status(404).send({ success: false, message: 'Product not found.' });
      }

      if (product.sellerId !== callerId) {
        return reply.status(403).send({
          success: false,
          message: 'You do not have permission to view audit logs for this product.',
        });
      }
    }

    const take = Math.min(Number(limit), 200);
    const skip = (Number(page) - 1) * take;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where:   { entityType: 'PRODUCT', entityId: productId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.auditLog.count({ where: { entityType: 'PRODUCT', entityId: productId } }),
    ]);

    // ── Strip internal-only fields from seller responses ─────────────────────
    const data = callerRole === 'SELLER'
      ? logs.map(({ actorIp, userAgent, requestId, ...entry }) => entry)
      : logs;

    return reply.send({
      success: true,
      productId,
      data,
      meta: {
        total,
        page:  Number(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    console.error('Get product audit history error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};






