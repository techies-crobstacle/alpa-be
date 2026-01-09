# Notification System Documentation

## Overview
A comprehensive role-based notification system that automatically notifies users about relevant events in the platform.

## Database Schema
The notification system uses the `Notification` model with:
- **userId**: Who receives the notification
- **title**: Short notification title
- **message**: Detailed notification message
- **type**: Notification type (enum)
- **isRead**: Read status
- **relatedId**: ID of related entity (order, product, etc.)
- **relatedType**: Type of related entity
- **metadata**: Additional data (JSON)

## Notification Types
```javascript
enum NotificationType {
  ORDER_STATUS_CHANGED      // Customer: order status updates
  NEW_ORDER                 // Seller & Admin: new order received
  PRODUCT_STATUS_CHANGED    // Seller: product approval/rejection
  LOW_STOCK_ALERT          // Seller: stock running low
  SELLER_APPROVED          // Seller: account approved
  SELLER_REJECTED          // Seller: account rejected
  NEW_PRODUCT_SUBMITTED    // Admin: new product needs approval
  PAYMENT_RECEIVED         // Seller: payment confirmed
  ORDER_CANCELLED          // Customer & Seller: order cancelled
  PRODUCT_OUT_OF_STOCK     // Seller: product out of stock
  GENERAL                  // Any general notification
}
```

## API Endpoints

### Get Notifications
```
GET /api/notifications
Query params:
- page: Page number (default: 1)
- limit: Items per page (default: 20)
- unreadOnly: true/false (default: false)

Response:
{
  "success": true,
  "notifications": [...],
  "unreadCount": 5,
  "pagination": { ... }
}
```

### Mark as Read
```
PUT /api/notifications/read/:notificationId
```

### Mark All as Read
```
PUT /api/notifications/read-all
```

### Delete Notification
```
DELETE /api/notifications/:notificationId
```

## Automatic Notifications

### Customer Notifications
- **Order Status Changes**: When seller updates order status
- **Order Delivered**: When order is marked as delivered
- **Order Cancelled**: When order is cancelled

### Seller Notifications
- **New Orders**: When customer places order with seller's products
- **Product Status Changes**: When admin approves/rejects products
- **Low Stock Alerts**: When product stock drops below threshold (5 items)
- **Product Out of Stock**: When product stock reaches 0

### Admin Notifications
- **New Orders**: All orders placed in the system
- **New Products**: When sellers submit products for approval
- **Seller Applications**: New seller registrations

## Integration Points

The notification system is automatically integrated into:

1. **Order Creation** (`controllers/orders.js`)
   - Creates notifications for sellers and admins

2. **Order Status Updates** (`controllers/sellerOrders.js`)
   - Creates notifications for customers

3. **Product Management** (`controllers/product.js`)
   - Creates notifications for sellers and admins

## Helper Functions

Available helper functions in `controllers/notification.js`:
- `notifyCustomerOrderStatusChange()`
- `notifySellerNewOrder()`
- `notifySellerProductStatusChange()`
- `notifySellerLowStock()`
- `notifyAdminNewOrder()`
- `notifyAdminNewProduct()`

## Usage Example

```javascript
// In any controller
const { notifyCustomerOrderStatusChange } = require('./notification');

// Notify customer about order status change
await notifyCustomerOrderStatusChange(
  userId, 
  orderId, 
  'shipped', 
  { totalAmount: '99.99', itemCount: 3 }
);
```

## Features
- ✅ Role-based notifications
- ✅ Real-time notification creation
- ✅ Read/unread status tracking
- ✅ Pagination support
- ✅ Notification metadata for rich content
- ✅ Automatic integration with existing workflows
- ✅ Non-blocking operation (won't break main functionality)
- ✅ Detailed logging for debugging

## Dashboard Integration
The frontend can use these APIs to:
1. Show notification bell with unread count
2. Display notification list with pagination
3. Mark notifications as read
4. Show notification details with metadata
5. Filter by notification types

## Error Handling
All notification operations are wrapped in try-catch blocks and won't break the main application flow. If notification creation fails, it logs the error but continues processing the main request.