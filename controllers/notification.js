const prisma = require("../config/prisma");

// Helper function to create notifications
const createNotification = async (userId, title, message, type, relatedId = null, relatedType = null, metadata = null) => {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        type,
        relatedId,
        relatedType,
        metadata
      }
    });
    console.log(`🔔 Notification created for user ${userId}: ${title}`);
    return notification;
  } catch (error) {
    console.error("Error creating notification:", error);
    return null;
  }
};

// CUSTOMER NOTIFICATIONS
const notifyCustomerOrderStatusChange = async (userId, orderId, status, orderDetails = {}) => {
  console.log(`🔔 notifyCustomerOrderStatusChange called: userId=${userId}, orderId=${orderId}, status=${status}`);
  
  const statusMessages = {
    'confirmed': 'Your order has been confirmed',
    'processing': 'Your order is being prepared',
    'shipped': 'Your order has been shipped',
    'delivered': 'Your order has been delivered',
    'cancelled': 'Your order has been cancelled'
  };

  const title = `Order ${status.charAt(0).toUpperCase() + status.slice(1)}`;
  const message = statusMessages[status] || `Your order status has been updated to ${status}`;

  console.log(`🔔 Creating notification: title="${title}", message="${message}"`);

  return await createNotification(
    userId,
    title,
    message,
    'ORDER_STATUS_CHANGED',
    orderId,
    'order',
    { status, ...orderDetails }
  );
};

// SELLER NOTIFICATIONS
const notifySellerNewOrder = async (sellerId, orderId, orderDetails = {}) => {
  const { customerName, totalAmount, itemCount } = orderDetails;
  
  const title = 'New Order Received!';
  const message = `You received a new order from ${customerName || 'Customer'} for ${itemCount || 1} item(s) worth $${totalAmount || '0.00'}`;

  return await createNotification(
    sellerId,
    title,
    message,
    'NEW_ORDER',
    orderId,
    'order',
    orderDetails
  );
};

const notifySellerProductStatusChange = async (sellerId, productId, status, productTitle, reason = null) => {
  const statusMessages = {
    'ACTIVE': `Your product "${productTitle}" is now active and visible to customers`,
    'PENDING': `Your product "${productTitle}" is pending approval`,
    'INACTIVE': `Your product "${productTitle}" has been deactivated${reason ? `. Reason: ${reason}` : ''}`,
    'REJECTED': `Your product "${productTitle}" was rejected and needs review${reason ? `. Reason: ${reason}` : ''}`
  };

  const title = `Product ${status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()}`;
  const message = statusMessages[status] || `Your product "${productTitle}" status has been updated`;

  return await createNotification(
    sellerId,
    title,
    message,
    'PRODUCT_STATUS_CHANGED',
    productId,
    'product',
    { status, productTitle, reason }
  );
};

const notifySellerLowStock = async (sellerId, productId, productTitle, currentStock, threshold = 5) => {
  const title = 'Low Stock Alert!';
  const message = `Your product "${productTitle}" is running low on stock (${currentStock} remaining). Consider restocking soon.`;

  return await createNotification(
    sellerId,
    title,
    message,
    'LOW_STOCK_ALERT',
    productId,
    'product',
    { productTitle, currentStock, threshold }
  );
};

// SELLER APPROVAL NOTIFICATIONS
const notifySellerApproved = async (sellerId, sellerName = 'Seller') => {
  const title = '✅ Your Account Has Been Approved!';
  const message = `Congratulations ${sellerName}! Your seller account has been approved by our admin team. You can now proceed with uploading products and setting up your store.`;

  return await createNotification(
    sellerId,
    title,
    message,
    'SELLER_APPROVED',
    sellerId,
    'seller',
    { approvalType: 'account' }
  );
};

const notifySellerApprovalRejected = async (sellerId, reason = 'Not specified', sellerName = 'Seller') => {
  const title = '❌ Your Account Application Was Not Approved';
  const message = `We reviewed your seller application, but it does not meet our current requirements. Reason: ${reason}. Please review and reapply after addressing the concerns.`;

  return await createNotification(
    sellerId,
    title,
    message,
    'SELLER_REJECTED',
    sellerId,
    'seller',
    { rejectionReason: reason }
  );
};

// CULTURAL APPROVAL NOTIFICATIONS
const notifySellerCulturalApproval = async (sellerId, approved, feedback = '', sellerName = 'Seller') => {
  let title, message;

  if (approved) {
    title = '✅ Cultural Approval Granted!';
    message = `Congratulations ${sellerName}! Your cultural background and story have been approved. Your store is now eligible to go live once you upload the minimum required products (5+ products recommended, start with 1-2 SKUs).`;
  } else {
    title = '⚠️ Cultural Approval Requires Review';
    message = `Your cultural information submission requires further review. Feedback: ${feedback || 'Please review your submission and resubmit.'}`;
  }

  return await createNotification(
    sellerId,
    title,
    message,
    'CULTURAL_APPROVAL',
    sellerId,
    'seller',
    { 
      approved,
      feedback,
      approvalType: 'cultural'
    }
  );
};

// PRODUCT RECOMMENDATION NOTIFICATION
const notifySellerProductRecommendation = async (sellerId, sellerName = 'Seller') => {
  const title = '📦 Product Upload Recommendations';
  const message = `Welcome to your seller dashboard, ${sellerName}! To maximize your store's success, we recommend uploading at least 5 products. You can start with 1-2 SKUs (Stock Keeping Units) per product and expand from there. More products increase visibility and customer trust.`;

  return await createNotification(
    sellerId,
    title,
    message,
    'PRODUCT_RECOMMENDATION',
    sellerId,
    'seller',
    { 
      recommendedCount: 5,
      minimumSKU: 1,
      suggestedSKU: 2
    }
  );
};

// ADMIN NOTIFICATIONS
const notifyAdminNewOrder = async (orderId, orderDetails = {}) => {
  const { customerName, sellerName, totalAmount, itemCount } = orderDetails;
  
  const title = 'New Order Placed';
  const message = `New order from ${customerName || 'Customer'} to seller ${sellerName || 'Unknown'} for $${totalAmount || '0.00'} (${itemCount || 1} items)`;

  // Get all admin users
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true }
  });

  const notifications = [];
  for (const admin of admins) {
    const notification = await createNotification(
      admin.id,
      title,
      message,
      'NEW_ORDER',
      orderId,
      'order',
      orderDetails
    );
    if (notification) notifications.push(notification);
  }

  return notifications;
};

const notifyAdminNewProduct = async (productId, productDetails = {}) => {
  const { productTitle, sellerName } = productDetails;
  
  const title = 'New Product Submitted';
  const message = `Seller ${sellerName || 'Unknown'} submitted a new product "${productTitle || 'Untitled'}" for approval`;

  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true }
  });

  const notifications = [];
  for (const admin of admins) {
    const notification = await createNotification(
      admin.id,
      title,
      message,
      'NEW_PRODUCT_SUBMITTED',
      productId,
      'product',
      productDetails
    );
    if (notification) notifications.push(notification);
  }

  return notifications;
};

// ADMIN NOTIFICATION FOR ORDER STATUS CHANGES
const notifyAdminOrderStatusChange = async (orderId, status, orderDetails = {}) => {
  const { customerName, sellerName, totalAmount, itemCount } = orderDetails;
  
  const title = 'Order Status Updated';
  const message = `Order from ${customerName || 'Customer'} to seller ${sellerName || 'Unknown'} for $${totalAmount || '0.00'} has been updated to ${status}`;

  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true }
  });

  const notifications = [];
  for (const admin of admins) {
    const notification = await createNotification(
      admin.id,
      title,
      message,
      'ORDER_STATUS_CHANGED',
      orderId,
      'order',
      { status, ...orderDetails }
    );
    if (notification) notifications.push(notification);
  }

  return notifications;
};

// GENERAL NOTIFICATION APIs

// Get notifications for user
exports.getNotifications = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { page = 1, limit = 20, unreadOnly = false } = request.query;
    
    const whereClause = { userId };
    if (unreadOnly === 'true') {
      whereClause.isRead = false;
    }

    const notifications = await prisma.notification.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: parseInt(limit)
    });

    const unreadCount = await prisma.notification.count({
      where: { userId, isRead: false }
    });

    return reply.status(200).send({
      success: true,
      notifications,
      unreadCount,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: notifications.length
      }
    });

  } catch (error) {
    console.error("Get notifications error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// Mark notification as read
exports.markAsRead = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { notificationId } = request.params;

    await prisma.notification.update({
      where: { 
        id: notificationId,
        userId // Ensure user owns the notification
      },
      data: { isRead: true }
    });

    return reply.status(200).send({
      success: true,
      message: "Notification marked as read"
    });

  } catch (error) {
    console.error("Mark as read error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// Mark all notifications as read
exports.markAllAsRead = async (request, reply) => {
  try {
    const userId = request.user.userId;

    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true }
    });

    return reply.status(200).send({
      success: true,
      message: `Marked ${result.count} notifications as read`
    });

  } catch (error) {
    console.error("Mark all as read error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// Delete notification
exports.deleteNotification = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { notificationId } = request.params;

    await prisma.notification.delete({
      where: { 
        id: notificationId,
        userId
      }
    });

    return reply.status(200).send({
      success: true,
      message: "Notification deleted"
    });

  } catch (error) {
    console.error("Delete notification error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// Export helper functions for use in other controllers
module.exports = {
  ...module.exports,
  createNotification,
  notifyCustomerOrderStatusChange,
  notifySellerNewOrder,
  notifySellerProductStatusChange,
  notifySellerLowStock,
  notifySellerApproved,
  notifySellerApprovalRejected,
  notifySellerCulturalApproval,
  notifySellerProductRecommendation,
  notifyAdminNewOrder,
  notifyAdminNewProduct,
  notifyAdminOrderStatusChange
};