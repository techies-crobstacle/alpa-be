const express = require("express");
const router = express.Router();
const sellerOrderController = require("../controllers/sellerOrders");
const { authenticateSeller } = require("../middlewares/authMiddleware");

// ---------------- SELLER ORDER ROUTES ----------------

// Get all orders received by seller
router.get("/", authenticateSeller, sellerOrderController.getSellerOrders);

// Update order status (Packed, Shipped, Delivered etc.)
router.put("/update-status/:orderId", authenticateSeller, sellerOrderController.updateOrderStatus);

// Update tracking number & estimated delivery
router.put("/tracking/:orderId", authenticateSeller, sellerOrderController.updateTrackingInfo);

// Seller Stock bulk update
router.put("/products/bulk-stock", authenticateSeller, sellerOrderController.bulkUpdateStock);


// Export sales report (CSV)
router.get("/export-sales", authenticateSeller, sellerOrderController.exportSalesReport);

// Get sales analytics
router.get("/analytics", authenticateSeller, sellerOrderController.getSalesAnalytics);


module.exports = router;
