const prisma = require("../config/prisma");
const { generateSalesReportCSV } = require("../utils/csvExport");
const { sendSellerApprovedEmail } = require("../utils/emailService");
const {
  notifySellerApproved,
  notifySellerApprovalRejected,
  notifySellerProductRecommendation,
  notifySellerProductStatusChange
} = require("./notification");

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
    const sellers = await prisma.sellerProfile.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            createdAt: true
          }
        }
      }
    });

    const formattedSellers = sellers.map(seller => ({
      id: seller.id,
      sellerId: seller.userId,
      email: seller.user.email,
      businessName: seller.businessName,
      storeName: seller.storeName,
      contactPerson: seller.user.name,
      phone: seller.user.phone,
      businessType: seller.businessType,
      address: seller.businessAddress,
      productCount: seller.productCount,
      status: seller.status,
      minimumProductsUploaded: seller.minimumProductsUploaded,
      createdAt: seller.createdAt,
      updatedAt: seller.updatedAt,
      bankDetails: seller.bankDetails,
      documents: seller.verificationDocs
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
             "featuredImage", images AS "galleryImages", "createdAt", "updatedAt"
      FROM "products"
      WHERE "sellerId" = ${sellerId}
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

// GET PENDING SELLER APPROVALS
exports.getPendingSellers = async (request, reply) => {
  try {
    const pendingSellers = await prisma.sellerProfile.findMany({
      where: { status: "PENDING" },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            phone: true
          }
        }
      }
    });
    
    const formattedSellers = pendingSellers.map(seller => ({
      id: seller.id,
      sellerId: seller.userId,
      email: seller.user.email,
      businessName: seller.businessName,
      storeName: seller.storeName,
      contactPerson: seller.user.name,
      phone: seller.user.phone,
      status: seller.status,
      createdAt: seller.createdAt,
      ...seller
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

      // Activate all seller's pending products
      const activatedProducts = await tx.product.updateMany({
        where: {
          sellerId: id,
          status: "PENDING"
        },
        data: {
          status: "ACTIVE"
        }
      });

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
      discountType = 'percentage',  // 'percentage' | 'flat'
      discountValue,
      maxDiscount,                   // optional cap for percentage type
      minCartValue,                  // optional minimum cart total
      expiresAt,
      usageLimit,                    // optional total usage cap
      usagePerUser = 1,
      isActive = true
    } = request.body;

    if (!code || discountValue === undefined || !expiresAt) {
      return reply.status(400).send({
        success: false,
        message: 'code, discountValue, and expiresAt are required'
      });
    }

    if (!['percentage', 'flat'].includes(discountType)) {
      return reply.status(400).send({ success: false, message: "discountType must be 'percentage' or 'flat'" });
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
        maxDiscount:   maxDiscount   ? parseFloat(maxDiscount)   : null,
        minCartValue:  minCartValue  ? parseFloat(minCartValue)  : null,
        expiresAt:     new Date(expiresAt),
        usageLimit:    usageLimit    ? parseInt(usageLimit)      : null,
        usagePerUser:  parseInt(usagePerUser) || 1,
        isActive:      Boolean(isActive),
        createdBy:     request.user.userId || request.user.uid
      }
    });

    reply.status(201).send({ success: true, message: 'Coupon created successfully', coupon });
  } catch (error) {
    console.error('Create coupon error:', error);
    reply.status(500).send({ success: false, error: error.message });
  }
};

// GET ALL COUPONS (Admin only)
exports.getAllCoupons = async (request, reply) => {
  try {
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ success: false, message: 'Access denied. Admins only.' });
    }

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
    const {
      code, discountType, discountValue,
      maxDiscount, minCartValue,
      expiresAt, usageLimit, usagePerUser, isActive
    } = request.body;

    const existingCoupon = await prisma.coupon.findUnique({ where: { id } });
    if (!existingCoupon) {
      return reply.status(404).send({ success: false, message: 'Coupon not found' });
    }

    const updateData = {};

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

// VALIDATE COUPON (Customer use)
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
          message: `Minimum cart value of $${coupon.minCartValue.toFixed(2)} required to use this coupon`
        });
      }

      if (coupon.discountType === 'percentage') {
        discountAmount = parseFloat(((total * coupon.discountValue) / 100).toFixed(2));
        if (coupon.maxDiscount !== null && discountAmount > coupon.maxDiscount) {
          discountAmount = coupon.maxDiscount;
        }
      } else {
        // flat
        discountAmount = Math.min(coupon.discountValue, total);
      }

      finalTotal = parseFloat((total - discountAmount).toFixed(2));
    }

    reply.send({
      success: true,
      message: 'Coupon is valid',
      coupon: {
        id:            coupon.id,
        code:          coupon.code,
        discountType:  coupon.discountType,
        discountValue: coupon.discountValue,
        maxDiscount:   coupon.maxDiscount,
        minCartValue:  coupon.minCartValue,
        expiresAt:     coupon.expiresAt,
        usageLimit:    coupon.usageLimit,
        usagePerUser:  coupon.usagePerUser,
        usageCount:    coupon.usageCount,
        discountAmount,
        finalTotal
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
      PENDING: 0, CONFIRMED: 0, PROCESSING: 0, SHIPPED: 0, DELIVERED: 0, CANCELLED: 0
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
             p."createdAt", p."updatedAt",
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

    // Update product to active - temporarily use both fields
    const approvedProduct = await prisma.product.update({
      where: { id: productId },
      data: {
        status: "ACTIVE" // Update status field
        // Note: isActive will be updated via raw SQL until Prisma client is regenerated
      }
    });

    // Update isActive using raw SQL since client doesn't recognize it yet
    await prisma.$executeRaw`UPDATE "products" SET "isActive" = true WHERE "id" = ${productId}`;

    // Send notification to seller about product approval
    await notifySellerProductStatusChange(product.sellerId, productId, "ACTIVE", product.title);

    // Fetch updated product with featuredImage via raw SQL
    const rows = await prisma.$queryRaw`
      SELECT id, title, description, price, category, stock, "sellerId", "sellerName",
             "artistName", status, "isActive", featured, tags,
             "featuredImage", images AS "galleryImages", "createdAt", "updatedAt"
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

    // Option 1: Keep product but mark as rejected
    await prisma.product.update({
      where: { id: productId },
      data: {
        isActive: false,
        status: "INACTIVE",
        rejectionReason: reason || "No reason provided"
      }
    });

    // Update seller product count
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: product.sellerId }
    });

    if (seller) {
      const newCount = Math.max(0, (seller.productCount || 1) - 1);
      await prisma.sellerProfile.update({
        where: { userId: product.sellerId },
        data: {
          productCount: newCount,
          minimumProductsUploaded: newCount >= 1
        }
      });
    }

    // Send notification to seller about product rejection
    await notifySellerProductStatusChange(product.sellerId, productId, "REJECTED", product.title, reason || "No specific reason provided");

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





