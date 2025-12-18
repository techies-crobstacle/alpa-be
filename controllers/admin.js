const { db } = require("../config/firebase");

// GET ALL USERS (role: "user")
exports.getAllUsers = async (request, reply) => {
  try {
    const snap = await db.collection("users").where("role", "==", "user").get();
    const users = snap.docs.map(doc => {
      const data = doc.data();
      return { id: data.uid || doc.id, ...data };
    });

    return reply.status(200).json({ success: true, users, count: users.length });
  } catch (err) {
    reply.status(500).json({ success: false, error: err.message });
  }
};

// GET ALL SELLERS (from sellers collection)
exports.getAllSellers = async (request, reply) => {
  try {
    const snap = await db.collection("sellers").get();
    const sellers = snap.docs.map(doc => {
      const data = doc.data();
      return { 
        id: doc.id,
        sellerId: doc.id,
        email: data.email,
        businessName: data.businessName,
        storeName: data.storeName,
        contactPerson: data.contactPerson,
        phone: data.phone,
        businessType: data.businessType,
        abn: data.abn,
        address: data.address,
        city: data.city,
        state: data.state,
        postcode: data.postcode,
        country: data.country,
        productCount: data.productCount || 0,
        status: data.status,
        accountStatus: data.accountStatus,
        kycStatus: data.kycStatus,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        approvedAt: data.approvedAt,
        bankDetails: data.bankDetails || null,
        documents: data.documents || null
      };
    });

    return reply.status(200).json({ 
      success: true, 
      sellers,
      count: sellers.length 
    });
  } catch (err) {
    reply.status(500).json({ success: false, error: err.message });
  }
};

// GET SINGLE SELLER DETAILS
exports.getSellerDetails = async (request, reply) => {
  try {
    const { sellerId } = request.params;
    
    const sellerDoc = await db.collection("sellers").doc(sellerId).get();
    
    if (!sellerDoc.exists) {
      return reply.status(404).json({ 
        success: false, 
        message: "Seller not found" 
      });
    }

    const sellerData = sellerDoc.data();

    // Get seller's products
    const productsSnap = await db.collection("products")
      .where("sellerId", "==", sellerId)
      .get();
    
    const products = productsSnap.docs.map(doc => ({ 
      id: doc.id, 
      ...doc.data() 
    }));

    // Get seller's orders
    const ordersSnap = await db.collection("orders").get();
    const orders = [];
    
    ordersSnap.forEach(doc => {
      const order = doc.data();
      const hasSellerProduct = order.products && order.products.some(p => p.sellerId === sellerId);
      if (hasSellerProduct) {
        orders.push({ id: doc.id, ...order });
      }
    });

    return reply.status(200).json({ 
      success: true, 
      seller: {
        id: sellerDoc.id,
        ...sellerData
      },
      products,
      orders,
      statistics: {
        totalProducts: products.length,
        totalOrders: orders.length,
        activeProducts: products.filter(p => p.status === "active").length,
        pendingOrders: orders.filter(o => o.status === "pending").length
      }
    });
  } catch (err) {
    reply.status(500).json({ success: false, error: err.message });
  }
};

// GET PRODUCTS OF A SPECIFIC SELLER
exports.getProductsBySeller = async (request, reply) => {
  try {
    const { sellerId } = request.params;
    
    // Check if seller exists
    const sellerDoc = await db.collection("sellers").doc(sellerId).get();
    if (!sellerDoc.exists) {
      return reply.status(404).json({ 
        success: false, 
        message: "Seller not found" 
      });
    }

    const snap = await db.collection("products")
      .where("sellerId", "==", sellerId)
      .get();
    
    const products = snap.docs.map(doc => ({ 
      id: doc.id, 
      ...doc.data() 
    }));

    return reply.status(200).json({ 
      success: true, 
      products,
      count: products.length,
      seller: {
        id: sellerDoc.id,
        businessName: sellerDoc.data().businessName,
        storeName: sellerDoc.data().storeName
      }
    });
  } catch (err) {
    reply.status(500).json({ success: false, error: err.message });
  }
};

// GET PENDING SELLER APPROVALS
exports.getPendingSellers = async (request, reply) => {
  try {
    const snap = await db.collection("sellers")
      .where("status", "==", "pending")
      .get();
    
    const pendingSellers = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return reply.status(200).json({ 
      success: true, 
      sellers: pendingSellers,
      count: pendingSellers.length 
    });
  } catch (err) {
    reply.status(500).json({ success: false, error: err.message });
  }
};

// APPROVE SELLER
exports.approveSeller = async (request, reply) => {
  try {
    const { sellerId } = request.params;
    
    const sellerDoc = await db.collection("sellers").doc(sellerId).get();
    
    if (!sellerDoc.exists) {
      return reply.status(404).json({ 
        success: false, 
        message: "Seller not found" 
      });
    }

    await db.collection("sellers").doc(sellerId).update({
      status: "approved",
      accountStatus: "active",
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    return reply.status(200).json({ 
      success: true, 
      message: "Seller approved successfully" 
    });
  } catch (err) {
    reply.status(500).json({ success: false, error: err.message });
  }
};

// REJECT SELLER
exports.rejectSeller = async (request, reply) => {
  try {
    const { sellerId } = request.params;
    const { reason } = request.body;
    
    const sellerDoc = await db.collection("sellers").doc(sellerId).get();
    
    if (!sellerDoc.exists) {
      return reply.status(404).json({ 
        success: false, 
        message: "Seller not found" 
      });
    }

    await db.collection("sellers").doc(sellerId).update({
      status: "rejected",
      accountStatus: "inactive",
      rejectionReason: reason || "Not specified",
      rejectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    return reply.status(200).json({ 
      success: true, 
      message: "Seller rejected" 
    });
  } catch (err) {
    reply.status(500).json({ success: false, error: err.message });
  }
};

// SUSPEND SELLER
exports.suspendSeller = async (request, reply) => {
  try {
    const { sellerId } = request.params;
    const { reason } = request.body;
    
    const sellerDoc = await db.collection("sellers").doc(sellerId).get();
    
    if (!sellerDoc.exists) {
      return reply.status(404).json({ 
        success: false, 
        message: "Seller not found" 
      });
    }

    await db.collection("sellers").doc(sellerId).update({
      status: "suspended",
      accountStatus: "suspended",
      suspensionReason: reason || "Not specified",
      suspendedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    return reply.status(200).json({ 
      success: true, 
      message: "Seller suspended" 
    });
  } catch (err) {
    reply.status(500).json({ success: false, error: err.message });
  }
};

// UPDATE SELLER NOTES
exports.updateSellerNotes = async (request, reply) => {
  try {
    const { id } = request.params;
    const { notes } = request.body;

    const sellerDoc = await db.collection("sellers").doc(id).get();
    
    if (!sellerDoc.exists) {
      return reply.status(404).json({ 
        success: false, 
        message: "Seller not found" 
      });
    }

    await db.collection("sellers").doc(id).update({
      adminNotes: notes || "",
      updatedAt: new Date().toISOString()
    });

    reply.status(200).json({
      success: true,
      message: "Notes updated successfully"
    });
  } catch (error) {
    console.error("Update seller notes error:", error);
    reply.status(500).json({ success: false, message: "Server error" });
  }
};

// CULTURAL APPROVAL
exports.culturalApproval = async (request, reply) => {
  try {
    const { id } = request.params;
    const { approved, feedback } = request.body;
    const adminId = request.userId || request.user?.uid || "admin";

    console.log("Cultural approval request - ID:", id);
    console.log("Approved value:", approved, "Type:", typeof approved);
    console.log("Admin ID:", adminId);
    console.log("request.userId:", request.userId);
    console.log("request.user:", request.user);

    // Convert string "yes"/"no" to boolean
    let isApproved = false;
    if (typeof approved === "boolean") {
      isApproved = approved;
    } else if (typeof approved === "string") {
      isApproved = approved.toLowerCase() === "yes" || approved.toLowerCase() === "true";
    }

    const sellerDoc = await db.collection("sellers").doc(id).get();

    if (!sellerDoc.exists) {
      return reply.status(404).json({
        success: false,
        message: "Seller not found"
      });
    }

    const seller = sellerDoc.data();
    console.log("Seller status:", seller.status);

    if (seller.status !== "approved") {
      return reply.status(400).json({
        success: false,
        message: "Seller must be approved before cultural approval"
      });
    }

    const updateData = {
      culturalApprovalStatus: isApproved ? "approved" : "rejected",
      culturalApprovalAt: new Date().toISOString(),
      culturalApprovalFeedback: feedback || "",
      updatedAt: new Date().toISOString()
    };

    // Only add culturalApprovalBy if adminId exists
    if (adminId && adminId !== "admin") {
      updateData.culturalApprovalBy = adminId;
    }

    console.log("Updating with data:", updateData);

    await db.collection("sellers").doc(id).update(updateData);

    const updatedSeller = await db.collection("sellers").doc(id).get();

    reply.status(200).json({
      success: true,
      message: isApproved 
        ? "Cultural approval granted. Seller can now go live if minimum products are uploaded." 
        : "Cultural approval rejected. Feedback provided to seller.",
      seller: { id: updatedSeller.id, ...updatedSeller.data() }
    });
  } catch (error) {
    console.error("Cultural approval error:", error);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    reply.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ACTIVATE SELLER (GO LIVE)
exports.activateSeller = async (request, reply) => {
  try {
    const { id } = request.params;
    const adminId = request.userId;

    const sellerDoc = await db.collection("sellers").doc(id).get();

    if (!sellerDoc.exists) {
      return reply.status(404).json({
        success: false,
        message: "Seller not found"
      });
    }

    const seller = sellerDoc.data();

    // Validation checks
    if (seller.status !== "approved") {
      return reply.status(400).json({
        success: false,
        message: "Seller must be approved before activation"
      });
    }

    if (seller.productCount < 1) {
      return reply.status(400).json({
        success: false,
        message: "Seller must upload at least 1-2 products before going live. 5+ products recommended."
      });
    }

    if (seller.culturalApprovalStatus !== "approved") {
      return reply.status(400).json({
        success: false,
        message: "Cultural approval is required before activation"
      });
    }

    // Update seller to active status
    await db.collection("sellers").doc(id).update({
      status: "active",
      accountStatus: "active",
      activatedBy: adminId || "admin",
      activatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // Activate all seller's products (change from pending to active)
    const productsSnap = await db.collection("products")
      .where("sellerId", "==", id)
      .where("status", "==", "pending")
      .get();

    const batch = db.batch();
    let activatedCount = 0;
    
    productsSnap.docs.forEach(doc => {
      batch.update(doc.ref, { 
        status: "active",
        updatedAt: new Date().toISOString()
      });
      activatedCount++;
    });

    await batch.commit();

    const updatedSeller = await db.collection("sellers").doc(id).get();
    const seller_data = { id: updatedSeller.id, ...updatedSeller.data() };

    reply.status(200).json({
      success: true,
      message: `Seller is now LIVE! ${activatedCount} products activated and visible to customers.`,
      seller: seller_data,
      productsActivated: activatedCount
    });
  } catch (error) {
    console.error("Activate seller error:", error);
    reply.status(500).json({ success: false, message: "Server error" });
  }
};



