# Audit Logs — Dashboard Integration Guide

> **For:** Frontend / Dashboard Dev Team  
> **Backend Status:** ✅ Live in production  
> **Base URL:** All endpoints are under `/api/admin/` and require an **Admin JWT token**.

---

## 1. Overview

The backend now records an immutable log entry every time a **Product** is created, updated, deleted, approved, rejected, activated, or deactivated — by any user type (Admin or Seller).

Each log entry captures:
- **What** happened (action name)
- **Who** did it (actor ID, email, role, IP address)
- **When** it happened (timestamp)
- **What changed** (full before/after JSON snapshots + a `changedFields` array)
- **Why** (optional reason field, e.g. rejection reason)

The table is **append-only** — rows are never edited or deleted, making it a reliable audit trail.

---

## 2. API Endpoints

### 2.1 — Get All Audit Logs (filterable)

```
GET /api/admin/audit-logs
```

**Auth:** Bearer token (Admin only)

#### Query Parameters

| Parameter    | Type   | Required | Description                                                   | Example                  |
|--------------|--------|----------|---------------------------------------------------------------|--------------------------|
| `entityType` | string | No       | Filter by entity. Currently only `PRODUCT` is active.        | `PRODUCT`                |
| `entityId`   | string | No       | Filter by the specific record ID (e.g. a product ID)         | `clx123abc`              |
| `action`     | string | No       | Filter by a specific action (see Section 4 for all values)   | `PRODUCT_APPROVED`       |
| `actorId`    | string | No       | Filter by the user who performed the action                  | `clxuser456`             |
| `from`       | string | No       | Start of date range (ISO 8601)                               | `2026-01-01T00:00:00Z`   |
| `to`         | string | No       | End of date range (ISO 8601)                                 | `2026-03-31T23:59:59Z`   |
| `page`       | number | No       | Page number (default: `1`)                                   | `2`                      |
| `limit`      | number | No       | Results per page (default: `50`, max: `200`)                 | `25`                     |

#### Example Request

```http
GET /api/admin/audit-logs?entityType=PRODUCT&action=PRODUCT_APPROVED&from=2026-03-01&page=1&limit=20
Authorization: Bearer <admin_token>
```

#### Success Response `200`

```json
{
  "success": true,
  "data": [
    {
      "id": "cm7abc123",
      "entityType": "PRODUCT",
      "entityId": "cm7product456",
      "action": "PRODUCT_APPROVED",
      "actorId": "cm7admin789",
      "actorEmail": "admin@alpa.com.au",
      "actorRole": "ADMIN",
      "actorIp": "203.0.113.5",
      "previousData": {
        "id": "cm7product456",
        "title": "Handcrafted Bowl",
        "status": "PENDING",
        "isActive": false
      },
      "newData": {
        "id": "cm7product456",
        "title": "Handcrafted Bowl",
        "status": "ACTIVE",
        "isActive": true,
        "rejectionReason": null
      },
      "changedFields": ["status", "isActive", "rejectionReason"],
      "reason": null,
      "userAgent": "Mozilla/5.0 ...",
      "requestId": null,
      "createdAt": "2026-03-06T10:45:00.000Z"
    }
  ],
  "meta": {
    "total": 142,
    "page": 1,
    "limit": 20,
    "pages": 8
  }
}
```

---

### 2.2 — Get Full History for One Product

```
GET /api/admin/audit-logs/products/:productId
```

**Auth:** Bearer token (Admin only)

#### Path Parameters

| Parameter   | Type   | Required | Description         |
|-------------|--------|----------|---------------------|
| `productId` | string | Yes      | The product's `id`  |

#### Query Parameters

| Parameter | Type   | Required | Description                          |
|-----------|--------|----------|--------------------------------------|
| `page`    | number | No       | Page number (default: `1`)           |
| `limit`   | number | No       | Results per page (default: `50`)     |

#### Example Request

```http
GET /api/admin/audit-logs/products/cm7product456?page=1&limit=50
Authorization: Bearer <admin_token>
```

#### Success Response `200`

```json
{
  "success": true,
  "productId": "cm7product456",
  "data": [ /* same log entry shape as above */ ],
  "meta": {
    "total": 7,
    "page": 1,
    "limit": 50,
    "pages": 1
  }
}
```

---

## 3. Log Entry — Full Field Reference

| Field          | Type            | Always Present | Description                                                                 |
|----------------|-----------------|----------------|-----------------------------------------------------------------------------|
| `id`           | string (cuid)   | ✅             | Unique log entry ID                                                         |
| `entityType`   | string          | ✅             | Type of entity affected. Currently always `"PRODUCT"`                      |
| `entityId`     | string          | ✅             | Primary key of the affected record. `"BULK"` for bulk operations            |
| `action`       | string          | ✅             | What happened — see Section 4                                               |
| `actorId`      | string \| null  | —              | User ID of who performed the action. `null` for scheduled/system actions    |
| `actorEmail`   | string \| null  | —              | Email at time of action (denormalised — survives user deletion)             |
| `actorRole`    | string \| null  | —              | `"ADMIN"`, `"SELLER"`, `"CUSTOMER"`, or `"SYSTEM"`                        |
| `actorIp`      | string \| null  | —              | Client IP address                                                           |
| `previousData` | object \| null  | —              | Full product snapshot **before** the change. `null` for CREATED events     |
| `newData`      | object \| null  | —              | Full product snapshot **after** the change. `null` for DELETED events      |
| `changedFields`| string[]        | ✅             | Array of field names that changed, e.g. `["price", "status", "isActive"]`  |
| `reason`       | string \| null  | —              | Human-readable reason (rejection reason, deactivation reason, etc.)        |
| `userAgent`    | string \| null  | —              | Browser / client info from the request                                     |
| `requestId`    | string \| null  | —              | Correlation ID from `x-request-id` header if sent by client               |
| `createdAt`    | ISO 8601 string | ✅             | Timestamp of when the action occurred. **Never changes after insert.**      |

---

## 4. Action Reference — All Possible Values

| Action Value                             | Triggered By    | Description                                               |
|------------------------------------------|-----------------|-----------------------------------------------------------|
| `PRODUCT_CREATED`                        | Seller / Admin  | A new product was submitted                               |
| `PRODUCT_UPDATED`                        | Seller / Admin  | Product details were edited                               |
| `PRODUCT_DELETED`                        | Seller / Admin  | Product was permanently deleted                           |
| `PRODUCT_APPROVED`                       | Admin           | Admin approved a pending product                          |
| `PRODUCT_REJECTED`                       | Admin           | Admin rejected a product (check `reason` field)          |
| `PRODUCT_ACTIVATED`                      | Admin           | Admin manually set a product live                         |
| `PRODUCT_DEACTIVATED`                    | Admin           | Admin manually hid a product (check `reason` field)      |
| `PRODUCT_BULK_APPROVED`                  | Admin           | Admin bulk-approved multiple products at once             |
| `PRODUCT_AUTO_DEACTIVATED_LOW_STOCK`     | System          | Product auto-deactivated because stock ≤ 2               |

> **Note for future entities:** When Order and User audit logs are added, new `entityType` values (`ORDER`, `USER`) and new action values will appear. The same two endpoints handle them — just filter by `entityType`.

---

## 5. Suggested Dashboard UI Components

### 5.1 — Global Audit Log Page (`/admin/audit-logs`)

A full-featured filterable table showing all log events across all products. Recommended columns:

| Column        | Source Field              | Notes                                      |
|---------------|---------------------------|--------------------------------------------|
| Date & Time   | `createdAt`               | Format as local time, show relative time on hover |
| Entity        | `entityType` + `entityId` | Link `entityId` to the product detail page |
| Action        | `action`                  | Display as a coloured badge (see Section 6)|
| Actor         | `actorEmail` + `actorRole`| Show role as a small tag next to email     |
| Changed Fields| `changedFields`           | Comma-separated pill tags                  |
| Reason        | `reason`                  | Show dash (`—`) if null                   |
| Details       | —                         | "View diff" button → opens diff modal      |

**Filters to expose in the UI:**
- Date range picker → `from` / `to`
- Action dropdown (multi-select) → `action`
- Actor search (by email or ID) → `actorId`
- Entity type selector (for future-proofing) → `entityType`

---

### 5.2 — Product History Panel (`/admin/products/:productId`)

Embed a timeline/history tab inside the existing product detail page. Each entry shows:

```
[ Badge: PRODUCT_APPROVED ]   March 6, 2026 at 10:45 AM
  By: admin@alpa.com.au (ADMIN)   IP: 203.0.113.5
  Changed: status, isActive, rejectionReason
  [ View Diff button ]
```

Fetch from:
```
GET /api/admin/audit-logs/products/:productId
```

---

### 5.3 — Diff Modal Component

When the user clicks "View Diff", open a modal showing a side-by-side or unified diff of `previousData` vs `newData`.

Highlight only the keys listed in `changedFields` to keep the view focused.

**Recommended library:** [`jsondiffpatch`](https://github.com/benjamine/jsondiffpatch) or a simple custom renderer.

---

## 6. Recommended Action Badge Colours

| Action                                  | Colour Suggestion          |
|-----------------------------------------|----------------------------|
| `PRODUCT_CREATED`                       | Blue (`#3B82F6`)           |
| `PRODUCT_UPDATED`                       | Yellow / Amber (`#F59E0B`) |
| `PRODUCT_DELETED`                       | Red (`#EF4444`)            |
| `PRODUCT_APPROVED`                      | Green (`#10B981`)          |
| `PRODUCT_REJECTED`                      | Red (`#EF4444`)            |
| `PRODUCT_ACTIVATED`                     | Green (`#10B981`)          |
| `PRODUCT_DEACTIVATED`                   | Orange (`#F97316`)         |
| `PRODUCT_BULK_APPROVED`                 | Teal (`#14B8A6`)           |
| `PRODUCT_AUTO_DEACTIVATED_LOW_STOCK`    | Orange (`#F97316`)         |

---

## 7. Pagination Pattern

All endpoints return a `meta` object. Use it to drive pagination:

```json
"meta": {
  "total": 142,   // total matching records
  "page": 1,      // current page
  "limit": 20,    // records per page
  "pages": 8      // total pages = ceil(total / limit)
}
```

Pass `?page=2&limit=20` in the next request to get the next page.

---

## 8. Error Responses

| HTTP Code | Meaning                                      |
|-----------|----------------------------------------------|
| `401`     | Missing or invalid Bearer token              |
| `403`     | Authenticated but not an Admin               |
| `500`     | Server error — check `message` field         |

```json
{
  "success": false,
  "message": "Description of the error"
}
```

---

## 9. Notes & Constraints

- Logs are **read-only** from the dashboard — there are no endpoints to edit or delete entries.
- The `previousData` and `newData` fields are sanitised: sensitive fields like `password`, `otp`, and `bankDetails` are **never stored**.
- `entityId` is `"BULK"` for `PRODUCT_BULK_APPROVED` — `newData.productIds` will contain the full list of approved IDs.
- All timestamps (`createdAt`) are in **UTC**. Convert to local timezone on the frontend.
- The `limit` parameter is capped at `200` server-side regardless of what is sent.
