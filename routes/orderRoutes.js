// const express = require("express");
// const router = express.Router();
// const orderController = require("../controllers/orders");
// const auth = require("../middlewares/auth");
// const roleMiddleware = require("../middlewares/checkRole");

// // ---------------- USER ROUTES ----------------

// // Place a new order
// router.post("/create", auth, roleMiddleware("user"), orderController.createOrder);

// // Get logged-in user's orders
// router.get("/my-orders", auth, roleMiddleware("user"), orderController.getMyOrders);

// // Cancel order
// router.put("/cancel/:id", auth, roleMiddleware("user"), orderController.cancelOrder);

// // ---------------- SELLER ROUTES ----------------

// // Get all orders received by seller
// router.get("/seller/orders", auth, roleMiddleware("seller"), orderController.getSellerOrders);

// // Update order status (Packed, Shipped, Delivered etc.)
// router.put("/seller/update-status/:orderId", auth, roleMiddleware("seller"), orderController.updateOrderStatus);

// // Update tracking number & estimated delivery
// router.put("/seller/tracking/:orderId", auth, roleMiddleware("seller"), orderController.updateTrackingInfo);



const orderController = require("../controllers/orders");
const { authenticateUser } = require("../middlewares/authMiddleware");
const checkRole = require("../middlewares/checkRole");
const guestRefundRateLimit = require("../middlewares/guestRefundRateLimit");

async function orderRoutes(fastify, options) {
  // ---------------- USER ORDER ROUTES ----------------

  // Place a new order
  fastify.post("/create", { preHandler: authenticateUser }, orderController.createOrder);

  // Get logged-in user's orders
  fastify.get("/my-orders", { preHandler: authenticateUser }, orderController.getMyOrders);

  // Cancel order
  fastify.put("/cancel/:id", { preHandler: authenticateUser }, orderController.cancelOrder);

  // Request refund / partial refund (customer)
  fastify.post("/refund-request/:id", { preHandler: authenticateUser }, orderController.requestRefund);

  // Track all refund / partial refund requests for logged-in customer
  fastify.get("/refund-requests", { preHandler: authenticateUser }, orderController.getMyRefundRequests);

  // Track single refund request by request ID
  fastify.get("/refund-requests/:requestId", { preHandler: authenticateUser }, orderController.getRefundRequestById);

  // Reorder - Add all items from previous order to cart
  fastify.post("/reorder/:id", { preHandler: authenticateUser }, orderController.reorder);

  // Download invoice via signed token (public — used in email "Download Invoice" button)
  // MUST be registered before /invoice/:orderId to avoid "download" being matched as orderId
  fastify.get("/invoice/download/:token", orderController.downloadInvoiceByToken);

  // Download invoice PDF (accessible by customer, seller for their orders, admin for all)
  fastify.get("/invoice/:orderId", { preHandler: [authenticateUser, checkRole(['CUSTOMER', 'USER', 'SELLER', 'ADMIN'])] }, orderController.downloadInvoice);

  // ----------- GUEST CHECKOUT ROUTES (No authentication) -----------
  // Note: Guest checkout is Stripe-only. There is no COD option.

  // Track guest order by Order ID and Email (no authentication required)
  fastify.get("/guest/track", orderController.trackGuestOrder);

  // Download guest invoice PDF (no authentication required)
  fastify.get("/guest/invoice", orderController.downloadGuestInvoice);

  // Guest refund request create (no authentication; verified by orderId + customerEmail)
  fastify.post("/guest/refund-request", { preHandler: guestRefundRateLimit }, orderController.requestGuestRefund);

  // Guest refund request list tracking (no authentication; verified by orderId + customerEmail)
  fastify.get("/guest/refund-requests", { preHandler: guestRefundRateLimit }, orderController.getGuestRefundRequests);

  // Guest single refund request tracking (no authentication; verified by orderId + customerEmail)
  fastify.get("/guest/refund-requests/:requestId", { preHandler: guestRefundRateLimit }, orderController.getGuestRefundRequestById);
}

module.exports = orderRoutes;

