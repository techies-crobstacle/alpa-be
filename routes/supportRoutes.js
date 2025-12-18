const express = require("express");
const router = express.Router();
const supportController = require("../controllers/support");
const { authenticateUser } = require("../middlewares/authMiddleware");

// ---------------- SUPPORT ROUTES ----------------

// Submit contact form (Public - no auth required)
router.post("/contact", supportController.submitContactForm);

// Get return policy (Public - no auth required)
router.get("/return-policy", supportController.getReturnPolicy);

// Get my support tickets (Authenticated users only)
router.get("/my-tickets", authenticateUser, supportController.getMyTickets);

module.exports = router;
