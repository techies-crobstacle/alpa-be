const prisma = require("../config/prisma");
const { sendOrderStatusEmail } = require("../utils/emailService");
const { notifyCustomerOrderStatusChange, notifyAdminOrderStatusChange } = require("./notification");
const {
  normalizeOrderStatus,
  validateStatusTransition,
  VALID_TARGET_STATUSES
} = require("../utils/orderStatusRules");

const { 
  generateSalesReportCSV,
  generateSalesSummaryCSV 
} = require("../utils/csvExport");

// Helper function to map database status to display status
const mapStatusForDisplay = (dbStatus) => {
  const displayMap = {
    'PENDING': 'pending',
    'CONFIRMED': 'confirmed',
    'PROCESSING': 'processing',  // New status
    'SHIPPED': 'shipped',
    'DELIVERED': 'delivered',
    'CANCELLED': 'cancelled',
    'REFUND': 'refund',
    'PARTIAL_REFUND': 'partial_refund'
  };
  return displayMap[dbStatus] || dbStatus.toLowerCase();
};


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

    // Map database statuses to display statuses
    const ordersWithDisplayStatus = orders.map(order => ({
      ...order,
      status: mapStatusForDisplay(order.status)
    }));

    return reply.status(200).send({ success: true, orders: ordersWithDisplayStatus, count: orders.length });
  } catch (error) {
    console.error("Get seller orders error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// SELLER/ADMIN — UPDATE ORDER STATUS (with SMS notification)
exports.updateOrderStatus = async (request, reply) => {
  try {
    const userId = request.user.userId; // From auth middleware
    const userRole = request.user.role; // From auth middleware
    const { orderId } = request.params;
    const {
      status,
      trackingNumber,
      estimatedDelivery,
      reason,
      statusReason
    } = request.body;

    const normalizedStatus = normalizeOrderStatus(status);
    
    if (!normalizedStatus) {
      return reply.status(400).send({
        success: false,
        message: `Invalid status. Allowed values: ${VALID_TARGET_STATUSES.join(', ')}`
      });
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

    // Check authorization: admin can update any order, seller can only update orders containing their products
    if (userRole !== "ADMIN") {
      const containsSellerItem = order.items.some((item) => item.product.sellerId === userId);
      if (!containsSellerItem) {
        return reply.status(403).send({ success: false, message: "Unauthorized - this order doesn't contain your products" });
      }
    }

    const finalReason = (statusReason || reason || '').trim();
    const transitionValidation = validateStatusTransition({
      currentStatus: order.status,
      nextStatus: normalizedStatus,
      trackingNumber,
      estimatedDelivery,
      reason: finalReason
    });

    if (!transitionValidation.isValid) {
      return reply.status(400).send({
        success: false,
        message: transitionValidation.message
      });
    }

    const updateData = {
      status: normalizedStatus,
      statusReason: ['CANCELLED', 'REFUND', 'PARTIAL_REFUND'].includes(normalizedStatus)
        ? finalReason
        : null
    };

    if (normalizedStatus === 'SHIPPED') {
      updateData.trackingNumber = trackingNumber.trim();
      updateData.estimatedDelivery = new Date(estimatedDelivery);
    }

    await prisma.order.update({
      where: { id: orderId },
      data: updateData
    });

    // Send email to customer about status update (supports both logged-in and guest orders)
    const customerEmail = order.user?.email || order.customerEmail;
    const customerName  = order.user?.name  || order.customerName || 'Customer';
    if (customerEmail) {
      console.log(`📧 Sending status update email to customer: ${customerEmail}`);
      
      sendOrderStatusEmail(customerEmail, customerName, {
        orderId,
        status: normalizedStatus.toLowerCase(),
        reason: finalReason || undefined,
        trackingNumber: normalizedStatus === 'SHIPPED' ? trackingNumber : undefined,
        estimatedDelivery: normalizedStatus === 'SHIPPED' ? estimatedDelivery : undefined,
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        orderDate: order.createdAt,
        shippingName: order.customerName,
        shippingAddress: order.shippingAddressLine,
        shippingCity: order.shippingCity,
        shippingState: order.shippingState,
        shippingZipCode: order.shippingZipCode,
        shippingCountry: order.shippingCountry,
        shippingPhone: order.shippingPhone,
        products: order.items?.map(item => ({
          title: item.product?.title || 'Product',
          quantity: item.quantity,
          price: parseFloat(item.price)
        }))
      }).catch(error => {
        console.error("Email error (non-blocking):", error.message);
      });

      // Create notification for customer (only for logged-in users)
      if (order.user?.id) {
        console.log(`🔔 Creating status change notification for customer ${order.user.id}: ${status}`);
        notifyCustomerOrderStatusChange(order.user.id, orderId, normalizedStatus.toLowerCase(), {
          totalAmount: order.totalAmount.toString(),
          itemCount: order.items.length,
          reason: finalReason || undefined,
          trackingNumber: normalizedStatus === 'SHIPPED' ? trackingNumber : undefined,
          estimatedDelivery: normalizedStatus === 'SHIPPED' ? estimatedDelivery : undefined
        }).catch(error => {
          console.error("Customer notification error (non-blocking):", error.message);
        });
      }

      // Notify admins about status change (only if user is seller, not admin)
      if (userRole === "SELLER") {
        const seller = await prisma.user.findUnique({
          where: { id: userId },
          select: { name: true }
        });
        
        notifyAdminOrderStatusChange(orderId, normalizedStatus.toLowerCase(), {
          customerName: customerName,
          sellerName: seller?.name || 'Unknown',
          totalAmount: order.totalAmount.toString(),
          itemCount: order.items.length,
          reason: finalReason || undefined,
          trackingNumber: normalizedStatus === 'SHIPPED' ? trackingNumber : undefined,
          estimatedDelivery: normalizedStatus === 'SHIPPED' ? estimatedDelivery : undefined
        }).catch(error => {
          console.error("Admin notification error (non-blocking):", error.message);
        });
      }
    }

    return reply.status(200).send({ 
      success: true, 
      message: "Order status updated successfully. Customer notified via email.",
      updatedStatus: normalizedStatus
    });
  } catch (error) {
    console.error("Update order status error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// SELLER/ADMIN — UPDATE TRACKING INFO (with SMS notification)
exports.updateTrackingInfo = async (request, reply) => {
  try {
    const userId = request.user.userId; // From auth middleware
    const userRole = request.user.role; // From auth middleware
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

    // Check authorization: admin can update any order, seller can only update orders containing their products
    if (userRole !== "ADMIN") {
      const containsSellerItem = order.items.some((item) => item.product.sellerId === userId);
      if (!containsSellerItem) {
        return reply.status(403).send({ success: false, message: "Unauthorized - this order doesn't contain your products" });
      }
    }

    const transitionValidation = validateStatusTransition({
      currentStatus: order.status,
      nextStatus: 'SHIPPED',
      trackingNumber,
      estimatedDelivery,
      reason: null
    });

    if (!transitionValidation.isValid) {
      return reply.status(400).send({
        success: false,
        message: transitionValidation.message
      });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        trackingNumber,
        estimatedDelivery: estimatedDelivery ? new Date(estimatedDelivery) : null,
        status: "SHIPPED" // Auto-update to shipped when tracking is added
      }
    });

    // Send email with tracking info (supports both logged-in and guest orders)
    const customerEmail = order.user?.email || order.customerEmail;
    const customerName  = order.user?.name  || order.customerName || 'Customer';
    if (customerEmail) {
      console.log(`📧 Sending tracking info email to customer: ${customerEmail}`);
      
      sendOrderStatusEmail(customerEmail, customerName, {
        orderId,
        status: "shipped",
        trackingNumber,
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        orderDate: order.createdAt,
        estimatedDelivery: estimatedDelivery,
        shippingName: order.customerName,
        shippingAddress: order.shippingAddressLine,
        shippingCity: order.shippingCity,
        shippingState: order.shippingState,
        shippingZipCode: order.shippingZipCode,
        shippingCountry: order.shippingCountry,
        shippingPhone: order.shippingPhone,
        products: order.items?.map(item => ({
          title: item.product?.title || 'Product',
          quantity: item.quantity,
          price: parseFloat(item.price)
        }))
      }).catch(error => {
        console.error("Email error (non-blocking):", error.message);
      });

      // Create notification for customer about shipped status (only for logged-in users)
      if (order.user?.id) {
        console.log(`🔔 Creating shipped notification for customer ${order.user.id}`);
        notifyCustomerOrderStatusChange(order.user.id, orderId, "shipped", {
          totalAmount: order.totalAmount.toString(),
          itemCount: order.items.length,
          trackingNumber
        }).catch(error => {
          console.error("Customer notification error (non-blocking):", error.message);
        });
      }

      // Notify admins about shipped status (only if user is seller, not admin)
      if (userRole === "SELLER") {
        const seller = await prisma.user.findUnique({
          where: { id: userId },
          select: { name: true }
        });
        
        notifyAdminOrderStatusChange(orderId, "shipped", {
          customerName: customerName,
          sellerName: seller?.name || 'Unknown',
          totalAmount: order.totalAmount.toString(),
          itemCount: order.items.length,
          trackingNumber
        }).catch(error => {
          console.error("Admin notification error (non-blocking):", error.message);
        });
      }
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





// SELLER — EXPORT SALES REPORT (CSV) [PRISMA VERSION]
exports.exportSalesReport = async (request, reply) => {
  try {
    const sellerId = request.user.userId;
    const { startDate, endDate, reportType } = request.query;

    console.log(`📊 Generating ${reportType || 'detailed'} sales report for seller: ${sellerId}`);

    // Build Prisma query for orders containing seller's products
    const orderWhere = {
      items: {
        some: {
          product: {
            sellerId: sellerId
          }
        }
      }
    };
    if (startDate || endDate) {
      orderWhere.createdAt = {};
      if (startDate) {
        orderWhere.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        orderWhere.createdAt.lte = end;
      }
    }

    const orders = await prisma.order.findMany({
      where: orderWhere,
      include: {
        items: {
          include: {
            product: true
          }
        },
        user: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Filter and format orders to only include seller's products
    const sellerOrders = orders.map(order => {
      const sellerProducts = order.items.filter(item => item.product.sellerId === sellerId);
      if (sellerProducts.length === 0) return null;
      // Enrich order with customer details
      const customerName = order.user?.name || 'N/A';
      const customerEmail = order.user?.email || 'N/A';
      const customerPhone = order.user?.phone || 'N/A';
      // If shippingAddress is an object, add phone if missing
      let shippingAddress = order.shippingAddress;
      if (shippingAddress && typeof shippingAddress === 'object' && !shippingAddress.phone) {
        shippingAddress.phone = customerPhone;
      }
      return {
        ...order,
        products: sellerProducts.map(item => ({
          ...item.product,
          quantity: item.quantity,
          price: item.price
        })),
        customerName,
        customerEmail,
        customerPhone,
        shippingAddress
      };
    }).filter(Boolean);

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

// SELLER — GET SALES ANALYTICS [PRISMA VERSION]
exports.getSalesAnalytics = async (request, reply) => {
  try {
    const sellerId = request.user.userId;
    const { startDate, endDate } = request.query;

    console.log(`📊 Fetching sales analytics for seller: ${sellerId}`);

    // Build Prisma query for orders containing seller's products
    const orderWhere = {
      items: {
        some: {
          product: {
            sellerId: sellerId
          }
        }
      }
    };
    if (startDate || endDate) {
      orderWhere.createdAt = {};
      if (startDate) {
        orderWhere.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        orderWhere.createdAt.lte = end;
      }
    }

    const orders = await prisma.order.findMany({
      where: orderWhere,
      include: {
        items: {
          include: {
            product: true
          }
        }
      }
    });

    let totalRevenue = 0;
    let totalOrders = 0;
    let totalItemsSold = 0;
    const statusBreakdown = {
      PENDING: 0,
      CONFIRMED: 0,  // Legacy status
      PROCESSING: 0,  // New status
      SHIPPED: 0,
      DELIVERED: 0,
      CANCELLED: 0
    };
    const productPerformance = new Map();

    for (const order of orders) {
      const sellerProducts = order.items.filter(item => item.product.sellerId === sellerId);
      if (sellerProducts.length > 0) {
        totalOrders += 1;
        statusBreakdown[order.status] = (statusBreakdown[order.status] || 0) + 1;
        for (const item of sellerProducts) {
          totalRevenue += Number(item.price) * item.quantity;
          totalItemsSold += item.quantity;
          // Track product performance
          if (!productPerformance.has(item.productId)) {
            productPerformance.set(item.productId, {
              title: item.product.title,
              quantitySold: 0,
              revenue: 0
            });
          }
          const perfData = productPerformance.get(item.productId);
          perfData.quantitySold += item.quantity;
          perfData.revenue += Number(item.price) * item.quantity;
        }
      }
    }

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



