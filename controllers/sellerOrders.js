const { db, admin } = require("../config/firebase");
const { sendOrderStatusEmail } = require("../utils/emailService");

const { 
  generateSalesReportCSV,
  generateSalesSummaryCSV 
} = require("../utils/csvExport");


// SELLER — VIEW ORDERS
exports.getSellerOrders = async (req, res) => {
  try {
    const sellerId = req.sellerId; // From authenticateSeller middleware
    const snapshot = await db.collection("orders").get();

    let sellerOrders = [];

    snapshot.forEach((doc) => {
      const order = { id: doc.id, ...doc.data() };
      const containsSellerItem = order.products && order.products.some(
        (p) => p.sellerId === sellerId
      );
      if (containsSellerItem) sellerOrders.push(order);
    });

    return res.status(200).json({ success: true, orders: sellerOrders, count: sellerOrders.length });
  } catch (error) {
    console.error("Get seller orders error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// SELLER — UPDATE ORDER STATUS (with SMS notification)
exports.updateOrderStatus = async (req, res) => {
  try {
    const sellerId = req.sellerId; // From authenticateSeller middleware
    const { orderId } = req.params;
    const { status } = req.body;

    const allowed = ["pending", "packed", "shipped", "delivered", "cancelled"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const orderRef = db.collection("orders").doc(orderId);
    const snap = await orderRef.get();

    if (!snap.exists) return res.status(404).json({ success: false, message: "Order not found" });

    const order = snap.data();
    const containsSellerItem = order.products && order.products.some((p) => p.sellerId === sellerId);

    if (!containsSellerItem) {
      return res.status(403).json({ success: false, message: "Unauthorized - this order doesn't contain your products" });
    }

    await orderRef.update({ 
      status, 
      updatedAt: admin.firestore.FieldValue.serverTimestamp() 
    });

    // Send email to customer about status update
    try {
      const userDoc = await db.collection("users").doc(order.userId).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        const userEmail = userData.email;
        const userName = userData.name || userData.displayName || 'Customer';
        if (userEmail) {
          console.log(`📧 Sending status update email to customer: ${userEmail}`);
          
          sendOrderStatusEmail(userEmail, userName, {
            orderId,
            status
          }).catch(error => {
            console.error("Email error (non-blocking):", error.message);
          });
        }
      }
    } catch (emailError) {
      console.error("Error sending status email (non-blocking):", emailError.message);
    }

    return res.status(200).json({ success: true, message: "Order status updated successfully. Customer notified via email." });
  } catch (error) {
    console.error("Update order status error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// SELLER — UPDATE TRACKING INFO (with SMS notification)
exports.updateTrackingInfo = async (req, res) => {
  try {
    const sellerId = req.sellerId; // From authenticateSeller middleware
    const { orderId } = req.params;
    const { trackingNumber, estimatedDelivery } = req.body;

    const orderRef = db.collection("orders").doc(orderId);
    const snap = await orderRef.get();

    if (!snap.exists) return res.status(404).json({ success: false, message: "Order not found" });

    const order = snap.data();
    const containsSellerItem = order.products && order.products.some((p) => p.sellerId === sellerId);

    if (!containsSellerItem) {
      return res.status(403).json({ success: false, message: "Unauthorized - this order doesn't contain your products" });
    }

    await orderRef.update({
      trackingNumber,
      estimatedDelivery,
      status: "shipped", // Auto-update to shipped when tracking is added
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Send email with tracking info
    try {
      const userDoc = await db.collection("users").doc(order.userId).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        const userEmail = userData.email;
        const userName = userData.name || userData.displayName || 'Customer';
        if (userEmail) {
          console.log(`📧 Sending tracking info email to customer: ${userEmail}`);
          
          sendOrderStatusEmail(userEmail, userName, {
            orderId,
            status: "shipped",
            trackingNumber
          }).catch(error => {
            console.error("Email error (non-blocking):", error.message);
          });
        }
      }
    } catch (emailError) {
      console.error("Error sending tracking email (non-blocking):", emailError.message);
    }

    return res.status(200).json({ success: true, message: "Tracking info updated successfully. Customer notified via email." });

  } catch (error) {
    console.error("Update tracking info error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// SELLER — BULK UPDATE STOCK
exports.bulkUpdateStock = async (req, res) => {
  try {
    const sellerId = req.sellerId; // From authenticateSeller middleware
    const updates = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ success: false, message: "Updates array is required" });
    }

    let results = [];

    for (const item of updates) {
      const { productId, stock } = item;

      if (!productId || stock === undefined) {
        results.push({ productId, success: false, message: "productId and stock are required" });
        continue;
      }

      const productRef = db.collection("products").doc(productId);
      const productSnap = await productRef.get();

      if (!productSnap.exists) {
        results.push({ productId, success: false, message: "Product not found" });
        continue;
      }

      const product = productSnap.data();

      // Check seller ownership
      if (product.sellerId !== sellerId) {
        results.push({ productId, success: false, message: "Unauthorized seller" });
        continue;
      }

      const newStock = Number(stock);
      const isActive = newStock > 0;

      await productRef.update({
        stock: newStock,
        active: isActive,
        updatedAt: new Date()
      });

      results.push({
        productId,
        success: true,
        stock: newStock,
        active: isActive,
        message: "Stock updated successfully"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Bulk stock update completed",
      results
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};





// SELLER — EXPORT SALES REPORT (CSV)
exports.exportSalesReport = async (req, res) => {
  try {
    const sellerId = req.sellerId;
    const { startDate, endDate, reportType } = req.query;

    console.log(`📊 Generating ${reportType || 'detailed'} sales report for seller: ${sellerId}`);

    // Build query
    let query = db.collection("orders");

    // Date filtering
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      query = query.where("createdAt", ">=", start);
    }

    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query = query.where("createdAt", "<=", end);
    }

    const snapshot = await query.get();
    
    // Filter orders containing seller's products and enrich with customer data
    const sellerOrders = [];
    
    for (const doc of snapshot.docs) {
      const order = { id: doc.id, ...doc.data() };
      const sellerProducts = order.products.filter(p => p.sellerId === sellerId);
      
      if (sellerProducts.length > 0) {
        // Fetch customer data to enrich order information
        try {
          const userDoc = await db.collection("users").doc(order.userId).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            
            // Enrich order with customer details
            order.customerName = userData.name || userData.displayName || 'N/A';
            order.customerEmail = userData.email || 'N/A';
            order.customerPhone = userData.phone || userData.mobile || 'N/A';
            
            // If shipping address doesn't have phone, use customer's phone
            if (order.shippingAddress && !order.shippingAddress.phone) {
              order.shippingAddress.phone = order.customerPhone;
            }
          }
        } catch (userError) {
          console.error(`Error fetching user data for order ${order.id}:`, userError.message);
        }
        
        // Only include seller's products in this order
        sellerOrders.push({
          ...order,
          products: sellerProducts
        });
      }
    }

    if (sellerOrders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No sales data found for the specified period"
      });
    }

    console.log(`✅ Found ${sellerOrders.length} orders for seller`);

    // Generate CSV based on report type
    let csv;
    let filename;

    if (reportType === 'summary') {
      csv = generateSalesSummaryCSV(sellerOrders, sellerId);
      filename = `sales-summary-${sellerId}-${Date.now()}.csv`;
    } else {
      csv = generateSalesReportCSV(sellerOrders);
      filename = `sales-report-${sellerId}-${Date.now()}.csv`;
    }

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    console.log(`📥 Sending CSV file: ${filename}`);

    return res.status(200).send(csv);

  } catch (error) {
    console.error("Export sales report error:", error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || "Failed to generate sales report" 
    });
  }
};

// SELLER — GET SALES ANALYTICS
exports.getSalesAnalytics = async (req, res) => {
  try {
    const sellerId = req.sellerId;
    const { startDate, endDate } = req.query;

    console.log(`📊 Fetching sales analytics for seller: ${sellerId}`);

    let query = db.collection("orders");

    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      query = query.where("createdAt", ">=", start);
    }

    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query = query.where("createdAt", "<=", end);
    }

    const snapshot = await query.get();

    let totalRevenue = 0;
    let totalOrders = 0;
    let totalItemsSold = 0;
    const statusBreakdown = {
      pending: 0,
      packed: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0
    };
    const productPerformance = new Map();

    snapshot.forEach(doc => {
      const order = doc.data();
      const sellerProducts = order.products.filter(p => p.sellerId === sellerId);

      if (sellerProducts.length > 0) {
        totalOrders += 1;
        statusBreakdown[order.status] = (statusBreakdown[order.status] || 0) + 1;

        sellerProducts.forEach(product => {
          totalRevenue += product.price * product.quantity;
          totalItemsSold += product.quantity;

          // Track product performance
          if (!productPerformance.has(product.productId)) {
            productPerformance.set(product.productId, {
              title: product.title,
              quantitySold: 0,
              revenue: 0
            });
          }

          const perfData = productPerformance.get(product.productId);
          perfData.quantitySold += product.quantity;
          perfData.revenue += product.price * product.quantity;
        });
      }
    });

    // Get top 5 performing products
    const topProducts = Array.from(productPerformance.entries())
      .map(([productId, data]) => ({
        productId,
        ...data
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const analytics = {
      totalRevenue: totalRevenue.toFixed(2),
      totalOrders,
      totalItemsSold,
      averageOrderValue: totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : '0.00',
      statusBreakdown,
      topProducts,
      period: {
        startDate: startDate || 'All time',
        endDate: endDate || 'Present'
      }
    };

    console.log(`✅ Analytics generated for seller: ${sellerId}`);

    return res.status(200).json({
      success: true,
      analytics
    });

  } catch (error) {
    console.error("Get sales analytics error:", error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || "Failed to fetch analytics" 
    });
  }
};