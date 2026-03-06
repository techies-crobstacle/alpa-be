# Product Recycle Bin & Restore — Dashboard Integration Guide

> **For:** Frontend / Dashboard Dev Team  
> **Backend Status:** ✅ Live in production  
> **Base URL:** All authenticated endpoints require a Bearer token in the `Authorization` header.  
> **Existing setup:** No changes required to existing product list, product detail, or approval flow pages.

---

## 1. Overview

When a Seller or Admin **deletes a product**, it is no longer hard-removed from the database. Instead it is **soft-deleted** — moved to a Recycle Bin. It is invisible on all public and admin product lists automatically.

From the Recycle Bin:
- **Sellers** can restore their own products (goes back to `PENDING`, requiring re-approval)
- **Admins** can restore any product (goes back to `INACTIVE`, admin activates manually)
- **Admins** can permanently (hard) delete a product — this is irreversible

Every action (delete, restore, permanent delete) is recorded in the **Audit Log** with full who/when/what detail.

---

## 2. What Changed on Existing Endpoints

> ⚠️ No frontend changes are needed for existing product flows. The changes below are purely backend — deleted products are filtered out automatically.

| Existing Endpoint | Change |
|---|---|
| `GET /api/products/all` | Deleted products no longer appear |
| `GET /api/products/:id` | Returns `404` for deleted products |
| `GET /api/products/my-products` | Deleted products no longer appear |
| `GET /api/admin/products` | Deleted products excluded from all tabs |
| `GET /api/admin/sellers/:sellerId/products` | Deleted products excluded |
| `DELETE /api/products/:id` | Now returns a **soft-delete** success message instead of permanent deletion |

**Previous delete response:**
```json
{ "success": true, "message": "Product deleted successfully" }
```
**New delete response:**
```json
{ "success": true, "message": "Product moved to Recycle Bin. It can be restored from there." }
```

Update any toast/snackbar copy on the delete confirmation UI to reflect that the product is recoverable.

---

## 3. New API Endpoints

### 3.1 — Seller: View Own Recycle Bin

```
GET /api/products/recycle-bin
```

**Auth:** Seller Bearer token  
**Returns:** All soft-deleted products belonging to the authenticated seller, newest-deleted first.

#### Success Response `200`

```json
{
  "success": true,
  "count": 2,
  "products": [
    {
      "id": "cm7product456",
      "title": "Handcrafted Bowl",
      "price": "45.00",
      "category": "Ceramics",
      "stock": 3,
      "sellerId": "cm7seller123",
      "sellerName": "Earth & Fire Studio",
      "status": "INACTIVE",
      "featuredImage": "https://res.cloudinary.com/...",
      "galleryImages": [],
      "tags": ["handmade", "ceramic"],
      "rejectionReason": null,
      "deletedAt": "2026-03-06T11:30:00.000Z",
      "deletedBy": "cm7seller123",
      "deletedByRole": "SELLER",
      "createdAt": "2026-01-15T08:00:00.000Z",
      "updatedAt": "2026-03-06T11:30:00.000Z"
    }
  ]
}
```

---

### 3.2 — Seller: Restore a Product

```
POST /api/products/:id/restore
```

**Auth:** Seller Bearer token  
**Returns:** Confirmation with restored status. Seller can only restore their own products.

#### Success Response `200`

```json
{
  "success": true,
  "message": "Product restored and submitted for admin review.",
  "restoredStatus": "PENDING"
}
```

#### Error Responses

| Code | Scenario |
|---|---|
| `400` | Product is not in the Recycle Bin |
| `403` | Product belongs to a different seller |
| `404` | Product ID not found |

> After restoration, the product appears back in the seller's `My Products` list with status `PENDING`. Admin approval is required before it goes live again.

---

### 3.3 — Admin: View Full Recycle Bin

```
GET /api/admin/products/recycle-bin
```

**Auth:** Admin Bearer token

#### Query Parameters

| Parameter  | Type   | Required | Description                            | Example       |
|------------|--------|----------|----------------------------------------|---------------|
| `sellerId` | string | No       | Filter to a specific seller's bin      | `cm7seller123`|
| `page`     | number | No       | Page number (default: `1`)             | `2`           |
| `limit`    | number | No       | Results per page (default: `50`, max: `200`) | `25`    |

#### Success Response `200`

```json
{
  "success": true,
  "products": [
    {
      "id": "cm7product456",
      "title": "Handcrafted Bowl",
      "price": "45.00",
      "category": "Ceramics",
      "stock": 3,
      "sellerId": "cm7seller123",
      "sellerName": "Earth & Fire Studio",
      "status": "INACTIVE",
      "featuredImage": "https://res.cloudinary.com/...",
      "deletedAt": "2026-03-06T11:30:00.000Z",
      "deletedBy": "cm7seller123",
      "deletedByRole": "SELLER",
      "createdAt": "2026-01-15T08:00:00.000Z",
      "updatedAt": "2026-03-06T11:30:00.000Z",
      "seller": {
        "id": "cm7seller123",
        "name": "Jane Doe",
        "email": "jane@earthfire.com.au"
      }
    }
  ],
  "meta": {
    "total": 18,
    "page": 1,
    "limit": 50,
    "pages": 1
  }
}
```

---

### 3.4 — Admin: Restore a Product

```
POST /api/admin/products/:productId/restore
```

**Auth:** Admin Bearer token

#### Success Response `200`

```json
{
  "success": true,
  "message": "Product restored. Set it to Active when ready.",
  "restoredStatus": "INACTIVE"
}
```

> After admin restoration the product is `INACTIVE` and hidden from the public. Admin must manually activate it via the existing `PUT /api/admin/products/activate/:productId` endpoint.

---

### 3.5 — Admin: Permanently Delete a Product

```
DELETE /api/admin/products/:productId/permanent
```

**Auth:** Admin Bearer token  
**⚠️ Irreversible.** Only works on products already in the Recycle Bin.

#### Request Body (optional)

```json
{ "reason": "Duplicate listing removed by admin" }
```

#### Success Response `200`

```json
{
  "success": true,
  "message": "Product permanently deleted. This action cannot be undone."
}
```

#### Error Responses

| Code | Scenario |
|---|---|
| `400` | Product is not in the Recycle Bin (still live) |
| `404` | Product not found |

---

## 4. Recycle Bin Field Reference

These fields are present on every product in Recycle Bin responses:

| Field           | Type              | Description                                                   |
|-----------------|-------------------|---------------------------------------------------------------|
| `deletedAt`     | ISO 8601 \| null  | Timestamp of when it was soft-deleted. Always set for Recycle Bin items. |
| `deletedBy`     | string \| null    | `userId` of who deleted it                                    |
| `deletedByRole` | string \| null    | `"ADMIN"` or `"SELLER"`                                       |

---

## 5. Audit Log Actions — New Entries

The following new actions now appear in `GET /api/admin/audit-logs`:

| `action` value              | Trigger                              | `previousData` | `newData`     |
|-----------------------------|--------------------------------------|----------------|---------------|
| `PRODUCT_DELETED`           | Soft delete (moved to Recycle Bin)   | Full product snapshot before deletion | Product with `deletedAt`, `deletedBy`, `isActive: false` |
| `PRODUCT_RESTORED`          | Restored from Recycle Bin            | Product in deleted state | Product with `deletedAt: null`, restored `status` |
| `PRODUCT_PERMANENTLY_DELETED` | Admin hard-deleted from Recycle Bin | Final product snapshot | `null` |

The `reason` field contains the restore note or deletion reason where provided.

---

## 6. Suggested UI Components

### 6.1 — Seller Dashboard: "Recycle Bin" Tab

Add a **"Recycle Bin"** tab or link inside the seller's **My Products** page.

**Recommended placement:** Secondary tab next to the existing product list tabs (All / Pending / Active / Rejected).

**Each row should show:**
- Product thumbnail + title
- Category, price, stock at time of deletion
- `Deleted on: 6 Mar 2026 at 11:30 AM` — format `deletedAt` in local time
- `Deleted by: You` (if `deletedBy === currentUser.id`) or `Deleted by: Admin`
- `Restore` button → calls `POST /api/products/:id/restore`

**After restore:** Remove from Recycle Bin view and show a toast:
> *"Product restored and submitted for admin review. It will go live once approved."*

---

### 6.2 — Admin Dashboard: "Recycle Bin" Section

Add a **Recycle Bin** page under the Products section in the admin sidebar (e.g. `/admin/products/recycle-bin`).

**Page features:**
- Table with columns: Thumbnail, Title, Seller, Deleted On, Deleted By (role badge), Actions
- Filter by seller using the existing seller search — pass `?sellerId=xxx`
- Pagination using the `meta` object

**Per-row actions:**
| Button | Action | Confirmation required? |
|---|---|---|
| `Restore` | `POST /api/admin/products/:productId/restore` | No |
| `Delete Permanently` | `DELETE /api/admin/products/:productId/permanent` | **Yes** — show a destructive confirmation dialog |

**Permanent delete confirmation dialog copy:**
> **"Permanently delete this product?"**  
> This will remove *"[Product Title]"* and all associated data forever. This action cannot be undone.  
> [ Cancel ] [ Delete Permanently ]

---

### 6.3 — "Deleted By" Badge

When displaying who deleted a product, map `deletedByRole` to a badge:

| `deletedByRole` | Badge label | Colour |
|---|---|---|
| `SELLER` | Deleted by Seller | Orange |
| `ADMIN` | Deleted by Admin | Red |

---

### 6.4 — Update Delete Confirmation Dialog (Existing)

The existing delete confirmation on the product listing should be updated to reflect the new soft-delete behaviour:

**Old copy:**
> *"Are you sure you want to delete this product? This cannot be undone."*

**New copy:**
> *"Delete this product? It will be moved to your Recycle Bin where you can restore it anytime."*

---

## 7. Restore Flow Summary

```
Seller deletes product
        │
        ▼
  Recycle Bin
  (hidden from public,
   hidden from product lists)
        │
   ┌────┴────────────────────────────────────┐
   │  Seller restores       Admin restores   │
   ▼                        ▼               │
status = PENDING         status = INACTIVE  │
(needs admin approval)   (admin activates)  │
                                            │
                         Admin permanently  │
                         deletes → GONE ────┘
```

---

## 8. Recycle Bin Audit History

The existing product audit history endpoint **automatically includes** Recycle Bin events. No extra calls needed — the history panel on the product detail page will show the full lifecycle:

```
GET /api/admin/audit-logs/products/:productId
```

Example timeline for a restored product:

```
[ PRODUCT_RESTORED ]        6 Mar 2026, 2:00 PM
  By: admin@alpa.com.au (ADMIN)
  Reason: Restored by ADMIN. Status set to INACTIVE.

[ PRODUCT_DELETED ]         6 Mar 2026, 11:30 AM
  By: seller@earthfire.com.au (SELLER)

[ PRODUCT_APPROVED ]        15 Jan 2026, 9:00 AM
  By: admin@alpa.com.au (ADMIN)

[ PRODUCT_CREATED ]         15 Jan 2026, 8:00 AM
  By: seller@earthfire.com.au (SELLER)
```

---

## 9. Notes & Constraints

- Products in the Recycle Bin are **invisible on all public-facing pages** automatically — no frontend filtering needed.
- `deletedAt` is always **UTC**. Convert to local timezone for display.
- The `limit` parameter is capped at `200` server-side.
- Only **Admin** can permanently delete. Sellers cannot bypass the Recycle Bin.
- A seller restoring a product sends it back through the **normal approval workflow** — it will appear in the admin's Pending queue.
- An admin restoring a product sets it to `INACTIVE` (safe) — it won't accidentally go live until the admin explicitly activates it.
- `PRODUCT_PERMANENTLY_DELETED` audit log entries will persist even after the product row is gone — the `entityId` will no longer resolve to a live product, but the history is preserved.
