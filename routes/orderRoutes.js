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

async function orderRoutes(fastify, options) {
  // ---------------- USER ORDER ROUTES ----------------

  // Place a new order
  fastify.post("/create", { preHandler: authenticateUser }, orderController.createOrder);

  // Get logged-in user's orders
  fastify.get("/my-orders", { preHandler: authenticateUser }, orderController.getMyOrders);

  // Cancel order
  fastify.put("/cancel/:id", { preHandler: authenticateUser }, orderController.cancelOrder);

  // Reorder - Add all items from previous order to cart
  fastify.post("/reorder/:id", { preHandler: authenticateUser }, orderController.reorder);

  // Download invoice PDF (accessible by customer, seller for their orders, admin for all)
  fastify.get("/invoice/:orderId", { preHandler: [authenticateUser, checkRole(['USER', 'SELLER', 'ADMIN'])] }, orderController.downloadInvoice);

  // ----------- GUEST CHECKOUT ROUTES (No authentication) -----------

  // Create guest order (no authentication required)
  fastify.post("/guest/checkout", orderController.createGuestOrder);

  // Track guest order by Order ID and Email (no authentication required)
  fastify.get("/guest/track", orderController.trackGuestOrder);

  // Download guest invoice PDF (no authentication required)
  fastify.get("/guest/invoice", orderController.downloadGuestInvoice);
}

module.exports = orderRoutes;

