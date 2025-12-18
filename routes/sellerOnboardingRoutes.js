const express = require("express");
const router = express.Router();
const sellerController = require("../controllers/sellerOnboarding");
const upload = require("../middlewares/upload");
const { authenticateSeller, isAdmin } = require("../middlewares/authMiddleware");

// ==================== PUBLIC ROUTES (No Auth Required) ====================

// Step 1: Initial Application
router.post("/apply", sellerController.applyAsSeller);

// Step 2: Verify OTP & Set Password
router.post("/verify-otp", sellerController.verifyOTP);

// Resend OTP
router.post("/resend-otp", sellerController.resendOTP);

// Seller Login (with email + password)
router.post("/login", sellerController.sellerLogin);

// ==================== SELLER ROUTES (Auth Required) ====================

// Step 3: Business Details & ABN
router.post("/business-details", authenticateSeller, sellerController.submitBusinessDetails);
router.post("/validate-abn", authenticateSeller, sellerController.validateABN);

// Step 4: Cultural Identity
router.post("/cultural-info", authenticateSeller, sellerController.submitCulturalInfo);

// Step 5: Store Profile with Logo Upload
router.post(
  "/store-profile", 
  authenticateSeller, 
  upload.single("logo"), 
  sellerController.submitStoreProfile
);

// Step 6: KYC Documents Upload
router.post(
  "/kyc-upload", 
  authenticateSeller, 
  upload.single("idDocument"), 
  sellerController.uploadKYC
);

// Step 7: Bank Details (Optional - can be added later)
router.post("/bank-details", authenticateSeller, sellerController.submitBankDetails);

// Submit Application for Review
router.post("/submit-for-review", authenticateSeller, sellerController.submitForReview);

// Get Seller Profile
router.get("/profile", authenticateSeller, sellerController.getProfile);

// Update Seller Profile
router.put("/profile", authenticateSeller, sellerController.updateProfile);

// Get Go-Live Status
router.get("/go-live-status", authenticateSeller, sellerController.getGoLiveStatus);

// Update product count (internal - called from product controller)
router.post("/update-product-count/:id", sellerController.updateProductCount);

module.exports = router;
