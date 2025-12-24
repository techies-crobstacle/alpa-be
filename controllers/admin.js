const prisma = require("../config/prisma");

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
        id: seller.id,
        userId: seller.userId,
        businessName: seller.businessName,
        storeName: seller.storeName,
        status: seller.status,
        productCount: seller.productCount,
        ...seller
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
      where: { sellerId }
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
        status: "APPROVED",
        approvedAt: new Date()
      }
    });

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
        status: "REJECTED",
        rejectionReason: reason || "Not specified",
        rejectedAt: new Date()
      }
    });

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
      where: { userId: id }
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





