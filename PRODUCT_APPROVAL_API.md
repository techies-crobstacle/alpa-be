# Product Approval System — Frontend Integration Guide

## Product Status Lifecycle

```
Seller adds product
        │
        ▼
   ┌─────────┐
   │ PENDING │  ◄─── Seller edits a REJECTED product (auto-reset)
   └────┬────┘
        │   Admin reviews
   ┌────┴────────────────────┐
   ▼                         ▼
┌────────┐              ┌──────────┐
│ ACTIVE │              │ REJECTED │  ← rejectionReason included
└──┬─────┘              └────┬─────┘
   │ Admin deactivates        │ Seller edits → back to PENDING
   ▼                          │
┌──────────┐                  │
│ INACTIVE │                  │
└──────────┘                  │
   │ Admin reactivates         │
   └──────────────────────────┘
```

### Status Meanings

| Status     | `isActive` | Visible to customers | Description                                 |
|------------|-----------|----------------------|---------------------------------------------|
| `PENDING`  | `false`   | No                   | Waiting for admin review                    |
| `ACTIVE`   | `true`    | Yes                  | Approved and live                           |
| `REJECTED` | `false`   | No                   | Admin rejected — seller must edit & resubmit |
| `INACTIVE` | `false`   | No                   | Admin manually deactivated (not a rejection) |

---

## Admin API Endpoints

### 1. Get All Products (with status filter)
```
GET /api/admin/products?status=all&page=1&limit=20
```

**Query Parameters:**

| Param      | Values                                        | Default |
|------------|-----------------------------------------------|---------|
| `status`   | `all` `pending` `approved` `rejected` `inactive` | `all` |
| `sellerId` | seller's user ID (optional filter)            | —       |
| `page`     | page number                                   | `1`     |
| `limit`    | items per page                                | `50`    |

**Response:**
```json
{
  "success": true,
  "products": [
    {
      "id": "...",
      "title": "Gloss Painting",
      "status": "ACTIVE",
      "isActive": true,
      "rejectionReason": null,
      "price": "80.00",
      "stock": 3,
      "seller": {
        "id": "...",
        "name": "John Doe",
        "email": "john@example.com",
        "storeName": "John's Art Studio",
        "businessName": "Studio Co"
      }
    }
  ],
  "count": 10,
  "counts": {
    "all": 25,
    "pending": 5,
    "approved": 10,
    "rejected": 3,
    "inactive": 7
  }
}
```

> Use `counts` to drive the tab badges (e.g. "Pending (5)").

---

### 2. Get Pending Products (unchanged)
```
GET /api/admin/products/pending
```
Returns only `PENDING` products with seller info and `rejectionReason`.

---

### 3. Approve Product
```
POST /api/admin/products/approve/:productId
```
- Sets `status → ACTIVE`, `isActive → true`  
- Clears `rejectionReason`  
- Sends seller notification

---

### 4. Reject Product
```
POST /api/admin/products/reject/:productId
Body: { "reason": "Image quality too low" }
```
- Sets `status → REJECTED`, `isActive → false`  
- Stores `rejectionReason`  
- Sends seller notification  
- Product remains in the seller's dashboard with the reason shown

---

### 5. Activate Product (Admin toggle — not approval)
```
PUT /api/admin/products/activate/:productId
```
Sets `status → ACTIVE`, `isActive → true`. Use for re-enabling a deactivated product.

---

### 6. Deactivate Product (Admin toggle)
```
PUT /api/admin/products/deactivate/:productId
Body: { "reason": "Seasonal stock pause" }   ← optional
```
Sets `status → INACTIVE`, `isActive → false`. Different from rejection — no re-submit required.

---

### 7. Bulk Approve
```
POST /api/admin/products/approve-bulk
Body: { "productIds": ["id1", "id2"] }
```

---

## Seller API

### Get My Products
```
GET /api/products/my-products
```
Now includes `rejectionReason` in each product object.

**Response shape:**
```json
{
  "success": true,
  "products": [
    {
      "id": "...",
      "title": "iPhone 18 Pro Max",
      "status": "REJECTED",
      "isActive": false,
      "rejectionReason": "Images are blurry, please upload clearer photos"
    }
  ]
}
```

### Update (Re-submit) a Rejected Product
```
PUT /api/products/:id
```
When a `SELLER` edits a product:
- `status` resets to `PENDING`
- `isActive` → `false`  
- `rejectionReason` is cleared automatically

---

## Frontend Implementation Guide

### Admin Dashboard — Product Tabs

Render tabs using the `counts` object from `GET /api/admin/products`:

```jsx
const tabs = [
  { key: 'all',      label: 'All',      count: counts.all      },
  { key: 'pending',  label: 'Pending',  count: counts.pending  },
  { key: 'approved', label: 'Approved', count: counts.approved },
  { key: 'rejected', label: 'Rejected', count: counts.rejected },
  { key: 'inactive', label: 'Inactive', count: counts.inactive },
];
```

When a tab is clicked, call:
```
GET /api/admin/products?status=pending    ← etc.
```

### Status Badge Colors (recommended)

| Status     | Color  | Badge style            |
|------------|--------|------------------------|
| `PENDING`  | Yellow | `bg-yellow-100 text-yellow-800` |
| `ACTIVE`   | Green  | `bg-green-100 text-green-800`   |
| `REJECTED` | Red    | `bg-red-100 text-red-800`       |
| `INACTIVE` | Grey   | `bg-gray-100 text-gray-600`     |

### Admin Product Row — Action Buttons

```
PENDING  → [✓ Approve]  [✗ Reject (with reason modal)]
ACTIVE   → [⏸ Deactivate]
REJECTED → [✓ Approve]  [📝 View Reason]
INACTIVE → [▶ Activate]
```

### Seller Dashboard — Product Row

Show `rejectionReason` banner when `status === "REJECTED"`:

```jsx
{product.status === 'REJECTED' && (
  <div className="rejection-banner">
    ❌ Rejected: {product.rejectionReason}
    <button onClick={() => navigate(`/edit-product/${product.id}`)}>
      Edit & Resubmit
    </button>
  </div>
)}
```

---

## Summary of Changes Made to Backend

| Area | What Changed |
|------|-------------|
| DB Schema | `ProductStatus` enum gained `REJECTED` value |
| `rejectProduct` | Now sets `status = 'REJECTED'` (was `INACTIVE`) |
| `approveProduct` | Now clears `rejectionReason` on approval |
| `getMyProducts` | Returns `rejectionReason` field |
| `getAllAdminProducts` | **New endpoint** — `GET /api/admin/products?status=...` with counts |
| `getProductsBySeller` | Returns `rejectionReason` field |
| `getPendingProducts` | Returns `rejectionReason` field |
| `updateProduct` | Clears `rejectionReason` when seller resubmits a rejected product |
