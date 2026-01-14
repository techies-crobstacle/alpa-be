# Order Notification System with SLA Indicators

## Overview
This system provides comprehensive order management notifications for sellers with SLA (Service Level Agreement) monitoring and automated escalation.

## Features

### 📊 SLA Monitoring
- **Real-time tracking** of order processing times
- **Color-coded indicators**: Green (On-time), Yellow (Warning), Orange (Critical), Red (Breached)
- **Automatic priority escalation** as deadlines approach
- **Configurable SLA thresholds** for different order stages

### 🔔 Notification Types
- `ORDER_PROCESSING` - Initial order confirmation (6h SLA)
- `ORDER_CONFIRMATION` - Seller confirms order (3h SLA)
- `SHIPPING_PREPARATION` - Prepare items for shipping (24h SLA)
- `ORDER_SHIPPED` - Ship order with tracking (48h SLA)
- `ORDER_DELIVERED` - Complete delivery (120h SLA)
- `PAYMENT_PENDING` - Payment verification (24h SLA)
- `STOCK_ALERT` - Low inventory alerts (12h SLA)

### 📈 Dashboard Metrics
- Overall SLA performance percentage
- Notifications by status (Pending, Overdue, Critical)
- Performance breakdown by notification type
- Urgent notifications requiring immediate attention

## API Endpoints

### Seller Notifications
```
GET /api/seller/notifications
```
**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20)
- `status` - Filter by notification status
- `priority` - Filter by priority (LOW, MEDIUM, HIGH, URGENT)
- `type` - Filter by notification type
- `slaStatus` - Filter by SLA status (ON_TIME, WARNING, CRITICAL, BREACHED)

**Response:**
```json
{
  "success": true,
  "notifications": [
    {
      "id": "notification_id",
      "type": "ORDER_PROCESSING",
      "priority": "HIGH",
      "status": "PENDING",
      "message": "New order received from John Doe",
      "slaStatus": "WARNING",
      "slaIndicator": "YELLOW",
      "timeRemaining": 1.5,
      "timeElapsed": 2.3,
      "isOverdue": false,
      "urgencyLevel": 3,
      "order": {
        "id": "order_id",
        "totalAmount": "99.99",
        "customerName": "John Doe"
      },
      "config": {
        "WARNING_HOURS": 2,
        "CRITICAL_HOURS": 4,
        "BREACH_HOURS": 6
      }
    }
  ],
  "summary": {
    "total": 25,
    "pending": 8,
    "overdue": 2,
    "critical": 3
  },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 25,
    "pages": 2
  }
}
```

### Update Order Status
```
PATCH /api/seller/orders/:orderId/status
```
**Body:**
```json
{
  "status": "CONFIRMED",
  "notes": "Order confirmed and being prepared",
  "trackingNumber": "TRK123456" // optional
}
```

### Acknowledge Notification
```
PATCH /api/seller/notifications/:notificationId/acknowledge
```

### SLA Dashboard
```
GET /api/seller/sla-dashboard
```
**Query Parameters:**
- `timeframe` - Days to analyze (default: 7)

**Response:**
```json
{
  "success": true,
  "dashboard": {
    "overallSLA": 85,
    "totalNotifications": 150,
    "pendingNotifications": 12,
    "overdueNotifications": 3,
    "slaPerformance": {
      "ORDER_PROCESSING": {
        "total": 50,
        "completed": 45,
        "onTime": 40,
        "breached": 5,
        "pending": 5,
        "percentage": 89
      }
    },
    "urgentNotifications": [
      {
        "id": "notification_id",
        "type": "ORDER_SHIPPED",
        "order": {
          "customerName": "Jane Smith",
          "totalAmount": "149.99"
        },
        "slaStatus": {
          "status": "CRITICAL",
          "indicator": "ORANGE",
          "timeRemaining": 0.5
        }
      }
    ]
  }
}
```

## SLA Configuration

### Default Thresholds
Located in `config/slaConfig.js`:

```javascript
const slaConfig = {
  ORDER_PROCESSING: {
    WARNING_HOURS: 2,
    CRITICAL_HOURS: 4,
    BREACH_HOURS: 6
  },
  // ... other configurations
};
```

### SLA Status Indicators
- **🟢 GREEN (ON_TIME)**: Within normal timeframe
- **🟡 YELLOW (WARNING)**: Approaching deadline
- **🟠 ORANGE (CRITICAL)**: Urgent attention needed
- **🔴 RED (BREACHED)**: Deadline exceeded

### Priority Levels
- `LOW` - No urgency
- `MEDIUM` - Normal processing
- `HIGH` - Requires attention soon
- `URGENT` - Immediate action required

## Workflow Integration

### Order Creation Flow
1. Customer places order
2. System creates `ORDER_PROCESSING` notification for each seller
3. Seller receives email and dashboard notification
4. SLA timer starts tracking

### Status Update Flow
1. Seller updates order status
2. Current notifications marked as completed
3. Next workflow notification created automatically
4. Customer receives status update email

### SLA Monitoring Flow
1. **Every 15 minutes**: Check all pending notifications
2. **Priority escalation**: Update based on elapsed time
3. **Email alerts**: Send warnings for critical/breached SLAs
4. **Dashboard updates**: Real-time SLA status indicators

## Automated Features

### Background Tasks
- **SLA Status Checker** - Runs every 15 minutes
- **Email Alerts** - Automatic warning emails
- **Cleanup Service** - Removes old completed notifications
- **Performance Tracking** - Calculate SLA metrics

### Email Notifications
- **Order notifications** to sellers
- **SLA warning emails** for approaching deadlines
- **Breach notifications** for overdue items
- **Customer status updates**

## Database Schema

### OrderNotification Model
```sql
model OrderNotification {
  id             String    @id @default(cuid())
  orderId        String
  sellerId       String
  type           NotificationType
  priority       Priority  @default(MEDIUM)
  status         NotificationStatus @default(PENDING)
  message        String?
  notes          String?
  slaDeadline    DateTime
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  completedAt    DateTime?
  acknowledgedAt DateTime?
  
  order  Order @relation(fields: [orderId], references: [id])
  seller User  @relation(fields: [sellerId], references: [id])
}
```

## Error Handling

### Graceful Degradation
- Database connection issues: Log to console in development
- Email service failures: Non-blocking, continue processing
- SLA check failures: Retry mechanism with exponential backoff

### Development Mode
- All email notifications logged to console
- Database errors don't block order processing
- Comprehensive logging for debugging

## Performance Considerations

### Indexing
- Seller ID, status, priority, type, SLA deadline indexed
- Efficient queries for dashboard and notifications

### Cleanup
- Automatic cleanup of old completed notifications
- Configurable retention period (default: 30 days)

### Caching
- SLA configurations cached in memory
- Dashboard metrics can be cached for better performance

## Integration Guide

### Frontend Integration
1. Display notification count in seller header
2. Show SLA indicators with color coding
3. Dashboard widgets for key metrics
4. Real-time updates via websockets (optional)

### Mobile App Integration
- Push notifications for urgent SLAs
- Simplified mobile dashboard
- Quick action buttons for status updates

## Monitoring & Analytics

### Key Metrics
- Average SLA compliance rate
- Response time by notification type
- Seller performance rankings
- Customer satisfaction correlation

### Alerting
- Admin notifications for poor SLA performance
- Automated escalation for repeated breaches
- Performance trend analysis

This system ensures sellers stay on top of their order management responsibilities while providing customers with reliable service delivery timelines.