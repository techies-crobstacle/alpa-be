const auth = require("../middlewares/auth");
const checkRole = require("../middlewares/checkRole");
const adminController = require("../controllers/admin");

async function adminRoutes(fastify, options) {
  // Apply admin middleware to all routes
  const adminAuth = [auth, checkRole("admin")];

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
}

module.exports = adminRoutes;
