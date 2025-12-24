const prisma = require("../config/prisma");
const { sendOrderStatusEmail } = require("../utils/emailService");

const { 
  generateSalesReportCSV,
  generateSalesSummaryCSV 
} = require("../utils/csvExport");


// SELLER — VIEW ORDERS
exports.getSellerOrders = async (request, reply) => {
  try {
    const sellerId = request.user.userId; // From authenticateSeller middleware
    
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
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return reply.status(200).send({ success: true, orders, count: orders.length });
  } catch (error) {
    console.error("Get seller orders error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// SELLER — UPDATE ORDER STATUS (with SMS notification)
exports.updateOrderStatus = async (request, reply) => {
  try {
    const sellerId = request.user.userId; // From authenticateSeller middleware
    const { orderId } = request.params;
    const { status } = request.body;

    const statusMap = {
      'pending': 'PENDING',
      'confirmed': 'CONFIRMED',
      'packed': 'CONFIRMED',
      'shipped': 'SHIPPED',
      'delivered': 'DELIVERED',
      'cancelled': 'CANCELLED'
    };

    const normalizedStatus = statusMap[status.toLowerCase()];
    
    if (!normalizedStatus) {
      return reply.status(400).send({ success: false, message: "Invalid status. Use: pending, confirmed, shipped, delivered, cancelled" });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: true
          }
        },
        user: true
      }
    });

    if (!order) return reply.status(404).send({ success: false, message: "Order not found" });

    const containsSellerItem = order.items.some((item) => item.product.sellerId === sellerId);

    if (!containsSellerItem) {
      return reply.status(403).send({ success: false, message: "Unauthorized - this order doesn't contain your products" });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: normalizedStatus }
    });

    // Send email to customer about status update
    if (order.user && order.user.email) {
      console.log(`📧 Sending status update email to customer: ${order.user.email}`);
      
      sendOrderStatusEmail(order.user.email, order.user.name, {
        orderId,
        status
      }).catch(error => {
        console.error("Email error (non-blocking):", error.message);
      });
    }

    return reply.status(200).send({ success: true, message: "Order status updated successfully. Customer notified via email." });
  } catch (error) {
    console.error("Update order status error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// SELLER — UPDATE TRACKING INFO (with SMS notification)
exports.updateTrackingInfo = async (request, reply) => {
  try {
    const sellerId = request.user.userId; // From authenticateSeller middleware
    const { orderId } = request.params;
    const { trackingNumber, estimatedDelivery } = request.body;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: true
          }
        },
        user: true
      }
    });

    if (!order) return reply.status(404).send({ success: false, message: "Order not found" });

    const containsSellerItem = order.items.some((item) => item.product.sellerId === sellerId);

    if (!containsSellerItem) {
      return reply.status(403).send({ success: false, message: "Unauthorized - this order doesn't contain your products" });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        trackingNumber,
        estimatedDelivery: estimatedDelivery ? new Date(estimatedDelivery) : null,
        status: "SHIPPED" // Auto-update to shipped when tracking is added
      }
    });

    // Send email with tracking info
    if (order.user && order.user.email) {
      console.log(`📧 Sending tracking info email to customer: ${order.user.email}`);
      
      sendOrderStatusEmail(order.user.email, order.user.name, {
        orderId,
        status: "shipped",
        trackingNumber
      }).catch(error => {
        console.error("Email error (non-blocking):", error.message);
      });
    }

    return reply.status(200).send({ success: true, message: "Tracking info updated successfully. Customer notified via email." });

  } catch (error) {
    console.error("Update tracking info error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// SELLER — BULK UPDATE STOCK
exports.bulkUpdateStock = async (request, reply) => {
  try {
    const sellerId = request.user.userId; // From authenticateSeller middleware
    const updates = request.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return reply.status(400).send({ success: false, message: "Updates array is required" });
    }

    let results = [];

    for (const item of updates) {
      const { productId, stock } = item;

      if (!productId || stock === undefined) {
        results.push({ productId, success: false, message: "productId and stock are required" });
        continue;
      }

      const product = await prisma.product.findUnique({
        where: { id: productId }
      });

      if (!product) {
        results.push({ productId, success: false, message: "Product not found" });
        continue;
      }

      // Check seller ownership
      if (product.sellerId !== sellerId) {
        results.push({ productId, success: false, message: "Unauthorized seller" });
        continue;
      }

      const newStock = Number(stock);
      const newStatus = newStock > 0 ? "ACTIVE" : "INACTIVE";

      await prisma.product.update({
        where: { id: productId },
        data: {
          stock: newStock,
          status: newStatus
        }
      });

      results.push({
        productId,
        success: true,
        stock: newStock,
        status: newStatus,
        message: "Stock updated successfully"
      });
    }

    return reply.status(200).send({
      success: true,
      message: "Bulk stock update completed",
      results
    });

  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};





// SELLER — EXPORT SALES REPORT (CSV)
exports.exportSalesReport = async (request, reply) => {
  try {
    const sellerId = request.user.userId;
    const { startDate, endDate, reportType } = request.query;

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
      return reply.status(404).send({
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
    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);

    console.log(`📥 Sending CSV file: ${filename}`);

    return reply.send(csv);

  } catch (error) {
    console.error("Export sales report error:", error);
    return reply.status(500).send({ 
      success: false, 
      message: error.message || "Failed to generate sales report" 
    });
  }
};

// SELLER — GET SALES ANALYTICS
exports.getSalesAnalytics = async (request, reply) => {
  try {
    const sellerId = request.user.userId;
    const { startDate, endDate } = request.query;

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

    return reply.status(200).send({
      success: true,
      analytics
    });

  } catch (error) {
    console.error("Get sales analytics error:", error);
    return reply.status(500).send({ 
      success: false, 
      message: error.message || "Failed to fetch analytics" 
    });
  }
};



