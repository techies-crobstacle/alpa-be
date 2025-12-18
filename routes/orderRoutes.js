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



// // Seller Stock 
// router.put("/products/bulk-stock", auth, roleMiddleware("seller"), orderController.bulkUpdateStock);


// module.exports = router;

const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orders");
const auth = require("../middlewares/auth");
const roleMiddleware = require("../middlewares/checkRole");

// ---------------- USER ORDER ROUTES ----------------

// Place a new order
router.post("/create", auth, roleMiddleware("user"), orderController.createOrder);

// Get logged-in user's orders
router.get("/my-orders", auth, roleMiddleware("user"), orderController.getMyOrders);

// Cancel order
router.put("/cancel/:id", auth, roleMiddleware("user"), orderController.cancelOrder);

module.exports = router;