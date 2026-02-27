# Guest Checkout — Frontend Implementation Guide

**Backend Base URL:** `https://alpa-be.onrender.com/api`  
**Stripe Publishable Key:** `pk_live_...` *(replace with your actual key)*

---

## Context & Constraints

- **Payment is Stripe only** — no COD, no other options. This applies to all users (guest and logged-in).
- **Logged-in users:** existing checkout flow is **unchanged**.
- **Guests:** complete checkout without any account. Backend creates the order with `userId = null`.
- **Guest cart lives in `localStorage`** — there is no server-side guest cart.
- A guest's cart is **merged into their account** if they sign in after browsing.

---

## 1. Guest Cart — localStorage

Manage a `guestCart` key in `localStorage` throughout the browsing session.

```js
// Shape
[
  { productId: "cuid...", quantity: 2 },
  { productId: "cuid...", quantity: 1 }
]
```

Implement these shared utilities (reuse across all cart-related components):

```js
export const getGuestCart = () =>
  JSON.parse(localStorage.getItem("guestCart") || "[]");

export const saveGuestCart = (items) =>
  localStorage.setItem("guestCart", JSON.stringify(items));

export const addToGuestCart = (productId, quantity = 1) => {
  const cart = getGuestCart();
  const existing = cart.find((i) => i.productId === productId);
  if (existing) existing.quantity += quantity;
  else cart.push({ productId, quantity });
  saveGuestCart(cart);
};

export const removeFromGuestCart = (productId) =>
  saveGuestCart(getGuestCart().filter((i) => i.productId !== productId));

export const updateGuestCartQuantity = (productId, quantity) =>
  saveGuestCart(
    getGuestCart().map((i) =>
      i.productId === productId ? { ...i, quantity } : i
    )
  );

export const clearGuestCart = () => localStorage.removeItem("guestCart");
```

---

## 2. Routing Logic — Guest vs Logged-in

In the existing `/checkout` page, add this branch at the top:

```
User visits /checkout
  ├── isLoggedIn = true  →  existing authenticated Stripe/PayPal flow (no changes)
  └── isLoggedIn = false →  render <GuestCheckoutForm /> (new, built below)
                             + show a "Login or Create Account" link as an alternative
```

---

## 3. Load Checkout Options on Mount

Call once when `GuestCheckoutForm` mounts to populate the shipping method dropdown.

**Request**
```
GET https://alpa-be.onrender.com/api/cart/checkout-options
```

**Response**
```json
{
  "success": true,
  "shippingMethods": [
    { "id": "...", "name": "Standard", "cost": "9.99", "estimatedDays": 5 },
    { "id": "...", "name": "Express",  "cost": "19.99", "estimatedDays": 2 }
  ],
  "gstOptions": [
    { "id": "...", "percentage": "10.00", "isDefault": true }
  ]
}
```

Pre-select the first shipping method and the `isDefault: true` GST option. Store both IDs in state.

---

## 4. Live Order Total Preview

Call whenever cart items, selected shipping method, or coupon changes.

**Request**
```
POST https://alpa-be.onrender.com/api/cart/calculate-guest
Content-Type: application/json

{
  "items": [ { "productId": "...", "quantity": 2 } ],
  "shippingMethodId": "<selected id>",
  "gstId": "<default id>"
}
```

**Response**
```json
{
  "success": true,
  "subtotal": "110.00",
  "subtotalExGST": "100.00",
  "shippingCost": "10.00",
  "gstPercentage": "10.00",
  "gstAmount": "10.00",
  "grandTotal": "120.00",
  "gstInclusive": true
}
```

Display in a live order summary panel beside the form. Update on every relevant state change.

---

## 5. Coupon Validation

Add an optional coupon field with an **Apply** button.

**Request**
```
POST https://alpa-be.onrender.com/api/coupons/validate
Content-Type: application/json

{ "code": "SAVE10", "cartTotal": 120.00 }
```

**Success:** `{ "success": true, "discount": 12.00, "discountType": "percentage", "discountValue": 10 }`  
**Failure:** `{ "success": false, "message": "Coupon has expired" }`

On success, show the discount line in the order summary (`-$12.00`) and store the `code` string in state. The server re-validates independently at payment time.

---

## 6. Guest Checkout Form — Required Fields

| Field Label | State Key | Sent As |
|-------------|-----------|---------|
| Full Name | `customerName` | `customerName` |
| Email Address | `customerEmail` | `customerEmail` |
| Phone Number | `customerPhone` | `customerPhone` |
| Address Line | `addressLine` | `shippingAddress.addressLine` |
| City | `city` | `city` + `shippingAddress.city` |
| State | `state` | `state` + `shippingAddress.state` |
| Postcode | `zipCode` | `zipCode` + `shippingAddress.zipCode` |
| Country | `country` | `country` + `shippingAddress.country` |
| Shipping Method | `shippingMethodId` | `shippingMethodId` |
| Coupon Code | `couponCode` | `couponCode` *(omit key if empty)* |

> Country defaults to `"Australia"`. No payment method selector — payment is always Stripe for guests.

---

## 7. Stripe Guest Checkout — 3-Step Flow

### Step A — Create PaymentIntent

Validate the form locally first (all required fields filled, valid email format). Then on **"Continue to Payment"** click:

**Request**
```
POST https://alpa-be.onrender.com/api/payments/guest/create-intent
Content-Type: application/json

{
  "items": [ { "productId": "...", "quantity": 2 } ],
  "customerName": "Jane Doe",
  "customerEmail": "jane@example.com",
  "customerPhone": "0400000000",
  "shippingAddress": {
    "addressLine": "123 Main St",
    "city": "Sydney",
    "state": "NSW",
    "country": "Australia",
    "zipCode": "2000"
  },
  "shippingMethodId": "...",
  "gstId": "...",
  "country": "Australia",
  "city": "Sydney",
  "state": "NSW",
  "zipCode": "2000",
  "mobileNumber": "0400000000",
  "couponCode": "SAVE10"
}
```

**Response**
```json
{
  "success": true,
  "clientSecret": "pi_xxx_secret_xxx",
  "paymentIntentId": "pi_xxx",
  "orderId": "cuid...",
  "amount": 10800,
  "displayAmount": 108.00,
  "currency": "aud",
  "orderSummary": {
    "subtotal": "110.00",
    "subtotalExGST": "100.00",
    "shippingCost": "10.00",
    "gstPercentage": "10.00",
    "gstAmount": "10.00",
    "originalTotal": "120.00",
    "couponCode": "SAVE10",
    "discountAmount": "12.00",
    "grandTotal": "108.00"
  }
}
```

Store `clientSecret`, `paymentIntentId`, `orderId`, and `orderSummary` in component state. Show `orderSummary.grandTotal` as the final confirmed amount before card entry.

---

### Step B — Mount Stripe Elements

```js
const stripe = Stripe("YOUR_STRIPE_PUBLISHABLE_KEY");
const elements = stripe.elements({ clientSecret }); // clientSecret from Step A

const paymentElement = elements.create("payment");
paymentElement.mount("#payment-element"); // your card container div
```

Show a **"Pay $108.00"** button using `displayAmount` from Step A. Disable it until the Stripe Element reports it is `complete`.

---

### Step C — Confirm Payment

On "Pay" button click:

```js
const { error } = await stripe.confirmPayment({
  elements,
  confirmParams: {
    return_url: "https://yoursite.com/guest/order-success"
  },
  redirect: "if_required" // suppresses redirect for standard card payments
});

if (error) {
  // Show error.message beneath the card input
  // Re-enable the Pay button
  return;
}

// Stripe succeeded — confirm with backend:
const res = await fetch("https://alpa-be.onrender.com/api/payments/guest/confirm", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ paymentIntentId, customerEmail })
});
const data = await res.json();

if (data.success) {
  clearGuestCart();
  sessionStorage.setItem("guestOrderId", data.orderId);
  sessionStorage.setItem("guestOrderEmail", customerEmail);
  router.push("/guest/order-success");
}
```

**Backend confirm response**
```json
{
  "success": true,
  "orderId": "cuid...",
  "status": "CONFIRMED",
  "paymentStatus": "PAID"
}
```

---

## 8. 3D Secure / Redirect Fallback

For 3DS cards Stripe may redirect to `return_url` with `?payment_intent=pi_xxx` appended. On that landing page:

1. Read `payment_intent` from the URL query string
2. Retrieve `orderId` and `customerEmail` from `sessionStorage`
3. Poll for status:

```
GET https://alpa-be.onrender.com/api/payments/guest/status?orderId=cuid...&customerEmail=jane%40example.com
```

```json
{
  "success": true,
  "order": { "status": "CONFIRMED", "paymentStatus": "PAID", "totalAmount": "108.00" }
}
```

| `paymentStatus` | Action |
|-----------------|--------|
| `PAID` | Go to success page |
| `FAILED` | Show error, offer retry |
| `PENDING` | Poll again after 2 seconds (max 5 attempts) |

---

## 9. Order Success Page (`/guest/order-success`)

Read from `sessionStorage`:

```js
const orderId = sessionStorage.getItem("guestOrderId");
const email   = sessionStorage.getItem("guestOrderEmail");
```

Display:
- "Order Confirmed!" heading
- Order ID with copy-to-clipboard button
- `"A confirmation email has been sent to {email}"`
- Total paid
- **Track Your Order** button → `/guest/track-order` (pre-filled with orderId + email)
- **Continue Shopping** link

---

## 10. Track Order Page (`/guest/track-order`)

Two text inputs — **Order ID** and **Email Address** — with a **Track** button. Pre-fill from `sessionStorage` if available.

**Request**
```
GET https://alpa-be.onrender.com/api/orders/guest/track?orderId=cuid...&customerEmail=jane%40example.com
```

**Response**
```json
{
  "success": true,
  "order": {
    "id": "cuid...",
    "status": "CONFIRMED",
    "totalAmount": "108.00",
    "customerName": "Jane Doe",
    "shippingAddressLine": "123 Main St",
    "shippingCity": "Sydney",
    "shippingState": "NSW",
    "shippingCountry": "Australia",
    "shippingZipCode": "2000",
    "trackingNumber": null,
    "estimatedDelivery": null,
    "items": [
      {
        "quantity": 2,
        "price": "55.00",
        "product": { "title": "...", "images": ["..."] }
      }
    ],
    "createdAt": "2026-02-27T..."
  }
}
```

Display order status as a visual step indicator:
```
[●] CONFIRMED  →  [ ] PROCESSING  →  [ ] SHIPPED  →  [ ] DELIVERED
```

Show the **Download Invoice** button only when `status === "DELIVERED"`.

---

## 11. Download Invoice (DELIVERED orders only)

```js
const url =
  `https://alpa-be.onrender.com/api/orders/guest/invoice` +
  `?orderId=${orderId}&customerEmail=${encodeURIComponent(email)}`;

const res = await fetch(url);

if (!res.ok) {
  const err = await res.json();
  showToast(err.message); // "Invoice only available after DELIVERED status"
  return;
}

const blob = await res.blob();
const link = document.createElement("a");
link.href = URL.createObjectURL(blob);
link.download = `invoice-${orderId}.pdf`;
link.click();
URL.revokeObjectURL(link.href);
```

---

## 12. Cart Sync on Login / Signup

Whenever a guest logs in or creates an account **while having items in localStorage**, merge their cart immediately after receiving the JWT:

**Request**
```
POST https://alpa-be.onrender.com/api/cart/sync
Authorization: Bearer <jwt token>
Content-Type: application/json

{
  "items": [ { "productId": "...", "quantity": 2 } ]
}
```

Then call `clearGuestCart()`.

---

## 13. Error Handling Reference

Every failed API response returns:
```json
{ "success": false, "message": "Human-readable description" }
```

Always surface `message` directly — as a toast or inline field error.

| Step | Error Message | Correct UI Response |
|------|--------------|---------------------|
| Step A | `"Insufficient stock for product: X"` | Highlight item in cart, disable checkout |
| Step A | `"Coupon has expired"` | Clear coupon field, recalculate total |
| Step A | `"Minimum cart value of $50.00 required"` | Show below coupon field |
| Step A | `"Invalid email address"` | Inline error on email input |
| Step A | `"shippingAddress and shippingMethodId are required"` | Scroll to + highlight empty fields |
| Step C | Stripe `error.message` | Show under card element, re-enable Pay button |
| Step C | `"Guest order not found for this payment"` | Show generic retry message |
| Track page | `"Order not found"` / `"Email does not match order"` | Inline error under form |
| Invoice | `"Invoice can only be downloaded when order status is DELIVERED"` | Keep button hidden until DELIVERED |

---

## 14. Complete API Reference

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| `GET` | `/api/cart/checkout-options` | None | Shipping methods + GST rates |
| `POST` | `/api/cart/calculate-guest` | None | Live order total preview |
| `POST` | `/api/coupons/validate` | None | Validate + preview coupon discount |
| `POST` | `/api/payments/guest/create-intent` | None | Create Stripe PaymentIntent + pending order |
| `POST` | `/api/payments/guest/confirm` | None | Finalise order after Stripe payment succeeds |
| `GET` | `/api/payments/guest/status` | None | Poll order + payment status (3DS redirect fallback) |
| `GET` | `/api/orders/guest/track` | None | Track order by ID + email |
| `GET` | `/api/orders/guest/invoice` | None | Download PDF invoice (DELIVERED only) |
| `POST` | `/api/cart/sync` | Bearer token | Merge guest cart into user account on login |
