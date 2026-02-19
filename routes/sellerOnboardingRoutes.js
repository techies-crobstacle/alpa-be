const sellerController = require("../controllers/sellerOnboarding");
const { handleSellerDocsUpload } = require("../middlewares/upload");
const { authenticateSeller, isAdmin } = require("../middlewares/authMiddleware");

async function sellerOnboardingRoutes(fastify, options) {
  // ==================== PUBLIC ROUTES (No Auth Required) ====================

  // Step 1: Initial Application
  fastify.post("/apply", sellerController.applyAsSeller);

  // Step 2: Verify OTP & Set Password
  fastify.post("/verify-otp", sellerController.verifyOTP);

  // Resend OTP
  fastify.post("/resend-otp", sellerController.resendOTP);

  // Seller Login (with email + password)
  fastify.post("/login", sellerController.sellerLogin);

  // Resume Onboarding - Check where user left off
  fastify.post("/resume", sellerController.resumeOnboarding);

  // Forgot Password
  fastify.post("/forgot-password", sellerController.forgotPassword);

  // Reset Password
  fastify.post("/reset-password", sellerController.resetPassword);

  // ==================== SELLER ROUTES (Auth Required) ====================

  // Step 3: Business Details & ABN
  fastify.post("/business-details", { preHandler: authenticateSeller }, sellerController.submitBusinessDetails);
  fastify.post("/validate-abn", { preHandler: authenticateSeller }, sellerController.validateABN);
  fastify.get("/validate-abn", { preHandler: authenticateSeller }, sellerController.validateABNGet);

  // Step 4: Cultural Identity
  fastify.post("/cultural-info", { preHandler: authenticateSeller }, sellerController.submitCulturalInfo);

  // Step 5: Store Profile with Logo Upload
  fastify.post("/store-profile", { preHandler: [authenticateSeller, handleSellerDocsUpload] }, sellerController.submitStoreProfile);

  // Step 6: KYC Documents Upload
  fastify.post("/kyc-upload", { preHandler: [authenticateSeller, handleSellerDocsUpload] }, sellerController.uploadKYC);

  // Step 7: Bank Details (Optional - can be added later)
  fastify.post("/bank-details", { preHandler: authenticateSeller }, sellerController.submitBankDetails);

  // Submit Application for Review
  fastify.post("/submit-for-review", { preHandler: authenticateSeller }, sellerController.submitForReview);

  // Get Seller Profile
  fastify.get("/profile", { preHandler: authenticateSeller }, sellerController.getProfile);

  // Get Onboarding Status
  fastify.get("/onboarding-status", { preHandler: authenticateSeller }, sellerController.getOnboardingStatus);

  // Update Seller Profile
  fastify.put("/profile", { preHandler: authenticateSeller }, sellerController.updateProfile);

  // Get Go-Live Status
  fastify.get("/go-live-status", { preHandler: authenticateSeller }, sellerController.getGoLiveStatus);

  // Update product count (internal - called from product controller)
  fastify.post("/update-product-count/:id", sellerController.updateProductCount);
}

module.exports = sellerOnboardingRoutes;


