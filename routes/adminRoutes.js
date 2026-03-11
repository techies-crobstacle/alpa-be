const { isAdmin } = require("../middlewares/authMiddleware");
const authMiddleware = require("../middlewares/auth");
const checkRole = require("../middlewares/checkRole");
const adminController = require("../controllers/admin");
const productController = require("../controllers/product");
const feedbackController = require("../controllers/feedback");
const commissionController = require("../controllers/commission");

async function adminRoutes(fastify, options) {
  // Apply admin middleware to all routes
  const adminAuth = isAdmin;

  // ---------------- USER MANAGEMENT ----------------
  fastify.get("/users", { preHandler: adminAuth }, adminController.getAllUsers);

  // ---------------- SELLER MANAGEMENT ----------------

  // Get all sellers (with optional status filter)
  fastify.get("/sellers", { preHandler: adminAuth }, adminController.getAllSellers);

  // Get pending sellers for review
  fastify.get("/sellers/pending", { preHandler: adminAuth }, adminController.getPendingSellers);

  // Get seller details by ID
  fastify.get("/sellers/:id", { preHandler: adminAuth }, adminController.getSellerDetails);

  // Get seller's products
  fastify.get("/sellers/:sellerId/products", { preHandler: adminAuth }, adminController.getProductsBySeller);

  // Get all orders (admin only) - NEW
  fastify.get("/orders", { preHandler: adminAuth }, adminController.getAllOrders);

  // Get all orders by seller ID (admin only)
  fastify.get("/orders/by-seller/:sellerId", { preHandler: adminAuth }, adminController.getOrdersBySellerId);

  // Seller approval actions
  fastify.post("/sellers/approve/:id", { preHandler: adminAuth }, adminController.approveSeller);
  fastify.post("/sellers/reject/:id", { preHandler: adminAuth }, adminController.rejectSeller);
  fastify.put("/sellers/suspend/:sellerId", { preHandler: adminAuth }, adminController.suspendSeller);

  // Update seller notes
  fastify.put("/sellers/notes/:id", { preHandler: adminAuth }, adminController.updateSellerNotes);

  // Activate seller (Go Live - SOW Requirement)
  fastify.post("/sellers/activate/:id", { preHandler: adminAuth }, adminController.activateSeller);

  // ---------------- CATEGORY MANAGEMENT ----------------
  // Get all categories with product counts (Admin & Seller)
  fastify.get("/categories", { 
    preHandler: [authMiddleware, checkRole(['ADMIN', 'SELLER'])]
  }, adminController.getAllCategories);

  // ---------------- PRODUCT APPROVAL MANAGEMENT ----------------
  // Get ALL products with status filter: ?status=pending|approved|rejected|inactive|all
  // Optional filters: &sellerId=xxx  &page=1 &limit=20
  fastify.get("/products", { preHandler: adminAuth }, adminController.getAllAdminProducts);

  // Get all pending products for approval
  fastify.get("/products/pending", { preHandler: adminAuth }, adminController.getPendingProducts);
  
  // Approve a product
  fastify.post("/products/approve/:productId", { preHandler: adminAuth }, adminController.approveProduct);
  
  // Reject a product (supports both DELETE and POST for body parsing reliability)
  fastify.post("/products/reject/:productId", { preHandler: adminAuth }, adminController.rejectProduct);
  fastify.delete("/products/reject/:productId", { preHandler: adminAuth }, adminController.rejectProduct);
  
  // Bulk approve products
  fastify.post("/products/approve-bulk", { preHandler: adminAuth }, adminController.bulkApproveProducts);

  // Activate / Deactivate a product
  fastify.put("/products/activate/:productId", { preHandler: adminAuth }, adminController.activateProduct);
  fastify.put("/products/deactivate/:productId", { preHandler: adminAuth }, adminController.deactivateProduct);

  // ── Recycle Bin (admin) ────────────────────────────────────────────────────
  // DELETE /admin/products/:productId               — soft delete (move to Recycle Bin)
  fastify.delete("/products/:productId", { preHandler: adminAuth }, productController.deleteProduct);
  // GET  /admin/products/recycle-bin?sellerId=xxx   — all deleted products
  fastify.get("/products/recycle-bin", { preHandler: adminAuth }, adminController.getAdminRecycleBin);
  // POST /admin/products/:productId/restore         — restore to INACTIVE
  fastify.post("/products/:productId/restore", { preHandler: adminAuth }, productController.restoreProduct);
  // DELETE /admin/products/:productId/permanent     — hard delete from recycle bin
  fastify.delete("/products/:productId/permanent", { preHandler: adminAuth }, adminController.permanentlyDeleteProduct);

  // Scan & deactivate all low-stock active products and notify sellers
  fastify.post("/products/scan-low-stock", { preHandler: adminAuth }, adminController.scanLowStockProducts);

  // Backfill order notifications for all existing orders that have no notification record
  fastify.post("/orders/backfill-notifications", { preHandler: adminAuth }, adminController.backfillOrderNotifications);

  // ---------------- COUPON MANAGEMENT ----------------
  // Public: active coupons visible to all users (no auth required)
  fastify.get("/coupons/active", adminController.getActiveCoupons);

  // Admin only: full coupon list + management
  fastify.get("/coupons",                                    adminController.getAllCoupons);
  fastify.post("/coupons",            { preHandler: adminAuth }, adminController.createCoupon);
  fastify.put("/coupons/:id",         { preHandler: adminAuth }, adminController.updateCoupon);

  // Recycle bin: soft-delete, restore, hard-delete
  fastify.delete("/coupons/:id",           { preHandler: adminAuth }, adminController.softDeleteCoupon);
  fastify.patch("/coupons/:id/restore",    { preHandler: adminAuth }, adminController.restoreCoupon);
  fastify.delete("/coupons/:id/permanent", { preHandler: adminAuth }, adminController.hardDeleteCoupon);
  // ---------------- SALES ANALYTICS & EXPORT ----------------
  
  fastify.get("/sales/analytics", { preHandler: adminAuth }, adminController.getSalesAnalytics);
  fastify.get("/sales/export", { preHandler: adminAuth }, adminController.exportSalesCSV);

  // ---------------- REVENUE & ORDERS CHART ----------------
  // GET /admin/analytics/revenue-chart?period=7D|30D|1Y
  fastify.get("/analytics/revenue-chart", { preHandler: adminAuth }, adminController.getRevenueOrdersChart);

  // ---------------- COMMISSION MANAGEMENT ----------------
  fastify.get("/commissions",                         { preHandler: adminAuth }, commissionController.getAllCommissions);
  fastify.get("/commissions/:id",                     { preHandler: adminAuth }, commissionController.getCommissionById);
  fastify.post("/commissions",                        { preHandler: adminAuth }, commissionController.createCommission);
  fastify.put("/commissions/:id",                     { preHandler: adminAuth }, commissionController.updateCommission);
  fastify.put("/commissions/:id/set-default",         { preHandler: adminAuth }, commissionController.setDefaultCommission);
  fastify.delete("/commissions/:id",                  { preHandler: adminAuth }, commissionController.deleteCommission);
  // Assign a specific commission to a specific seller
  fastify.put("/sellers/:sellerId/commission",        { preHandler: adminAuth }, commissionController.assignCommissionToSeller);

  // Commission Earned (recorded per order)
  fastify.get("/commissions/earned",                          { preHandler: adminAuth }, commissionController.getAllCommissionEarned);
  fastify.get("/commissions/earned/summary",                  { preHandler: adminAuth }, commissionController.getCommissionEarnedSummary);
  fastify.get("/commissions/earned/order/:orderId",           { preHandler: adminAuth }, commissionController.getCommissionEarnedByOrder);
  fastify.put("/commissions/earned/:id/status",               { preHandler: adminAuth }, commissionController.updateCommissionEarnedStatus);

  // Payout Requests (Admin)
  fastify.get("/commissions/payout-requests",                 { preHandler: adminAuth }, commissionController.getAllPayoutRequests);
  fastify.put("/commissions/payout-requests/:id/status",      { preHandler: adminAuth }, commissionController.updatePayoutRequestStatus);

  // ---------------- SITE FEEDBACK ----------------
  fastify.get("/feedback", { preHandler: adminAuth }, feedbackController.getAllFeedback);
  fastify.delete("/feedback/:id", { preHandler: adminAuth }, feedbackController.deleteFeedback);

  // ---------------- BANK CHANGE REQUESTS ----------------
  fastify.get("/bank-change-requests", { preHandler: adminAuth }, adminController.getBankChangeRequests);
  fastify.get("/bank-change-requests/:id", { preHandler: adminAuth }, adminController.getBankChangeRequest);
  fastify.post("/bank-change-requests/:id/approve", { preHandler: adminAuth }, adminController.approveBankChangeRequest);
  fastify.post("/bank-change-requests/:id/reject", { preHandler: adminAuth }, adminController.rejectBankChangeRequest);

  // ---------------- AUDIT LOGS (immutable, read-only) ----------------
  // GET /admin/audit-logs?entityType=PRODUCT&action=PRODUCT_APPROVED&from=2026-01-01&page=1&limit=50
  fastify.get("/audit-logs", { preHandler: adminAuth }, adminController.getAuditLogs);
  // GET /admin/audit-logs/products/:productId  — full history for one product
  // Accessible by ADMIN (any product) or SELLER (own products only)
  const { authenticateUser } = require("../middlewares/authMiddleware");
  fastify.get("/audit-logs/products/:productId", { preHandler: authenticateUser }, adminController.getProductAuditHistory);
} 

module.exports = adminRoutes;


