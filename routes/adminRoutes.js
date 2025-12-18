const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const checkRole = require("../middlewares/checkRole");
const adminController = require("../controllers/admin");

// Apply admin middleware to all routes
const adminAuth = [auth, checkRole("admin")];

// ---------------- USER MANAGEMENT ----------------
router.get("/users", adminAuth, adminController.getAllUsers);

// ---------------- SELLER MANAGEMENT ----------------

// Get all sellers (with optional status filter)
router.get("/sellers", adminAuth, adminController.getAllSellers);

// Get pending sellers for review
router.get("/sellers/pending", adminAuth, adminController.getPendingSellers);

// Get seller details by ID
router.get("/sellers/:id", adminAuth, adminController.getSellerDetails);

// Get seller's products
router.get("/sellers/:sellerId/products", adminAuth, adminController.getProductsBySeller);

// Seller approval actions
router.post("/sellers/approve/:id", adminAuth, adminController.approveSeller);
router.post("/sellers/reject/:id", adminAuth, adminController.rejectSeller);
router.put("/sellers/suspend/:sellerId", adminAuth, adminController.suspendSeller);

// Update seller notes
router.put("/sellers/notes/:id", adminAuth, adminController.updateSellerNotes);

// Cultural approval (SOW Requirement)
router.post("/sellers/cultural-approval/:id", adminAuth, adminController.culturalApproval);

// Activate seller (Go Live - SOW Requirement)
router.post("/sellers/activate/:id", adminAuth, adminController.activateSeller);

module.exports = router;
