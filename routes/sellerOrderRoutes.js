const sellerOrderController = require("../controllers/sellerOrders");
const { authenticateSeller, authenticateUser } = require("../middlewares/authMiddleware");
const checkRole = require("../middlewares/checkRole");

async function sellerOrderRoutes(fastify, options) {
  // ---------------- SELLER ORDER ROUTES ----------------

  // Get all orders received by seller
  fastify.get("/", { preHandler: authenticateSeller }, sellerOrderController.getSellerOrders);

  // Update order status (Packed, Shipped, Delivered etc.) - Seller and Admin access
  fastify.put("/update-status/:orderId", { preHandler: [authenticateUser, checkRole(['SELLER', 'ADMIN'])] }, sellerOrderController.updateOrderStatus);

  // Update tracking number & estimated delivery - Seller and Admin access
  fastify.put("/tracking/:orderId", { preHandler: [authenticateUser, checkRole(['SELLER', 'ADMIN'])] }, sellerOrderController.updateTrackingInfo);

  // Seller Stock bulk update
  fastify.put("/products/bulk-stock", { preHandler: authenticateSeller }, sellerOrderController.bulkUpdateStock);

  // Export sales report (CSV)
  fastify.get("/export-sales", { preHandler: authenticateSeller }, sellerOrderController.exportSalesReport);

  // Get sales analytics
  fastify.get("/analytics", { preHandler: authenticateSeller }, sellerOrderController.getSalesAnalytics);
}

module.exports = sellerOrderRoutes;


