# Unified RBAC Integration Guide

## Audience
Single Admin Panel team using RBAC for:
- `ADMIN`
- `SELLER`
- `CUSTOMER`

This guide replaces separate role docs and provides one implementation reference.

---

## Why These Changes Were Made

### Business and operational goals
1. Prevent incorrect order handling by enforcing a **forward-only lifecycle**.
2. Ensure shipment quality by requiring **tracking number + ETA** before shipping.
3. Ensure accountability and auditability by making **reason mandatory** for:
	 - cancellation
	 - refund
	 - partial refund
4. Add a structured customer refund flow where users can:
	 - create refund/partial-refund requests
	 - track request status
5. Keep all roles aligned in one panel with RBAC-specific controls.

### Problems solved
- Backward status updates (e.g., `SHIPPED -> PROCESSING`) are now blocked.
- Missing shipment details when marking shipped is blocked.
- Status changes to cancellation/refund without reason are blocked.
- Customers and guests now have an official request + tracking workflow for refunds.

---

## Backend Changes Done

### 1) New status rules module
- Added: `utils/orderStatusRules.js`
- Provides:
	- status normalization
	- valid target status list
	- transition validator
	- required-field checks

### 2) Order status model updates
- Updated enum `OrderStatus` with:
	- `REFUND`
	- `PARTIAL_REFUND`
- Added `Order.statusReason` (nullable text)

### 3) Migration added
- `prisma/migrations/20260303000000_add_refund_status_and_order_reason/migration.sql`
- `prisma/migrations/20260303010000_support_ticket_guest_refund_tracking/migration.sql`

### 3.1) Refund request tracking model enhancement
- `SupportTicket.userId` is now optional (guest support)
- Added fields used by both customer + guest refund workflows:
	- `orderId`
	- `guestEmail`
	- `requestType`
- Added indexes for faster tracking queries:
	- `orderId`
	- `guestEmail`

### 4) Controllers updated
- `controllers/sellerOrders.js`
	- Enforces one-way transitions and required fields for seller/admin updates
	- Enforces same rules in tracking endpoint that auto-sets `SHIPPED`
- `controllers/orderNotification.js`
	- Enforces same validations in patch status flow used by seller/admin workflows
- `controllers/orders.js`
	- Customer cancellation now requires reason
	- Added customer refund request create + tracking APIs
	- Added guest refund request create + tracking APIs (verified by `orderId + customerEmail`)
- `controllers/notification.js`
	- Added refund and partial-refund customer notification messages
- `controllers/admin.js`
	- Analytics status breakdown updated to include new statuses

### 5) Routes updated
- `routes/orderRoutes.js`
	- Added customer refund request and tracking endpoints
	- Added guest refund request and tracking endpoints
- Existing seller/admin status routes now run with stronger validation in controllers

---

## Global Order Lifecycle Rules (Applied Across APIs)

### Valid statuses
- `CONFIRMED`
- `PROCESSING`
- `SHIPPED`
- `DELIVERED`
- `CANCELLED`
- `REFUND`
- `PARTIAL_REFUND`

### Allowed transitions
Primary flow:
- `CONFIRMED -> PROCESSING -> SHIPPED -> DELIVERED`

Terminal outcomes:
- `CONFIRMED/PROCESSING/SHIPPED -> CANCELLED`
- `DELIVERED -> REFUND`
- `DELIVERED -> PARTIAL_REFUND`

Terminal lock:
- If current status is `CANCELLED`, `REFUND`, or `PARTIAL_REFUND`, no further status changes allowed.

### Mandatory fields by target status
- Move to `SHIPPED`:
	- `trackingNumber` required
	- `estimatedDelivery` required and must be valid date
- Move to `CANCELLED`, `REFUND`, `PARTIAL_REFUND`:
	- `reason` (or `statusReason`) required

---

## API Reference (Created/Updated)

## A) Seller/Admin status APIs

### 1. Update order status (primary)
- `PUT /api/seller/orders/update-status/:orderId`
- Roles: `SELLER`, `ADMIN`

Request:
```json
{
	"status": "processing",
	"trackingNumber": "required for shipped",
	"estimatedDelivery": "required for shipped",
	"reason": "required for cancelled/refund/partial_refund"
}
```

### 2. Update tracking (legacy flow)
- `PUT /api/seller/orders/tracking/:orderId`
- Roles: `SELLER`, `ADMIN`
- Still transitions to `SHIPPED`, now validated by rules.

Request:
```json
{
	"trackingNumber": "TRK12345",
	"estimatedDelivery": "2026-03-10T00:00:00.000Z"
}
```

### 3. Alternate workflow status endpoint
- `PATCH /api/seller/orders/:orderId/status`
- Roles: `SELLER`, `ADMIN`

Request:
```json
{
	"status": "shipped",
	"trackingNumber": "TRK12345",
	"estimatedDelivery": "2026-03-10T00:00:00.000Z",
	"reason": "required for cancelled/refund/partial_refund",
	"notes": "optional"
}
```

### 4. Seller/Admin operational endpoints (existing)
- `GET /api/seller/notifications`
- `GET /api/seller/sla-dashboard`
- `PATCH /api/seller/notifications/:notificationId/acknowledge`

---

## B) Customer order/refund APIs

### 1. Cancel order (updated)
- `PUT /api/orders/cancel/:id`
- Role: `CUSTOMER`

Request:
```json
{
	"reason": "Customer cancellation reason"
}
```

Validation:
- only for `PENDING` / `CONFIRMED`
- reason mandatory

### 2. Create refund/partial-refund request (new)
- `POST /api/orders/refund-request/:id`
- Role: `CUSTOMER`

Request:
```json
{
	"requestType": "refund",
	"reason": "Item damaged"
}
```

`requestType`:
- `refund`
- `partial_refund`

Behavior:
- validates ownership + eligibility
- creates `SupportTicket` with `category = REFUND_REQUEST`
- notifies admins + involved sellers
- creates acknowledgement notification for customer

> Note: this API creates a review request, it does not instantly set order status to `REFUND` / `PARTIAL_REFUND`.

### 3. Track all my refund requests (new)
- `GET /api/orders/refund-requests`
- Role: `CUSTOMER`

Returns request list with:
- `requestId`, `orderId`, `requestType`, `reason`
- `status`, `priority`, `adminResponse`
- `createdAt`, `updatedAt`

### 4. Track one refund request (new)
- `GET /api/orders/refund-requests/:requestId`
- Role: `CUSTOMER`

Returns single request details.

Refund request status values:
- `OPEN`
- `IN_PROGRESS`
- `RESOLVED`
- `CLOSED`

## C) Guest refund APIs (new)

> Important: This backend project does **not** create a frontend page/route like `/guest/refund`.
> It only provides APIs under `/api/orders/guest/*`. The UI page should be implemented in your WebApp project.

### 1. Create guest refund/partial-refund request
- `POST /api/orders/guest/refund-request`
- Public endpoint (verification via `orderId + customerEmail`)

Request:
```json
{
	"orderId": "order_cuid_here",
	"customerEmail": "guest@example.com",
	"requestType": "refund",
	"reason": "Item damaged"
}
```

Validation:
- order must exist
- order must be a guest order (`userId` is null)
- `customerEmail` must match order email
- same eligibility and reason rules as customer flow

Behavior:
- creates `SupportTicket` with `category = REFUND_REQUEST`
- stores `orderId`, `guestEmail`, `requestType` for structured tracking
- notifies admins + involved sellers

### 2. Track all guest refund requests
- `GET /api/orders/guest/refund-requests?orderId=...&customerEmail=...`

### 3. Track single guest refund request
- `GET /api/orders/guest/refund-requests/:requestId?orderId=...&customerEmail=...`

Returns same request structure and status lifecycle as customer tracking APIs.

Response shape used by customer + guest tracking APIs:
```json
{
	"id": "ticketId",
	"orderId": "orderId",
	"requestType": "REFUND | PARTIAL_REFUND",
	"reason": "Customer reason",
	"status": "OPEN | IN_PROGRESS | RESOLVED | CLOSED",
	"adminResponse": null,
	"createdAt": "ISO Date",
	"updatedAt": "ISO Date",
	"guestEmail": "guest@example.com"
}
```

Security rules implemented for all 3 guest endpoints:
- IP rate limit: 5 requests/minute
- strict email verification: `customerEmail` must match `order.customerEmail`
- guest-only guard: endpoint rejects non-guest orders (`order.userId` must be null)
- schema supports guest tickets: `SupportTicket.userId` is nullable

---

## RBAC Integration Requirements in One Panel

## Admin
Must be able to:
- update order status through allowed transitions
- provide reason for `CANCELLED` / `REFUND` / `PARTIAL_REFUND`
- provide tracking + ETA for `SHIPPED`
- review customer refund requests and process via status update flow
- monitor operations via notifications and SLA widgets

## Seller
Must be able to:
- update status only for their own order items
- follow same mandatory rules as admin:
	- reason for cancel/refund/partial-refund
	- tracking + ETA for shipped
- view and act on refund requests related to their orders

## Customer
Must be able to:
- cancel eligible order with mandatory reason
- create refund/partial-refund request with mandatory reason
- track refund request list and detail status

## Guest
Must be able to:
- create refund/partial-refund request using `orderId + customerEmail` verification
- track refund request list and detail status using `orderId + customerEmail`

---

## Frontend Implementation Checklist (RBAC)

1. Build a single order action component with role-based visibility.
2. For each order, compute and show only allowed next statuses.
3. Add modal/form validation:
	 - shipped: tracking + ETA required
	 - cancelled/refund/partial-refund: reason required
4. Add customer refund request flow:
	 - create request
	 - list requests
	 - view request detail
5. Add guest refund request flow:
	 - create request (with `orderId + customerEmail`)
	 - list requests
	 - view request detail
6. Show backend error `message` directly for quick debugging.
7. Disable action controls when order is in terminal status.

---

## Suggested UI Action Matrix

### By current order status
- `CONFIRMED`:
	- Admin/Seller: `PROCESSING`, `CANCELLED`
	- Customer: `CANCELLED` (if cancellation policy allows)
- `PROCESSING`:
	- Admin/Seller: `SHIPPED`, `CANCELLED`
	- Customer: no status update action
- `SHIPPED`:
	- Admin/Seller: `DELIVERED`, `CANCELLED`
	- Customer: no status update action
- `DELIVERED`:
	- Admin/Seller: `REFUND`, `PARTIAL_REFUND`
	- Customer: create refund request API
- `CANCELLED` / `REFUND` / `PARTIAL_REFUND`:
	- all roles: no further status changes

---

## Common Error Cases to Handle in UI
- `400` invalid transition
- `400` missing required fields
- `403` unauthorized
- `404` order/request not found

Always render backend `message` in toast/snackbar.

---

## Deployment / QA Checklist
1. Run migration in all environments.
2. Restart API service.
3. QA all role flows in one panel with RBAC toggles:
	 - Seller/Admin transitions
	 - mandatory shipment info
	 - mandatory reason on cancel/refund/partial-refund
	 - customer refund request create/list/detail
	 - guest refund request create/list/detail
4. Confirm notifications are generated for relevant role users.

### Migration commands
```bash
npx prisma migrate deploy
```

Expected new migrations to be applied:
- `20260303000000_add_refund_status_and_order_reason`
- `20260303010000_support_ticket_guest_refund_tracking`

---

## Backend File References
- `utils/orderStatusRules.js`
- `controllers/orders.js`
- `controllers/sellerOrders.js`
- `controllers/orderNotification.js`
- `controllers/notification.js`
- `controllers/admin.js`
- `routes/orderRoutes.js`
- `routes/sellerOrderRoutes.js`
- `routes/orderNotificationRoutes.js`
- `prisma/schema.prisma`
- `prisma/migrations/20260303000000_add_refund_status_and_order_reason/migration.sql`
- `prisma/migrations/20260303010000_support_ticket_guest_refund_tracking/migration.sql`
