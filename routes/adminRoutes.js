const { isAdmin } = require("../middlewares/authMiddleware");
const authMiddleware = require("../middlewares/auth");
const checkRole = require("../middlewares/checkRole");
const adminController = require("../controllers/admin");

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

  // Get all orders by seller ID (admin only)
  fastify.get("/orders/by-seller/:sellerId", { preHandler: adminAuth }, adminController.getOrdersBySellerId);

  // Seller approval actions
  fastify.post("/sellers/approve/:id", { preHandler: adminAuth }, adminController.approveSeller);
  fastify.post("/sellers/reject/:id", { preHandler: adminAuth }, adminController.rejectSeller);
  fastify.put("/sellers/suspend/:sellerId", { preHandler: adminAuth }, adminController.suspendSeller);

  // Update seller notes
  fastify.put("/sellers/notes/:id", { preHandler: adminAuth }, adminController.updateSellerNotes);

  // Cultural approval (SOW Requirement)
  fastify.post("/sellers/cultural-approval/:id", { preHandler: adminAuth }, adminController.culturalApproval);

  // Activate seller (Go Live - SOW Requirement)
  fastify.post("/sellers/activate/:id", { preHandler: adminAuth }, adminController.activateSeller);

  // ---------------- CATEGORY MANAGEMENT ----------------
  // Get all categories with product counts (Admin & Seller)
  fastify.get("/categories", { 
    preHandler: [authMiddleware, checkRole(['ADMIN', 'SELLER'])]
  }, adminController.getAllCategories);

  // ---------------- COUPON MANAGEMENT ----------------
  // Admin coupon management
  fastify.post("/coupons", { preHandler: adminAuth }, adminController.createCoupon);
  
  // Get coupons - accessible to all authenticated users (customers, sellers, admin)
  fastify.get("/coupons", { 
    preHandler: [authMiddleware, checkRole(['CUSTOMER', 'SELLER', 'ADMIN'])]
  }, adminController.getAllCoupons);
  
  fastify.put("/coupons/:id", { preHandler: adminAuth }, adminController.updateCoupon);
  fastify.delete("/coupons/:id", { preHandler: adminAuth }, adminController.deleteCoupon);
  // ---------------- SALES ANALYTICS & EXPORT ----------------
  
  fastify.get("/sales/analytics", { preHandler: adminAuth }, adminController.getSalesAnalytics);
  fastify.get("/sales/export", { preHandler: adminAuth }, adminController.exportSalesCSV);
} 

module.exports = adminRoutes;


