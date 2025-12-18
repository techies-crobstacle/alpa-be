const { admin, db, storage } = require("../config/firebase");
const { generateOTP, sendOTPEmail } = require("../utils/emailService");
const { validateABNWithVigil, verifyIdentityDocument } = require("../utils/vigilAPI");
const { checkEmailExists } = require("../utils/emailValidation");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

// Helper function to generate seller JWT token
const generateSellerToken = (sellerId) => {
  return jwt.sign({ sellerId, userType: "seller" }, process.env.JWT_SECRET, {
    expiresIn: "30d"
  });
};

// Step 1: Apply as Seller
exports.applyAsSeller = async (request, reply) => {
  try {
    const { email, phone, contactPerson } = request.body;

    if (!email || !phone || !contactPerson) {
      return reply.status(400).send({
        success: false,
        message: "Email, phone, and contact person are required"
      });
    }

    // Check if email exists across all collections
    const emailCheck = await checkEmailExists(email);
    
    if (emailCheck.exists) {
      // Allow continuing only if it's an unverified seller registration
      if (emailCheck.location === "sellers" && !emailCheck.verified && emailCheck.allowContinue) {
        const sellerId = emailCheck.sellerId;
        
        // Generate new OTP for existing unverified seller
        const otp = generateOTP();
        
        await db.collection("otps").add({
          sellerId,
          userType: "seller",
          otp,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        await sendOTPEmail(email, otp, contactPerson);

        return reply.status(200).send({
          success: true,
          message: "OTP sent to your email. Please verify to continue.",
          sellerId
        });
      }
      
      // Email exists elsewhere - reject
      return reply.status(400).send({
        success: false,
        message: emailCheck.message
      });
    }

    // Create new seller document
    const sellerRef = await db.collection("sellers").add({
      email: email.toLowerCase(),
      phone,
      contactPerson,
      emailVerified: false,
      phoneVerified: false,
      onboardingStep: 1,
      status: "draft",
      productCount: 0,
      minimumProductsUploaded: false,
      culturalApprovalStatus: "pending",
      appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    const sellerId = sellerRef.id;

    // Generate OTP
    const otp = generateOTP();
    
    // Store OTP in Firebase
    await db.collection("otps").add({
      sellerId,
      userType: "seller",
      otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Send OTP email
    await sendOTPEmail(email, otp, contactPerson);

    reply.status(200).send({
      success: true,
      message: "OTP sent to your email. Please verify to continue.",
      sellerId
    });
  } catch (error) {
    console.error("Apply as seller error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Step 2: Verify OTP & Set Password
exports.verifyOTP = async (request, reply) => {
  try {
    const { sellerId, otp, password } = request.body;

    if (!sellerId || !otp) {
      return reply.status(400).send({
        success: false,
        message: "Seller ID and OTP are required"
      });
    }

    if (!password || password.length < 6) {
      return reply.status(400).send({
        success: false,
        message: "Password is required and must be at least 6 characters"
      });
    }

    // Find OTP
    const otpSnapshot = await db.collection("otps")
      .where("sellerId", "==", sellerId)
      .where("userType", "==", "seller")
      .where("otp", "==", otp)
      .get();

    if (otpSnapshot.empty) {
      return reply.status(400).send({ 
        success: false, 
        message: "Invalid OTP" 
      });
    }

    const otpDoc = otpSnapshot.docs[0];
    const otpData = otpDoc.data();

    // Check if OTP is expired
    if (otpData.expiresAt.toDate() < new Date()) {
      await otpDoc.ref.delete();
      return reply.status(400).send({ 
        success: false, 
        message: "OTP has expired. Please request a new one." 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update seller
    await db.collection("sellers").doc(sellerId).update({
      password: hashedPassword,
      emailVerified: true,
      onboardingStep: 2,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Delete used OTP
    await otpDoc.ref.delete();

    // Get updated seller data
    const sellerDoc = await db.collection("sellers").doc(sellerId).get();
    const seller = { id: sellerDoc.id, ...sellerDoc.data() };
    delete seller.password; // Don't send password in response

    // Generate JWT token for authentication
    const token = generateSellerToken(sellerId);

    reply.status(200).send({
      success: true,
      message: "Email verified and password set successfully. You can now continue with your application.",
      seller,
      token
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Seller Login
exports.sellerLogin = async (request, reply) => {
  try {
    const { email, password } = request.body;

    if (!email || !password) {
      return reply.status(400).send({
        success: false,
        message: "Email and password are required"
      });
    }

    // Find seller by email
    const sellerSnapshot = await db.collection("sellers")
      .where("email", "==", email.toLowerCase())
      .get();

    if (sellerSnapshot.empty) {
      return reply.status(401).send({
        success: false,
        message: "Invalid email or password"
      });
    }

    const sellerDoc = sellerSnapshot.docs[0];
    const seller = { id: sellerDoc.id, ...sellerDoc.data() };

    // Check if seller has set password
    if (!seller.password) {
      return reply.status(400).send({
        success: false,
        message: "Please complete your registration first by verifying OTP and setting a password"
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, seller.password);

    if (!isPasswordValid) {
      return reply.status(401).send({
        success: false,
        message: "Invalid email or password"
      });
    }

    // Check if seller is active
    if (seller.status === "rejected") {
      return reply.status(403).send({
        success: false,
        message: "Your seller account has been rejected. Please contact support."
      });
    }

    // Generate JWT token
    const token = generateSellerToken(seller.id);

    // Remove sensitive data
    delete seller.password;

    reply.status(200).send({
      success: true,
      message: "Login successful",
      seller,
      token
    });
  } catch (error) {
    console.error("Seller login error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Resend OTP
exports.resendOTP = async (request, reply) => {
  try {
    const { sellerId } = request.body;

    const sellerDoc = await db.collection("sellers").doc(sellerId).get();
    if (!sellerDoc.exists) {
      return reply.status(404).send({ success: false, message: "Seller not found" });
    }

    const seller = sellerDoc.data();

    if (seller.emailVerified) {
      return reply.status(400).send({
        success: false,
        message: "Email already verified"
      });
    }

    // Generate new OTP
    const otp = generateOTP();

    // Delete old OTPs
    const oldOtps = await db.collection("otps")
      .where("sellerId", "==", sellerId)
      .where("userType", "==", "seller")
      .get();
    
    oldOtps.forEach(doc => doc.ref.delete());

    // Store new OTP
    await db.collection("otps").add({
      sellerId,
      userType: "seller",
      otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Send OTP
    await sendOTPEmail(seller.email, otp, seller.contactPerson);

    reply.status(200).send({
      success: true,
      message: "New OTP sent to your email"
    });
  } catch (error) {
    console.error("Resend OTP error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Step 3: Submit Business Details & ABN
exports.submitBusinessDetails = async (request, reply) => {
  try {
    const { businessName, abn, businessAddress } = request.body;
    const sellerId = request.sellerId;

    console.log("📝 Submit business details - sellerId:", sellerId);

    if (!sellerId) {
      console.error("❌ Seller ID is undefined");
      return reply.status(401).send({
        success: false,
        message: "Authentication error: Seller ID not found"
      });
    }

    if (!businessName || !abn) {
      return reply.status(400).send({
        success: false,
        message: "Business name and ABN are required"
      });
    }

    // Check if ABN already exists
    const abnSnapshot = await db.collection("sellers")
      .where("abn", "==", abn.replace(/\s/g, ""))
      .get();

    if (!abnSnapshot.empty && abnSnapshot.docs[0].id !== sellerId) {
      return reply.status(400).send({ 
        success: false, 
        message: "This ABN is already registered by another seller" 
      });
    }

    // Get current seller data
    const sellerDoc = await db.collection("sellers").doc(sellerId).get();
    const currentStep = sellerDoc.data().onboardingStep || 2;

    // Update seller
    await db.collection("sellers").doc(sellerId).update({
      businessName,
      abn: abn.replace(/\s/g, ""),
      businessAddress: businessAddress || {},
      onboardingStep: Math.max(currentStep, 3),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const updatedSeller = await db.collection("sellers").doc(sellerId).get();
    const seller = { id: updatedSeller.id, ...updatedSeller.data() };

    reply.status(200).send({
      success: true,
      message: "Business details saved successfully",
      seller
    });
  } catch (error) {
    console.error("Submit business details error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Validate ABN with Vigil API
exports.validateABN = async (request, reply) => {
  try {
    const { abn } = request.body;
    const sellerId = request.sellerId;

    if (!abn) {
      return reply.status(400).send({
        success: false,
        message: "ABN is required"
      });
    }

    // Call Vigil API for ABN validation
    const abnValidation = await validateABNWithVigil(abn);

    if (!abnValidation.isValid) {
      return reply.status(400).send({
        success: false,
        message: abnValidation.message || "Invalid ABN or business not found"
      });
    }

    // Update seller
    await db.collection("sellers").doc(sellerId).update({
      abnVerified: true,
      abnValidationData: abnValidation.data,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    reply.status(200).send({
      success: true,
      message: "ABN verified successfully",
      businessInfo: abnValidation.data
    });
  } catch (error) {
    console.error("ABN validation error:", error);
    reply.status(500).send({ 
      success: false, 
      message: "ABN validation failed. Please try again." 
    });
  }
};

// Step 4: Submit Cultural Information
exports.submitCulturalInfo = async (request, reply) => {
  try {
    const { artistName, clanAffiliation, culturalStory } = request.body;
    const sellerId = request.sellerId;

    const sellerDoc = await db.collection("sellers").doc(sellerId).get();
    const currentStep = sellerDoc.data().onboardingStep || 3;

    await db.collection("sellers").doc(sellerId).update({
      artistName: artistName || "",
      clanAffiliation: clanAffiliation || "",
      culturalStory: culturalStory || "",
      onboardingStep: Math.max(currentStep, 4),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const updatedSeller = await db.collection("sellers").doc(sellerId).get();
    const seller = { id: updatedSeller.id, ...updatedSeller.data() };

    reply.status(200).send({
      success: true,
      message: "Cultural information saved successfully",
      seller
    });
  } catch (error) {
    console.error("Submit cultural info error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Step 5: Submit Store Profile with Logo Upload
exports.submitStoreProfile = async (request, reply) => {
  try {
    const { storeName, storeBio } = request.body;
    const sellerId = request.sellerId;
    const file = request.file;

    if (!storeName) {
      return reply.status(400).send({
        success: false,
        message: "Store name is required"
      });
    }

    // Check if store name is unique
    const storeSnapshot = await db.collection("sellers")
      .where("storeName", "==", storeName)
      .get();
    
    if (!storeSnapshot.empty && storeSnapshot.docs[0].id !== sellerId) {
      return reply.status(400).send({ 
        success: false, 
        message: "Store name already taken. Please choose another." 
      });
    }

    let storeLogo = null;

    // Upload logo to Firebase Storage if file exists
    if (file) {
      try {
        const bucket = admin.storage().bucket();
        const fileName = `sellers/${sellerId}/logo_${Date.now()}_${file.originalname}`;
        const fileUpload = bucket.file(fileName);

        await fileUpload.save(file.buffer, {
          metadata: {
            contentType: file.mimetype
          }
        });

        // Make file publicly accessible
        await fileUpload.makePublic();
        
        // Get public URL
        storeLogo = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      } catch (uploadError) {
        console.error("File upload error:", uploadError);
        return reply.status(500).send({
          success: false,
          message: "Failed to upload logo. Please try again."
        });
      }
    }

    const sellerDoc = await db.collection("sellers").doc(sellerId).get();
    const currentStep = sellerDoc.data().onboardingStep || 4;

    const updateData = {
      storeName,
      storeBio: storeBio || "",
      onboardingStep: Math.max(currentStep, 5),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (storeLogo) {
      updateData.storeLogo = storeLogo;
    }

    await db.collection("sellers").doc(sellerId).update(updateData);

    const updatedSeller = await db.collection("sellers").doc(sellerId).get();
    const seller = { id: updatedSeller.id, ...updatedSeller.data() };

    reply.status(200).send({
      success: true,
      message: "Store profile saved successfully",
      seller
    });
  } catch (error) {
    console.error("Submit store profile error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Step 6: Upload KYC Documents with Vigil Integration
exports.uploadKYC = async (request, reply) => {
  try {
    const { documentType, firstName, lastName, dateOfBirth } = request.body;
    const sellerId = request.sellerId;
    const file = request.file;

    if (!file) {
      return reply.status(400).send({ 
        success: false, 
        message: "Document file is required" 
      });
    }

    if (!documentType) {
      return reply.status(400).send({
        success: false,
        message: "Document type is required (passport, drivers_license, or medicare)"
      });
    }

    if (!firstName || !lastName || !dateOfBirth) {
      return reply.status(400).send({
        success: false,
        message: "First name, last name, and date of birth are required for verification"
      });
    }

    try {
      // Step 1: Verify identity with Vigil API
      const verification = await verifyIdentityDocument({
        documentType,
        firstName,
        lastName,
        dateOfBirth,
        documentFrontBuffer: file.buffer,
        mimeType: file.mimetype,
        sellerId
      });
      
      if (!verification.success) {
        return reply.status(400).send({
          success: false,
          message: "Identity verification failed"
        });
      }

      // Step 2: Upload document to Firebase Storage
      const bucket = admin.storage().bucket();
      const fileName = `sellers/${sellerId}/kyc_${Date.now()}_${file.originalname}`;
      const fileUpload = bucket.file(fileName);

      await fileUpload.save(file.buffer, {
        metadata: {
          contentType: file.mimetype
        }
      });

      // Get download URL (signed URL for security)
      const [url] = await fileUpload.getSignedUrl({
        action: 'read',
        expires: '03-01-2500' // Far future date
      });

      const sellerDoc = await db.collection("sellers").doc(sellerId).get();
      const currentStep = sellerDoc.data().onboardingStep || 5;

      // Step 3: Update seller with KYC info and verification data
      await db.collection("sellers").doc(sellerId).update({
        idDocument: {
          type: documentType,
          documentUrl: url,
          fileName: fileName,
          firstName,
          lastName,
          dateOfBirth,
          uploadedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        vigilVerification: {
          verificationId: verification.verificationId,
          verified: verification.verified,
          confidence: verification.confidence,
          documentData: verification.documentData,
          checks: verification.checks,
          warnings: verification.warnings,
          verifiedAt: verification.timestamp
        },
        kycStatus: "submitted",
        onboardingStep: Math.max(currentStep, 6),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const updatedSeller = await db.collection("sellers").doc(sellerId).get();
      const seller = { id: updatedSeller.id, ...updatedSeller.data() };

      reply.status(200).send({
        success: true,
        message: "KYC document uploaded and verified successfully",
        seller,
        vigilVerification: {
          verificationId: verification.verificationId,
          verified: verification.verified,
          confidence: verification.confidence,
          warnings: verification.warnings
        }
      });
    } catch (uploadError) {
      console.error("File upload error:", uploadError);
      return reply.status(500).send({
        success: false,
        message: uploadError.message || "Failed to upload document. Please try again."
      });
    }
  } catch (error) {
    console.error("Upload KYC error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Step 7: Submit Bank Details (Optional - can be added later)
exports.submitBankDetails = async (request, reply) => {
  try {
    const { accountName, bsb, accountNumber } = request.body;
    const sellerId = request.sellerId;

    if (!accountName || !bsb || !accountNumber) {
      return reply.status(400).send({
        success: false,
        message: "Account name, BSB, and account number are required"
      });
    }

    await db.collection("sellers").doc(sellerId).update({
      bankDetails: {
        accountName,
        bsb,
        accountNumber,
        verified: false,
        addedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const updatedSeller = await db.collection("sellers").doc(sellerId).get();
    const seller = { id: updatedSeller.id, ...updatedSeller.data() };

    reply.status(200).send({
      success: true,
      message: "Bank details saved. You can update these later if needed.",
      seller
    });
  } catch (error) {
    console.error("Submit bank details error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Submit for Admin Review
exports.submitForReview = async (request, reply) => {
  try {
    const sellerId = request.sellerId;
    const sellerDoc = await db.collection("sellers").doc(sellerId).get();
    const seller = sellerDoc.data();

    // Validation checks
    if (!seller.emailVerified) {
      return reply.status(400).send({ 
        success: false, 
        message: "Email verification is required before submission" 
      });
    }

    if (!seller.abnVerified) {
      return reply.status(400).send({ 
        success: false, 
        message: "ABN verification is required before submission" 
      });
    }

    if (seller.kycStatus !== "submitted") {
      return reply.status(400).send({ 
        success: false, 
        message: "KYC documents must be uploaded before submission" 
      });
    }

    if (!seller.storeName) {
      return reply.status(400).send({
        success: false,
        message: "Store profile must be completed before submission"
      });
    }

    // Update status
    await db.collection("sellers").doc(sellerId).update({
      status: "pending_review",
      submittedForReviewAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const updatedSeller = await db.collection("sellers").doc(sellerId).get();

    // TODO: Send notification email to admin

    // Prepare response message with product requirements
    let message = "Application submitted for review successfully! You'll be notified once approved.";
    
    if (!seller.productCount || seller.productCount < 5) {
      message += " Note: After approval, you'll need to upload at least 1-2 products to start, with 5+ products recommended for going live. Each product should have 3-5 high-quality images.";
    }

    reply.status(200).send({
      success: true,
      message,
      seller: { id: updatedSeller.id, ...updatedSeller.data() },
      nextSteps: {
        current: "pending_review",
        next: "After admin approval, upload products (minimum 1-2, recommended 5+) with 3-5 images each"
      }
    });
  } catch (error) {
    console.error("Submit for review error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Get Seller Profile
exports.getProfile = async (request, reply) => {
  try {
    const sellerId = request.sellerId;
    const sellerDoc = await db.collection("sellers").doc(sellerId).get();
    
    if (!sellerDoc.exists) {
      return reply.status(404).send({ 
        success: false, 
        message: "Seller profile not found" 
      });
    }

    const seller = { id: sellerDoc.id, ...sellerDoc.data() };
    
    // Remove sensitive data
    if (seller.idDocument) {
      delete seller.idDocument.documentUrl;
    }

    reply.status(200).send({ success: true, seller });
  } catch (error) {
    console.error("Get profile error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Update Seller Profile
exports.updateProfile = async (request, reply) => {
  try {
    const sellerId = request.sellerId;
    const allowedUpdates = ["phone", "businessAddress", "storeBio", "culturalStory", "artistName", "clanAffiliation"];
    
    const updates = {};
    for (const key of allowedUpdates) {
      if (request.body[key] !== undefined) {
        updates[key] = request.body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({
        success: false,
        message: "No valid fields to update"
      });
    }

    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await db.collection("sellers").doc(sellerId).update(updates);

    const updatedSeller = await db.collection("sellers").doc(sellerId).get();
    const seller = { id: updatedSeller.id, ...updatedSeller.data() };

    reply.status(200).send({
      success: true,
      message: "Profile updated successfully",
      seller
    });
  } catch (error) {
    console.error("Update profile error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Get Go-Live Status (Check if seller can go live)
exports.getGoLiveStatus = async (request, reply) => {
  try {
    const sellerId = request.sellerId;

    const sellerDoc = await db.collection("sellers").doc(sellerId).get();

    if (!sellerDoc.exists) {
      return reply.status(404).send({
        success: false,
        message: "Seller not found"
      });
    }

    const seller = sellerDoc.data();

    const checks = {
      approved: seller.status === "approved" || seller.status === "active",
      minimumProducts: seller.productCount >= 1,
      culturalApproval: seller.culturalApprovalStatus === "approved",
      isLive: seller.status === "active"
    };

    const canGoLive = checks.approved && checks.minimumProducts && checks.culturalApproval && !checks.isLive;

    reply.status(200).send({
      success: true,
      canGoLive,
      isLive: checks.isLive,
      checks,
      currentStatus: seller.status,
      productCount: seller.productCount || 0,
      pendingProducts: checks.isLive ? 0 : seller.productCount || 0,
      message: checks.isLive 
        ? "Your store is live!"
        : canGoLive
        ? "Ready to go live! Admin will activate your store soon."
        : "Complete all requirements to go live",
      requirements: {
        approval: checks.approved ? "✓ Completed" : "⏳ Pending admin approval",
        products: checks.minimumProducts ? "✓ Completed" : `⏳ Upload at least 1-2 products (current: ${seller.productCount || 0})`,
        culturalApproval: checks.culturalApproval ? "✓ Completed" : "⏳ Pending cultural approval from admin"
      }
    });
  } catch (error) {
    console.error("Get go-live status error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Helper: Update Seller Product Count (called from product controller)
exports.updateProductCount = async (sellerId, increment = true) => {
  try {
    const sellerDoc = await db.collection("sellers").doc(sellerId).get();
    
    if (!sellerDoc.exists) {
      throw new Error("Seller not found");
    }

    const currentCount = sellerDoc.data().productCount || 0;
    const newCount = increment ? currentCount + 1 : Math.max(0, currentCount - 1);
    
    const updateData = {
      productCount: newCount,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Check if minimum products uploaded
    if (newCount >= 1 && !sellerDoc.data().minimumProductsUploaded) {
      updateData.minimumProductsUploaded = true;
    } else if (newCount < 1) {
      updateData.minimumProductsUploaded = false;
    }

    await db.collection("sellers").doc(sellerId).update(updateData);

    return { success: true, productCount: newCount };
  } catch (error) {
    console.error("Update product count error:", error);
    throw error;
  }
};



