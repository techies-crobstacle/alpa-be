const prisma = require("../config/prisma");
const { 
  calculateSLADeadline, 
  calculateSLAStatus, 
  getSLAConfig 
} = require("../config/slaConfig");
const { 
  sendSellerOrderNotificationEmail,
  sendSLAWarningEmail 
} = require("../utils/emailService");

// CREATE ORDER NOTIFICATION
const createOrderNotification = async (orderId, sellerId, type, priority = 'MEDIUM', additionalData = {}) => {
  try {
    // Check if OrderNotification model exists
    if (!prisma || !prisma.orderNotification) {
      console.log('OrderNotification model not available, skipping notification creation');
      return { success: false, message: 'Model not available' };
    }

    const notification = await prisma.orderNotification.create({
      data: {
        orderId,
        sellerId,
        type,
        priority,
        status: 'PENDING',
        message: additionalData.message || `${type} required for order`,
        notes: additionalData.notes || null,
        slaDeadline: calculateSLADeadline(type),
        createdAt: new Date()
      }
    });

    // Send initial notification email to seller
    try {
      await sendSellerOrderNotificationEmail(sellerId, orderId, type);
    } catch (emailError) {
      console.error('Email notification error (non-blocking):', emailError.message);
    }
    
    return notification;
  } catch (error) {
    console.error("Create notification error:", error);
    // Don't throw error to avoid breaking order creation
    return { success: false, error: error.message };
  }
};

// GET SELLER NOTIFICATIONS WITH SLA STATUS
exports.getSellerNotifications = async (request, reply) => {
  try {
    const authenticatedUserId = request.user.userId;
    const userRole = request.user.role;
    const { 
      page = 1, 
      limit = 20, 
      status, 
      priority, 
      type,
      slaStatus,
      sellerId: querySellerId  // Allow admin to query by sellerId
    } = request.query;

    // Determine which seller's notifications to fetch
    let sellerId = authenticatedUserId;
    
    // If admin, allow them to query notifications for a specific seller
    if (userRole === 'ADMIN' && querySellerId) {
      sellerId = querySellerId;
    } else if (userRole === 'ADMIN' && !querySellerId) {
      // Admin without sellerId parameter - return error or all sellers
      return reply.status(400).send({
        success: false,
        message: "Admin must provide ?sellerId parameter to view notifications"
      });
    } else if (userRole !== 'SELLER' && userRole !== 'ADMIN') {
      // Only sellers and admins can view notifications
      return reply.status(403).send({
        success: false,
        message: "Only sellers and admins can view notifications"
      });
    }

    console.log(`Getting notifications for seller: ${sellerId} (requested by ${userRole})`);

    // Check if prisma and model are available
    if (!prisma) {
      console.error('Prisma client not available');
      return reply.status(500).send({
        success: false,
        message: 'Database connection error'
      });
    }

    // Check if OrderNotification table exists by trying to count
    try {
      await prisma.orderNotification.count();
    } catch (modelError) {
      console.error('OrderNotification model error:', modelError.message);
      
      // If table doesn't exist, return empty result for now
      if (modelError.code === 'P2021' || modelError.message.includes('does not exist')) {
        console.log('OrderNotification table does not exist yet, returning empty result');
        return reply.status(200).send({
          success: true,
          message: 'Order notification system is being set up. Please run database migrations.',
          notifications: [],
          summary: {
            total: 0,
            pending: 0,
            overdue: 0,
            critical: 0
          },
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: 0,
            pages: 0
          }
        });
      }
      
      throw modelError; // Re-throw if it's a different error
    }

    const where = { sellerId };
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (type) where.type = type;

    const notifications = await prisma.orderNotification.findMany({
      where,
      include: {
        order: {
          select: {
            id: true,
            totalAmount: true,
            status: true,
            createdAt: true,
            customerName: true,
            customerEmail: true,
            customerPhone: true,
            items: {
              include: {
                product: {
                  select: {
                    id: true,
                    title: true,
                    price: true,
                    images: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' }
      ],
      skip: (page - 1) * limit,
      take: parseInt(limit)
    });

    // Calculate SLA status for each notification
    const notificationsWithSLA = notifications.map(notification => {
      const slaStatus = calculateSLAStatus(notification);
      return {
        ...notification,
        slaStatus: slaStatus.status,
        slaIndicator: slaStatus.indicator,
        timeRemaining: Math.round(slaStatus.timeRemaining * 100) / 100,
        timeElapsed: Math.round(slaStatus.timeElapsed * 100) / 100,
        isOverdue: slaStatus.isOverdue,
        urgencyLevel: slaStatus.urgencyLevel,
        config: getSLAConfig(notification.type)
      };
    });

    // Filter by SLA status if requested
    let filteredNotifications = notificationsWithSLA;
    if (slaStatus) {
      filteredNotifications = notificationsWithSLA.filter(n => n.slaStatus === slaStatus);
    }

    const totalCount = await prisma.orderNotification.count({ where });

    return reply.status(200).send({
      success: true,
      notifications: filteredNotifications,
      summary: {
        total: totalCount,
        pending: filteredNotifications.filter(n => n.status === 'PENDING').length,
        overdue: filteredNotifications.filter(n => n.isOverdue).length,
        critical: filteredNotifications.filter(n => n.slaStatus === 'CRITICAL').length
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });

  } catch (error) {
    console.error("Get notifications error:", error);
    return reply.status(500).send({ 
      success: false, 
      message: error.message 
    });
  }
};

// UPDATE ORDER STATUS AND MANAGE WORKFLOW
exports.updateOrderStatus = async (request, reply) => {
  try {
    const { orderId } = request.params;
    const { status, notes, trackingNumber } = request.body;
    const sellerId = request.user.userId;

    // Verify seller owns this order
    const order = await prisma.order.findFirst({
      where: { 
        id: orderId,
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

    if (!order) {
      return reply.status(404).send({
        success: false,
        message: "Order not found or unauthorized"
      });
    }

    // Update order status
    const updateData = { 
      status,
      updatedAt: new Date()
    };
    
    if (trackingNumber) {
      updateData.trackingNumber = trackingNumber;
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: updateData
    });

    // Complete current notifications for this order
    await prisma.orderNotification.updateMany({
      where: {
        orderId,
        sellerId,
        status: 'PENDING'
      },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        notes: notes || `Order status updated to ${status}`
      }
    });

    // Create next workflow notification based on new status
    await createWorkflowNotification(orderId, sellerId, status);

    return reply.status(200).send({
      success: true,
      message: "Order status updated successfully",
      order: updatedOrder
    });

  } catch (error) {
    console.error("Update order status error:", error);
    return reply.status(500).send({ 
      success: false, 
      message: error.message 
    });
  }
};

// MARK NOTIFICATION AS READ/ACKNOWLEDGED
exports.acknowledgeNotification = async (request, reply) => {
  try {
    const { notificationId } = request.params;
    const authenticatedUserId = request.user.userId;
    const userRole = request.user.role;

    // Build where clause based on user role
    let whereClause = { id: notificationId };
    
    // If seller, only allow acknowledging their own notifications
    if (userRole === 'SELLER') {
      whereClause.sellerId = authenticatedUserId;
    }
    // If admin, allow acknowledging any notification (no seller restriction)

    const notification = await prisma.orderNotification.findFirst({
      where: whereClause
    });

    if (!notification) {
      return reply.status(404).send({
        success: false,
        message: "Notification not found or unauthorized"
      });
    }

    await prisma.orderNotification.update({
      where: { id: notificationId },
      data: {
        status: 'IN_PROGRESS',
        acknowledgedAt: new Date()
      }
    });

    return reply.status(200).send({
      success: true,
      message: "Notification acknowledged"
    });

  } catch (error) {
    console.error("Acknowledge notification error:", error);
    return reply.status(500).send({ 
      success: false, 
      message: error.message 
    });
  }
};

// GET SLA DASHBOARD METRICS
exports.getSLADashboard = async (request, reply) => {
  try {
    const sellerId = request.user.userId;
    const { timeframe = '7' } = request.query; // days

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(timeframe));

    // Get notifications within timeframe
    const notifications = await prisma.orderNotification.findMany({
      where: {
        sellerId,
        createdAt: {
          gte: startDate
        }
      },
      include: {
        order: {
          select: {
            id: true,
            totalAmount: true,
            customerName: true
          }
        }
      }
    });

    // Calculate SLA performance by type
    const slaPerformance = {};
    const notificationsByType = {};
    
    notifications.forEach(notification => {
      const type = notification.type;
      if (!notificationsByType[type]) {
        notificationsByType[type] = [];
      }
      notificationsByType[type].push(notification);
    });

    for (const [type, typeNotifications] of Object.entries(notificationsByType)) {
      const completed = typeNotifications.filter(n => n.status === 'COMPLETED');
      const onTime = completed.filter(n => 
        n.completedAt && new Date(n.completedAt) <= new Date(n.slaDeadline)
      );

      slaPerformance[type] = {
        total: typeNotifications.length,
        completed: completed.length,
        onTime: onTime.length,
        breached: completed.length - onTime.length,
        pending: typeNotifications.filter(n => n.status === 'PENDING').length,
        percentage: completed.length > 0 ? 
          Math.round((onTime.length / completed.length) * 100) : 0
      };
    }

    // Get urgent notifications (next 2 hours)
    const urgentNotifications = await prisma.orderNotification.findMany({
      where: {
        sellerId,
        status: 'PENDING',
        slaDeadline: {
          lte: new Date(Date.now() + 2 * 60 * 60 * 1000)
        }
      },
      include: {
        order: {
          select: {
            id: true,
            customerName: true,
            totalAmount: true
          }
        }
      },
      orderBy: { slaDeadline: 'asc' }
    });

    // Overall SLA metrics
    const totalCompleted = notifications.filter(n => n.status === 'COMPLETED').length;
    const totalOnTime = notifications.filter(n => 
      n.status === 'COMPLETED' && 
      n.completedAt && 
      new Date(n.completedAt) <= new Date(n.slaDeadline)
    ).length;

    const overallSLA = totalCompleted > 0 ? 
      Math.round((totalOnTime / totalCompleted) * 100) : 0;

    return reply.status(200).send({
      success: true,
      dashboard: {
        overallSLA,
        totalNotifications: notifications.length,
        pendingNotifications: notifications.filter(n => n.status === 'PENDING').length,
        overdueNotifications: notifications.filter(n => {
          const slaStatus = calculateSLAStatus(n);
          return slaStatus.isOverdue && n.status === 'PENDING';
        }).length,
        slaPerformance,
        urgentNotifications: urgentNotifications.map(n => ({
          ...n,
          slaStatus: calculateSLAStatus(n)
        }))
      }
    });

  } catch (error) {
    console.error("Get SLA dashboard error:", error);
    return reply.status(500).send({ 
      success: false, 
      message: error.message 
    });
  }
};

// HELPER FUNCTIONS
const createWorkflowNotification = async (orderId, sellerId, currentStatus) => {
  const workflowMap = {
    'PENDING': 'ORDER_CONFIRMATION',
    'CONFIRMED': 'SHIPPING_PREPARATION', 
    'PROCESSING': 'ORDER_SHIPPED',
    'SHIPPED': 'ORDER_DELIVERED'
  };
  
  const nextType = workflowMap[currentStatus];
  if (nextType) {
    await createOrderNotification(
      orderId, 
      sellerId, 
      nextType, 
      'HIGH',
      { message: `${nextType.replace('_', ' ').toLowerCase()} required` }
    );
  }
};

// Check and update SLA status for pending notifications
const checkSLAStatus = async () => {
  try {
    // Safety check for database availability
    if (!prisma) {
      console.log("Prisma not available, skipping SLA check");
      return;
    }

    const pendingNotifications = await prisma.orderNotification.findMany({
      where: { status: 'PENDING' },
      include: { order: true }
    });

    if (!pendingNotifications || pendingNotifications.length === 0) {
      console.log("No pending notifications to check");
      return;
    }

    console.log(`Checking SLA status for ${pendingNotifications.length} notifications`);

    for (const notification of pendingNotifications) {
      const slaStatus = calculateSLAStatus(notification);
      
      // Update priority if changed
      if (slaStatus.priority !== notification.priority) {
        await prisma.orderNotification.update({
          where: { id: notification.id },
          data: { priority: slaStatus.priority }
        });

        console.log(`Updated notification ${notification.id} priority to ${slaStatus.priority}`);

        // Send warning email if critical or breached
        if (slaStatus.status === 'CRITICAL' || slaStatus.status === 'BREACHED') {
          try {
            const { sendSLAWarningEmail } = require('../utils/emailService');
            await sendSLAWarningEmail(
              notification.sellerId, 
              notification.orderId, 
              notification.type,
              slaStatus
            );
            console.log(`Sent SLA warning email for notification ${notification.id}`);
          } catch (emailError) {
            console.error("SLA warning email error (non-blocking):", emailError.message);
          }
        }
      }
    }
  } catch (error) {
    console.error("SLA status check error:", error);
    
    // Don't throw the error to prevent cron job from failing
    if (error.code === 'P1001' || error.message.includes('database')) {
      console.log("Database connection issue, will retry in next scheduled run");
    }
  }
};

module.exports = {
  createOrderNotification,
  getSellerNotifications: exports.getSellerNotifications,
  updateOrderStatus: exports.updateOrderStatus,
  acknowledgeNotification: exports.acknowledgeNotification,
  getSLADashboard: exports.getSLADashboard,
  checkSLAStatus
};