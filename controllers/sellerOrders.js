const prisma = require("../config/prisma");
const { sendOrderStatusEmail, sendSellerOrderStatusEmail, sendAdminOrderStatusEmail } = require("../utils/emailService");
const { notifyCustomerOrderStatusChange, notifyAdminOrderStatusChange, notifySellerOrderStatusChange } = require("./notification");
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
  // Handle undefined/null values
  if (!dbStatus) return 'pending';
  
  // Ensure dbStatus is a string
  if (typeof dbStatus !== 'string') return 'pending';
  
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
    
    // Get sub-orders for this seller only (with parent order information)
    const subOrders = await prisma.subOrder.findMany({
      where: {
        sellerId: sellerId
      },
      include: {
        items: {
          include: {
            product: true
          }
        },
        parentOrder: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Transform sub-orders to look like regular orders for backward compatibility
    const ordersWithDisplayStatus = subOrders.map(subOrder => ({
      id: subOrder.id,
      parentOrderId: subOrder.parentOrderId,
      status: mapStatusForDisplay(subOrder.status),
      trackingNumber: subOrder.trackingNumber,
      estimatedDelivery: subOrder.estimatedDelivery,
      statusReason: subOrder.statusReason,
      subtotal: subOrder.subtotal,
      items: subOrder.items, // Only this seller's items
      user: subOrder.parentOrder.user,
      customerName: subOrder.parentOrder.customerName,
      customerEmail: subOrder.parentOrder.customerEmail,
      customerPhone: subOrder.parentOrder.customerPhone,
      shippingAddress: subOrder.parentOrder.shippingAddress,
      shippingAddressLine: subOrder.parentOrder.shippingAddressLine,
      shippingCity: subOrder.parentOrder.shippingCity,
      shippingState: subOrder.parentOrder.shippingState,
      shippingZipCode: subOrder.parentOrder.shippingZipCode,
      shippingCountry: subOrder.parentOrder.shippingCountry,
      shippingPhone: subOrder.parentOrder.shippingPhone,
      paymentMethod: subOrder.parentOrder.paymentMethod,
      paymentStatus: subOrder.parentOrder.paymentStatus,
      createdAt: subOrder.createdAt,
      updatedAt: subOrder.updatedAt
    }));

    return reply.status(200).send({ 
      success: true, 
      orders: ordersWithDisplayStatus, 
      count: subOrders.length 
    });
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
    const { orderId } = request.params; // This is now the subOrderId
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

    // Try to fetch the sub-order first, fallback to regular order
    let subOrder = null;
    let isLegacyOrder = false;
    
    try {
      subOrder = await prisma.subOrder.findUnique({
        where: { id: orderId },
        include: {
          parentOrder: {
            include: {
              user: true
            }
          },
          items: {
            include: {
              product: true
            }
          }
        }
      });
    } catch (error) {
      console.log('SubOrder query failed, trying legacy order:', error.message);
    }
    
    // If no sub-order found, try to find legacy order
    if (!subOrder) {
      isLegacyOrder = true;
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: true,
          items: {
            include: {
              product: true
            }
          }
        }
      });
      
      if (!order) {
        return reply.status(404).send({ success: false, message: "Order not found" });
      }
      
      // Convert legacy order to subOrder-like structure for compatibility
      subOrder = {
        id: order.id,
        sellerId: userId, // We'll validate this later
        status: order.overallStatus || order.status,
        trackingNumber: order.trackingNumber,
        estimatedDelivery: order.estimatedDelivery,
        statusReason: order.statusReason,
        subtotal: order.totalAmount, // Will be calculated properly below
        parentOrder: order,
        items: order.items.filter(item => item.product.sellerId === userId), // Only seller's items
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      };
      
      // Calculate actual subtotal for seller's items
      subOrder.subtotal = subOrder.items.reduce((sum, item) => {
        return sum + (parseFloat(item.price || 0) * item.quantity);
      }, 0);
    }

    // Permission check: Only the seller who owns this sub-order/order or admin can update
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(userRole);
    if (!isAdmin) {
      if (isLegacyOrder) {
        // For legacy orders, check if seller has products in this order
        const hasSellerProducts = subOrder.items.length > 0;
        if (!hasSellerProducts) {
          return reply.status(403).send({
            success: false,
            message: "You can only update orders containing your products"
          });
        }
      } else {
        // For sub-orders, check sellerId
        if (subOrder.sellerId !== userId) {
          return reply.status(403).send({
            success: false,
            message: "You can only update your own orders"
          });
        }
      }
    }

    // Validate status transition  
    if (!validateStatusTransition(subOrder.status, normalizedStatus)) {
      return reply.status(400).send({
        success: false,
        message: `Invalid status transition from ${subOrder.status} to ${normalizedStatus}`
      });
    }

    // Prepare update data
    const updateData = {
      status: normalizedStatus,
      updatedAt: new Date()
    };

    if (trackingNumber !== undefined) updateData.trackingNumber = trackingNumber;
    if (estimatedDelivery !== undefined) updateData.estimatedDelivery = estimatedDelivery ? new Date(estimatedDelivery) : null;
    if (statusReason !== undefined) updateData.statusReason = statusReason;

    // Update the sub-order or legacy order
    let updatedSubOrder;
    if (isLegacyOrder) {
      // Update legacy order
      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          overallStatus: normalizedStatus,
          trackingNumber: trackingNumber !== undefined ? trackingNumber : undefined,
          estimatedDelivery: estimatedDelivery !== undefined ? (estimatedDelivery ? new Date(estimatedDelivery) : null) : undefined,
          statusReason: statusReason !== undefined ? statusReason : undefined,
          updatedAt: new Date()
        },
        include: {
          user: true,
          items: {
            include: {
              product: true
            }
          }
        }
      });
      
      // Convert back to subOrder structure for compatibility
      updatedSubOrder = {
        id: updatedOrder.id,
        status: updatedOrder.overallStatus,
        trackingNumber: updatedOrder.trackingNumber,
        estimatedDelivery: updatedOrder.estimatedDelivery,
        statusReason: updatedOrder.statusReason,
        subtotal: subOrder.subtotal,
        parentOrder: updatedOrder,
        items: updatedOrder.items.filter(item => item.product.sellerId === userId)
      };
    } else {
      // Update actual sub-order
      updatedSubOrder = await prisma.subOrder.update({
        where: { id: orderId },
        data: updateData,
        include: {
          parentOrder: {
            include: {
              user: true
            }
          },
          items: {
            include: {
              product: true
            }
          }
        }
      });
    }

    // Send notifications and emails for the sub-order status update
    const customer = updatedSubOrder.parentOrder.user;
    const customerEmail = customer?.email || updatedSubOrder.parentOrder.customerEmail;
    const customerName = customer?.name || updatedSubOrder.parentOrder.customerName || 'Customer';
    
    if (customerEmail) {
      console.log(`📧 Sending status update email to customer: ${customerEmail}`);
      
      sendOrderStatusEmail(customerEmail, customerName, {
        orderId: updatedSubOrder.id, // Use sub-order ID
        status: normalizedStatus.toLowerCase(),
        reason: statusReason || undefined,
        trackingNumber: updatedSubOrder.trackingNumber,
        estimatedDelivery: updatedSubOrder.estimatedDelivery,
        totalAmount: updatedSubOrder.subtotal,
        paymentMethod: updatedSubOrder.parentOrder.paymentMethod,
        orderDate: updatedSubOrder.createdAt,
        shippingName: updatedSubOrder.parentOrder.customerName,
        shippingAddress: updatedSubOrder.parentOrder.shippingAddressLine,
        shippingCity: updatedSubOrder.parentOrder.shippingCity,
        shippingState: updatedSubOrder.parentOrder.shippingState,
        shippingZipCode: updatedSubOrder.parentOrder.shippingZipCode,
        shippingCountry: updatedSubOrder.parentOrder.shippingCountry,
        shippingPhone: updatedSubOrder.parentOrder.shippingPhone,
        isGuest: !updatedSubOrder.parentOrder.userId,
        products: updatedSubOrder.items.map(item => ({
          title: item.product?.title || 'Product',
          quantity: item.quantity,
          price: parseFloat(item.price)
        }))
      }).catch(error => {
        console.error("Email error (non-blocking):", error.message);
      });

      // Create in-app notification for customer (only for logged-in users)
      if (customer?.id) {
        console.log(`🔔 Creating status change notification for customer ${customer.id}: ${normalizedStatus}`);
        notifyCustomerOrderStatusChange(customer.id, updatedSubOrder.id, normalizedStatus.toLowerCase(), {
          totalAmount: updatedSubOrder.subtotal.toString(),
          itemCount: updatedSubOrder.items.length,
          reason: statusReason || undefined,
          trackingNumber: updatedSubOrder.trackingNumber,
          estimatedDelivery: updatedSubOrder.estimatedDelivery
        }).catch(error => {
          console.error("Customer notification error (non-blocking):", error.message);
        });
      }

      // Notify admins about the status change
      if (userRole === "SELLER") {
        const seller = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
        const adminDetails = {
          customerName,
          sellerName: seller?.name || 'Unknown',
          totalAmount: updatedSubOrder.subtotal.toString(),
          itemCount: updatedSubOrder.items.length,
          reason: statusReason || undefined,
          trackingNumber: updatedSubOrder.trackingNumber,
          estimatedDelivery: updatedSubOrder.estimatedDelivery
        };
        
        // Notify all admins
        notifyAdminOrderStatusChange(updatedSubOrder.id, normalizedStatus.toLowerCase(), adminDetails)
          .catch(err => console.error("Admin notification error (non-blocking):", err.message));
        
        // Email all admins
        const admins = await prisma.user.findMany({ 
          where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } }, 
          select: { email: true, name: true } 
        });
        
        for (const admin of admins) {
          if (admin.email) {
            sendAdminOrderStatusEmail(admin.email, admin.name, {
              orderId: updatedSubOrder.id, 
              status: normalizedStatus.toLowerCase(),
              sellerName: seller?.name || 'Unknown',
              updatedBy: 'Seller',
              customerName,
              totalAmount: updatedSubOrder.subtotal,
              reason: statusReason || undefined,
              trackingNumber: updatedSubOrder.trackingNumber
            }).catch(err => console.error("Admin order status email error (non-blocking):", err.message));
          }
        }
      }

      // When ADMIN updates → notify the seller
      if (isAdmin) {
        notifySellerOrderStatusChange(updatedSubOrder.sellerId, updatedSubOrder.id, normalizedStatus.toLowerCase(), {
          customerName,
          totalAmount: updatedSubOrder.subtotal.toString(),
          reason: statusReason || undefined,
          trackingNumber: updatedSubOrder.trackingNumber
        }).catch(err => console.error("Seller notification error (non-blocking):", err.message));
        
        // Email the seller
        const sellerUser = await prisma.user.findUnique({ 
          where: { id: updatedSubOrder.sellerId }, 
          select: { email: true, name: true } 
        });
        
        if (sellerUser?.email) {
          sendSellerOrderStatusEmail(sellerUser.email, sellerUser.name || 'Seller', {
            orderId: updatedSubOrder.id,
            status: normalizedStatus.toLowerCase(),
            customerName,
            totalAmount: updatedSubOrder.subtotal,
            reason: statusReason || undefined,
            trackingNumber: updatedSubOrder.trackingNumber,
            estimatedDelivery: updatedSubOrder.estimatedDelivery
          }).catch(err => console.error("Seller order status email error (non-blocking):", err.message));
        }
      }
    }

    return reply.status(200).send({
      success: true,
      message: "Order status updated successfully. Customer notified via email.",
      updatedStatus: normalizedStatus,
      subOrder: {
        id: updatedSubOrder.id,
        status: mapStatusForDisplay(updatedSubOrder.status),
        trackingNumber: updatedSubOrder.trackingNumber,
        estimatedDelivery: updatedSubOrder.estimatedDelivery,
        statusReason: updatedSubOrder.statusReason
      }
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
        isGuest: !order.userId,
        products: order.items?.map(item => ({
          title: item.product?.title || 'Product',
          quantity: item.quantity,
          price: parseFloat(item.price)
        }))
      }).catch(error => {
        console.error("Email error (non-blocking):", error.message);
      });

      // Create in-app notification for customer about shipped status (only for logged-in users)
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

      // When SELLER updates tracking → in-app + email to ALL admins
      if (userRole === "SELLER") {
        const seller = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
        notifyAdminOrderStatusChange(orderId, "shipped", {
          customerName, sellerName: seller?.name || 'Unknown',
          totalAmount: order.totalAmount.toString(), itemCount: order.items.length, trackingNumber
        }).catch(err => console.error("Admin in-app notification error (non-blocking):", err.message));
        prisma.user.findMany({ where: { role: 'ADMIN' }, select: { email: true, name: true } })
          .then(admins => {
            for (const admin of admins) {
              if (admin.email) {
                sendAdminOrderStatusEmail(admin.email, admin.name, {
                  orderId, status: 'shipped',
                  sellerName: seller?.name || 'Unknown', updatedBy: 'Seller',
                  customerName, totalAmount: order.totalAmount, trackingNumber
                }).catch(err => console.error("Admin order status email error (non-blocking):", err.message));
              }
            }
          }).catch(err => console.error("Admin email lookup error (non-blocking):", err.message));
      }

      // When ADMIN updates tracking → in-app + email to seller(s)
      if (userRole === "ADMIN") {
        const sellerIds = [...new Set(order.items.map(item => item.product?.sellerId).filter(Boolean))];
        for (const sellerId of sellerIds) {
          notifySellerOrderStatusChange(sellerId, orderId, "shipped", {
            customerName, totalAmount: order.totalAmount.toString(), trackingNumber
          }).catch(err => console.error("Seller in-app notification error (non-blocking):", err.message));
          prisma.user.findUnique({ where: { id: sellerId }, select: { email: true, name: true } })
            .then(sellerUser => {
              if (sellerUser?.email) {
                sendSellerOrderStatusEmail(sellerUser.email, sellerUser.name || 'Seller', {
                  orderId, status: 'shipped', customerName,
                  totalAmount: order.totalAmount, trackingNumber
                }).catch(err => console.error("Seller order status email error (non-blocking):", err.message));
              }
            }).catch(err => console.error("Seller email lookup error (non-blocking):", err.message));
        }
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



