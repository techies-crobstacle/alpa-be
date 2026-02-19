const prisma = require("../config/prisma");
const { generateSalesReportCSV } = require("../utils/csvExport");
const {
  notifySellerApproved,
  notifySellerApprovalRejected,
  notifySellerCulturalApproval,
  notifySellerProductRecommendation
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
            createdAt: true,
            products: {
              include: {
                ratings: true
              }
            }
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

    const products = seller.user.products;

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
        
        // Cultural Info
        culturalBackground: seller.culturalBackground,
        culturalStory: seller.culturalStory,
        culturalApprovalStatus: seller.culturalApprovalStatus,
        culturalApprovalAt: seller.culturalApprovalAt,
        culturalApprovalFeedback: seller.culturalApprovalFeedback,
        culturalApprovalBy: seller.culturalApprovalBy,
        
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

    const products = await prisma.product.findMany({
      where: { sellerId },
      select: {
        id: true,
        title: true,
        description: true,
        price: true,
        stock: true,
        category: true,
        images: true,
        status: true,
        featured: true,
        tags: true,
        sellerName: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

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

// CULTURAL APPROVAL
exports.culturalApproval = async (request, reply) => {
  try {
    const { id } = request.params;
    const { approved, feedback } = request.body;
    const adminId = request.user?.userId || "admin";

    console.log("Cultural approval request - ID:", id);
    console.log("Approved value:", approved, "Type:", typeof approved);
    console.log("Admin ID:", adminId);

    // Convert string "yes"/"no" to boolean
    let isApproved = false;
    if (typeof approved === "boolean") {
      isApproved = approved;
    } else if (typeof approved === "string") {
      isApproved = approved.toLowerCase() === "yes" || approved.toLowerCase() === "true";
    }

    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: id },
      include: { user: true }
    });

    if (!seller) {
      return reply.status(404).send({
        success: false,
        message: "Seller not found"
      });
    }

    console.log("Seller status:", seller.status);

    if (seller.status !== "APPROVED") {
      return reply.status(400).send({
        success: false,
        message: "Seller must be approved before cultural approval"
      });
    }

    const updateData = {
      culturalApprovalStatus: isApproved ? "APPROVED" : "REJECTED",
      culturalApprovalAt: new Date(),
      culturalApprovalFeedback: feedback || ""
    };

    // Only add culturalApprovalBy if adminId exists and is not default
    if (adminId && adminId !== "admin") {
      updateData.culturalApprovalBy = adminId;
    }

    console.log("Updating with data:", updateData);

    const updatedSeller = await prisma.sellerProfile.update({
      where: { userId: id },
      data: updateData
    });

    // Send cultural approval notification
    await notifySellerCulturalApproval(
      id, 
      isApproved, 
      feedback || "", 
      seller.user.name
    );

    // If approved, also send product recommendation notification
    if (isApproved) {
      await notifySellerProductRecommendation(id, seller.user.name);
      console.log(`📬 Product recommendation notification sent to seller ${id}`);
    }

    reply.status(200).send({
      success: true,
      message: isApproved 
        ? "Cultural approval granted. Seller can now go live if minimum products are uploaded." 
        : "Cultural approval rejected. Feedback provided to seller.",
      seller: updatedSeller
    });
  } catch (error) {
    console.error("Cultural approval error:", error);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    reply.status(500).send({ success: false, message: "Server error", error: error.message });
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

    if (seller.culturalApprovalStatus !== "APPROVED") {
      return reply.status(400).send({
        success: false,
        message: "Cultural approval is required before activation"
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

    const { code, discount, expiresAt } = request.body;

    if (!code || !discount || !expiresAt) {
      return reply.status(400).send({
        success: false,
        message: 'Coupon code, discount percentage, and expiry date are required'
      });
    }

    if (discount <= 0 || discount > 100) {
      return reply.status(400).send({
        success: false,
        message: 'Discount must be between 1 and 100 percent'
      });
    }

    // Check if coupon code already exists
    const existingCoupon = await prisma.coupon.findUnique({
      where: { code: code.toUpperCase() }
    });

    if (existingCoupon) {
      return reply.status(400).send({
        success: false,
        message: 'Coupon code already exists'
      });
    }

    const coupon = await prisma.coupon.create({
      data: {
        code: code.toUpperCase(),
        discount: parseFloat(discount),
        expiresAt: new Date(expiresAt),
        createdBy: request.user.userId || request.user.uid
      }
    });

    reply.status(201).send({
      success: true,
      message: 'Coupon created successfully',
      coupon
    });
  } catch (error) {
    console.error('Create coupon error:', error);
    reply.status(500).send({ success: false, error: error.message });
  }
};

// GET ALL COUPONS (Admin only)
exports.getAllCoupons = async (request, reply) => {
  try {
    // Allow all authenticated users to access
    if (!request.user) {
      return reply.status(403).send({ message: 'Access denied. Login required.' });
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

// UPDATE COUPON (Admin only)
exports.updateCoupon = async (request, reply) => {
  try {
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }

    const { id } = request.params;
    const { code, discount, expiresAt } = request.body;

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

    // Prepare update data
    const updateData = {};
    if (code) updateData.code = code.toUpperCase();
    if (discount !== undefined) {
      if (discount <= 0 || discount > 100) {
        return reply.status(400).send({
          success: false,
          message: 'Discount must be between 1 and 100 percent'
        });
      }
      updateData.discount = parseFloat(discount);
    }
    if (expiresAt) updateData.expiresAt = new Date(expiresAt);

    // Check if new code conflicts with existing codes (if code is being updated)
    if (code && code.toUpperCase() !== existingCoupon.code) {
      const conflictingCoupon = await prisma.coupon.findUnique({
        where: { code: code.toUpperCase() }
      });
      if (conflictingCoupon) {
        return reply.status(400).send({
          success: false,
          message: 'Coupon code already exists'
        });
      }
    }

    const updatedCoupon = await prisma.coupon.update({
      where: { id },
      data: updateData
    });

    reply.send({
      success: true,
      message: 'Coupon updated successfully',
      coupon: updatedCoupon
    });
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
      return reply.status(400).send({
        success: false,
        message: 'Coupon code is required'
      });
    }

    const coupon = await prisma.coupon.findUnique({
      where: { code: code.toUpperCase() }
    });

    if (!coupon) {
      return reply.status(404).send({
        success: false,
        message: 'Invalid coupon code'
      });
    }

    // Check if coupon is expired
    if (new Date() > coupon.expiresAt) {
      return reply.status(400).send({
        success: false,
        message: 'Coupon has expired'
      });
    }

    // Validate orderTotal and calculate discount if provided
    let discountAmount = null;
    if (orderTotal !== undefined) {
      const total = parseFloat(orderTotal);
      if (isNaN(total) || total <= 0) {
        return reply.status(400).send({
          success: false,
          message: 'Order total must be a positive number'
        });
      }
      discountAmount = parseFloat(((total * coupon.discount) / 100).toFixed(2));
    }

    reply.send({
      success: true,
      message: 'Coupon is valid',
      coupon: {
        id: coupon.id,
        code: coupon.code,
        discount: coupon.discount,
        expiresAt: coupon.expiresAt,
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
      customerEmail: order.user?.email,
      customerPhone: order.user?.phone,
      shippingAddress: order.shippingAddress,
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

    const products = await prisma.product.findMany({
      where: {
        status: "PENDING" // Use status until Prisma client recognizes isActive
      },
      orderBy: {
        createdAt: 'desc'
      },
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

    reply.send({ 
      success: true, 
      products, 
      count: products.length,
      message: `${products.length} products pending approval`
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

    // TODO: Send notification to seller about product approval
    // notifySellerProductApproved(product.sellerId, productId, product.title);

    reply.send({
      success: true,
      message: "Product approved successfully",
      product: approvedProduct
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
    const { reason } = request.body; // Optional rejection reason

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

    // Option 1: Keep product but mark as rejected (you can choose this instead)
    // const rejectedProduct = await prisma.product.update({
    //   where: { id: productId },
    //   data: {
    //     isActive: false,
    //     status: "INACTIVE",
    //     rejectionReason: reason
    //   }
    // });

    // Option 2: Delete the product (current implementation)
    await prisma.product.delete({
      where: { id: productId }
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

    // TODO: Send notification to seller about product rejection
    // notifySellerProductRejected(product.sellerId, product.title, reason);

    reply.send({
      success: true,
      message: "Product rejected and removed",
      reason: reason || "No reason provided"
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

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return reply.status(404).send({ success: false, message: 'Product not found' });
    }

    await prisma.product.update({
      where: { id: productId },
      data: { status: 'INACTIVE' }
    });

    await prisma.$executeRaw`UPDATE "products" SET "isActive" = false WHERE "id" = ${productId}`;

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





