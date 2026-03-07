# Product Active / Inactive Workflow — Dashboard Integration Guide

**Backend version:** March 7, 2026  
**Prepared for:** Frontend / Dashboard Team  

---

## Overview of Changes

The product activation flow has been redesigned so that:

- **Sellers** can **deactivate** their own active products (with a mandatory reason).
- **Sellers** can **submit a deactivated / rejected product for review** — this moves it to `PENDING` and notifies admins.
- **Sellers CANNOT directly make a product active** — only an admin can approve/activate.
- **Admins** can **activate or deactivate** any product, but **deactivation now requires a reason** (mandatory).

---

## Product Status Values

| Status | Meaning | Who can set it |
|---|---|---|
| `PENDING` | Newly created, or seller submitted for review | System / Seller (submit for review) |
| `ACTIVE` | Live and visible to buyers | Admin only |
| `INACTIVE` | Hidden from buyers | Admin (with reason) or Seller (with reason) |
| `REJECTED` | Admin rejected it | Admin only |

---

## New / Changed API Endpoints

### 1. Seller — Deactivate My Product

**`PUT /api/products/:id/deactivate`**

> Seller deactivates their own **ACTIVE** product. A reason is **required**.

**Auth:** Seller JWT token  
**Allowed product status:** `ACTIVE` only

**Request Body:**
```json
{
  "reason": "I am restocking, will be back in 2 weeks."
}
```

**Success Response `200`:**
```json
{
  "success": true,
  "message": "Product deactivated successfully."
}
```

**Error Response `400` — reason missing:**
```json
{
  "success": false,
  "message": "A reason is required to deactivate your product."
}
```

**Error Response `400` — wrong status:**
```json
{
  "success": false,
  "message": "Product cannot be deactivated — current status is PENDING. Only ACTIVE products can be deactivated."
}
```

**What happens after:**
- Product status → `INACTIVE`, removed from storefront.
- Admin receives in-app notification + email with the reason.
- Seller receives a confirmation email.

---

### 2. Seller — Submit Product for Review (Request Re-activation)

**`POST /api/products/:id/submit-review`**

> Seller requests admin to review and activate a product that is `INACTIVE` or `REJECTED`.  
> An optional note can be sent to the admin.  
> **This does NOT activate the product** — it moves it to `PENDING` and waits for admin decision.

**Auth:** Seller JWT token  
**Allowed product status:** `INACTIVE` or `REJECTED` only

**Request Body:**
```json
{
  "reviewNote": "I have updated the images and description. Please review again."
}
```
> `reviewNote` is **optional**. Send empty body `{}` if no note.

**Success Response `200`:**
```json
{
  "success": true,
  "message": "Product submitted for review. An admin will review and approve it shortly."
}
```

**Error Response `400` — wrong status:**
```json
{
  "success": false,
  "message": "Product cannot be submitted for review — current status is ACTIVE. Only INACTIVE or REJECTED products can be submitted."
}
```

**What happens after:**
- Product status → `PENDING`.
- Admin receives in-app notification + email with the seller's note.
- Seller receives a confirmation email that the request is under review.
- Admin then approves or rejects via their existing dashboard controls.

---

### 3. Admin — Deactivate Product *(CHANGED — reason now required)*

**`PUT /api/admin/products/deactivate/:productId`**

> Admin deactivates a seller's product. A reason is now **mandatory**.

**Auth:** Admin JWT token

**Request Body:**
```json
{
  "reason": "Product images do not meet quality standards."
}
```

**Error Response `400` — reason missing:**
```json
{
  "success": false,
  "message": "A reason is required when deactivating a product. The seller will be notified with this reason."
}
```

**What happens after:**
- Product status → `INACTIVE`.
- Seller receives in-app notification + email with the admin's reason.

---

### 4. Admin — Activate Product *(unchanged)*

**`PUT /api/admin/products/activate/:productId`**

> Admin sets a product to `ACTIVE`. No body required.

---

### 5. Admin — Approve Product *(unchanged)*

**`POST /api/admin/products/approve/:productId`**

> Approves a `PENDING` product → sets to `ACTIVE`.

---

### 6. Admin — Reject Product *(unchanged)*

**`POST /api/admin/products/reject/:productId`**

**Request Body:**
```json
{
  "reason": "Product does not comply with marketplace guidelines."
}
```

---

## Dashboard UI Changes Required

### Seller Dashboard — Product List / Product Detail Page

#### For each `ACTIVE` product:
- Show a **"Deactivate"** button.
- On click, open a **modal / drawer** asking for a reason (text area, required field).
- Submit to `PUT /api/products/:id/deactivate` with `{ reason }`.
- On success: update product status badge to `INACTIVE`.

#### For each `INACTIVE` or `REJECTED` product:
- Show a **"Submit for Review"** button (instead of any "Activate" or "Make Live" button).
- On click, optionally show a text area: *"Add a note for the admin (optional)"*.
- Submit to `POST /api/products/:id/submit-review` with `{ reviewNote }`.
- On success: update product status badge to `PENDING`.
- Show a message: *"Your product has been submitted for review. You'll be notified once an admin reviews it."*

#### For each `PENDING` product:
- Show a **disabled / read-only** badge: *"Awaiting Admin Review"*.
- No activate/deactivate buttons — seller cannot take action on a pending product.

> ⚠️ **Remove any existing "Make Active" or "Activate" button from the seller side entirely.**  
> Sellers can only go: `ACTIVE → INACTIVE` (deactivate) or `INACTIVE/REJECTED → PENDING` (submit for review).

---

### Admin Dashboard — Product List / Product Detail Page

#### For each product:
- Keep existing **"Approve"** and **"Reject"** buttons for `PENDING` products.
- Keep existing **"Activate"** button.
- **"Deactivate" button** — now must open a modal asking for a reason (required).
  - Disallow submitting without a reason — the API will return a `400` error if reason is empty.

#### Product detail view — new fields to display:
| Field | Show when |
|---|---|
| `reviewNote` | Status is `PENDING` — *"Seller's note to admin"* |
| `sellerInactiveReason` | Status is `INACTIVE` and deactivated by seller — *"Seller's reason for deactivating"* |
| `rejectionReason` | Status is `REJECTED` or admin-deactivated — *"Admin reason"* |

---

## Product Status Badge Colour Guide (suggestion)

| Status | Colour |
|---|---|
| `ACTIVE` | Green |
| `PENDING` | Orange / Amber |
| `INACTIVE` | Grey |
| `REJECTED` | Red |

---

## Summary Flow Diagram

```
SELLER SIDE
===========

[ACTIVE product]
    └─ Seller clicks "Deactivate" + enters reason
        └─ PUT /products/:id/deactivate { reason }
            └─ Status → INACTIVE
                └─ Admin notified with reason

[INACTIVE / REJECTED product]
    └─ Seller clicks "Submit for Review" + optional note
        └─ POST /products/:id/submit-review { reviewNote? }
            └─ Status → PENDING
                └─ Admin notified with seller's note

[PENDING product]
    └─ No seller action available — awaiting admin


ADMIN SIDE
==========

[PENDING product]
    └─ Admin clicks "Approve"
        └─ POST /admin/products/approve/:id
            └─ Status → ACTIVE ✅

    └─ Admin clicks "Reject" + reason
        └─ POST /admin/products/reject/:id { reason }
            └─ Status → REJECTED ❌

[ACTIVE product]
    └─ Admin clicks "Deactivate" + reason (required)
        └─ PUT /admin/products/deactivate/:id { reason }
            └─ Status → INACTIVE

[INACTIVE product]
    └─ Admin clicks "Activate"
        └─ PUT /admin/products/activate/:id
            └─ Status → ACTIVE ✅
```

---

## Emails Sent (for reference)

| Trigger | Email sent to |
|---|---|
| Seller deactivates product | Seller (confirmation) + All Admins (reason included) |
| Seller submits for review | Seller (confirmation) + All Admins (with note) |
| Admin approves product | Seller |
| Admin rejects product | Seller (with reason) |
| Admin activates product | Seller |
| Admin deactivates product | Seller (with reason) |

---

*For questions contact the backend team.*
