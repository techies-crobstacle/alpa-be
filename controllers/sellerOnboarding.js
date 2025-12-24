const prisma = require("../config/prisma");
const { generateOTP, sendOTPEmail } = require("../utils/emailService");
const { validateABNWithVigil, verifyIdentityDocument } = require("../utils/vigilAPI");
const { uploadToCloudinary } = require("../config/cloudinary");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const fs = require('fs').promises;

// Helper function to generate seller JWT token
const generateSellerToken = (userId) => {
  return jwt.sign({ userId, userType: "seller", role: "SELLER" }, process.env.JWT_SECRET, {
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

    const normalizedEmail = email.toLowerCase();

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { sellerProfile: true }
    });

    if (existingUser) {
      // If user exists but hasn't verified email, allow resending OTP
      if (!existingUser.emailVerified && existingUser.role === 'SELLER') {
        // Generate new OTP
        const otp = generateOTP();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Update or create pending registration
        await prisma.pendingRegistration.upsert({
          where: { email: normalizedEmail },
          update: {
            otp,
            otpExpiry,
            updatedAt: new Date()
          },
          create: {
            email: normalizedEmail,
            phone,
            name: contactPerson,
            otp,
            otpExpiry,
            role: 'SELLER'
          }
        });

        await sendOTPEmail(normalizedEmail, otp, contactPerson);

        return reply.status(200).send({
          success: true,
          message: "OTP sent to your email. Please verify to continue.",
          userId: existingUser.id
        });
      }

      return reply.status(400).send({
        success: false,
        message: "Email already registered"
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    // Create or update pending registration (upsert to handle re-applications)
    const pendingReg = await prisma.pendingRegistration.upsert({
      where: { email: normalizedEmail },
      update: {
        phone,
        name: contactPerson,
        otp,
        otpExpiry,
        role: 'SELLER'
      },
      create: {
        email: normalizedEmail,
        phone,
        name: contactPerson,
        otp,
        otpExpiry,
        role: 'SELLER'
      }
    });

    // Send OTP email
    await sendOTPEmail(normalizedEmail, otp, contactPerson);

    reply.status(200).send({
      success: true,
      message: "OTP sent to your email. Please verify to continue.",
      sellerId: pendingReg.id,
      email: normalizedEmail
    });
  } catch (error) {
    console.error("Apply as seller error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Step 2: Verify OTP & Set Password
exports.verifyOTP = async (request, reply) => {
  try {
    const { email, sellerId, otp, password } = request.body;

    // Support both email and sellerId for backward compatibility
    if ((!email && !sellerId) || !otp) {
      return reply.status(400).send({
        success: false,
        message: "Email or Seller ID and OTP are required"
      });
    }

    if (!password || password.length < 6) {
      return reply.status(400).send({
        success: false,
        message: "Password is required and must be at least 6 characters"
      });
    }

    // Find pending registration by email or sellerId
    let pending;
    if (sellerId) {
      pending = await prisma.pendingRegistration.findUnique({
        where: { id: sellerId }
      });
    } else {
      const normalizedEmail = email.toLowerCase();
      pending = await prisma.pendingRegistration.findUnique({
        where: { email: normalizedEmail }
      });
    }

    if (!pending || pending.otp !== otp) {
      return reply.status(400).send({
        success: false,
        message: "Invalid OTP"
      });
    }

    // Check if OTP is expired
    if (pending.otpExpiry < new Date()) {
      await prisma.pendingRegistration.delete({
        where: { id: pending.id }
      });
      return reply.status(400).send({
        success: false,
        message: "OTP has expired. Please request a new one."
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user and seller profile in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email: pending.email,
          password: hashedPassword,
          name: pending.name,
          phone: pending.phone || pending.mobile,
          role: 'SELLER',
          emailVerified: true
        }
      });

      // Create seller profile
      const sellerProfile = await tx.sellerProfile.create({
        data: {
          userId: user.id,
          contactPerson: pending.name,
          onboardingStep: 2,
          status: 'PENDING',
          productCount: 0,
          minimumProductsUploaded: false,
          culturalApprovalStatus: 'pending'
        }
      });

      // Delete pending registration
      await tx.pendingRegistration.delete({
        where: { id: pending.id }
      });

      return { user, sellerProfile };
    });

    // Generate JWT token
    const token = generateSellerToken(result.user.id);

    // Remove password from response
    const { password: _, ...userWithoutPassword } = result.user;

    reply.status(200).send({
      success: true,
      message: "Email verified and password set successfully. You can now continue with your application.",
      user: userWithoutPassword,
      sellerProfile: result.sellerProfile,
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

    const normalizedEmail = email.toLowerCase();

    // Find seller by email
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { sellerProfile: true }
    });

    if (!user || user.role !== 'SELLER') {
      return reply.status(401).send({
        success: false,
        message: "Invalid email or password"
      });
    }

    // Check if seller has set password
    if (!user.password) {
      return reply.status(400).send({
        success: false,
        message: "Please complete your registration first by verifying OTP and setting a password"
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return reply.status(401).send({
        success: false,
        message: "Invalid email or password"
      });
    }

    // Check if seller is rejected
    if (user.sellerProfile && user.sellerProfile.status === 'REJECTED') {
      return reply.status(403).send({
        success: false,
        message: "Your seller account has been rejected. Please contact support."
      });
    }

    // Generate JWT token
    const token = generateSellerToken(user.id);

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    reply.status(200).send({
      success: true,
      message: "Login successful",
      user: userWithoutPassword,
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
    const { email, sellerId } = request.body;

    // Support both email and sellerId
    if (!email && !sellerId) {
      return reply.status(400).send({
        success: false,
        message: "Email or Seller ID is required"
      });
    }

    // Find pending registration
    let pending;
    if (sellerId) {
      pending = await prisma.pendingRegistration.findUnique({
        where: { id: sellerId }
      });
    } else {
      const normalizedEmail = email.toLowerCase();
      pending = await prisma.pendingRegistration.findUnique({
        where: { email: normalizedEmail }
      });
    }

    if (!pending) {
      return reply.status(404).send({
        success: false,
        message: "No pending registration found"
      });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    // Update pending registration with new OTP
    await prisma.pendingRegistration.update({
      where: { id: pending.id },
      data: {
        otp,
        otpExpiry,
        updatedAt: new Date()
      }
    });

    // Send OTP
    await sendOTPEmail(pending.email, otp, pending.name);

    reply.status(200).send({
      success: true,
      message: "New OTP sent to your email"
    });
  } catch (error) {
    console.error("Resend OTP error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Step 3: Submit Business Details
exports.submitBusinessDetails = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const {
      businessName,
      abn,
      businessAddress,
      businessType,
      yearsInBusiness
    } = request.body;

    if (!businessName || !abn || !businessAddress) {
      return reply.status(400).send({
        success: false,
        message: "Business name, ABN, and address are required"
      });
    }

    // Update seller profile
    const sellerProfile = await prisma.sellerProfile.update({
      where: { userId },
      data: {
        businessName,
        abn,
        businessAddress: typeof businessAddress === 'string' ? businessAddress : JSON.stringify(businessAddress),
        businessType,
        yearsInBusiness: yearsInBusiness ? parseInt(yearsInBusiness) : null,
        onboardingStep: 3,
        updatedAt: new Date()
      }
    });

    reply.status(200).send({
      success: true,
      message: "Business details submitted successfully",
      sellerProfile
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

    if (!abn) {
      return reply.status(400).send({
        success: false,
        message: "ABN is required"
      });
    }

    // Call Vigil API for ABN validation
    const abnResult = await validateABNWithVigil(abn);

    reply.status(200).send({
      success: true,
      abnValidation: abnResult
    });
  } catch (error) {
    console.error("Validate ABN error:", error);
    reply.status(500).send({
      success: false,
      message: "Failed to validate ABN",
      error: error.message
    });
  }
};

// Step 4: Submit Cultural Information
exports.submitCulturalInfo = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { culturalBackground, culturalStory } = request.body;

    // Update seller profile
    const sellerProfile = await prisma.sellerProfile.update({
      where: { userId },
      data: {
        culturalBackground,
        culturalStory,
        onboardingStep: 4,
        updatedAt: new Date()
      }
    });

    reply.status(200).send({
      success: true,
      message: "Cultural information submitted successfully",
      sellerProfile
    });
  } catch (error) {
    console.error("Submit cultural info error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Step 5: Submit Store Profile
exports.submitStoreProfile = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const {
      storeName,
      storeDescription,
      storeBio,
      storeLogo,
      logo,
      storeBanner,
      banner,
      storeLocation
    } = request.body;

    // Support both storeDescription and storeBio
    const description = storeDescription || storeBio;
    
    // Support both storeLogo/logo and storeBanner/banner
    const logoUrl = storeLogo || logo;
    const bannerUrl = storeBanner || banner;

    if (!storeName || !description) {
      return reply.status(400).send({
        success: false,
        message: "Store name and description are required"
      });
    }

    // Update seller profile
    const sellerProfile = await prisma.sellerProfile.update({
      where: { userId },
      data: {
        storeName,
        storeDescription: description,
        storeLogo: logoUrl,
        storeBanner: bannerUrl,
        storeLocation,
        onboardingStep: 5,
        updatedAt: new Date()
      }
    });

    reply.status(200).send({
      success: true,
      message: "Store profile submitted successfully",
      sellerProfile
    });
  } catch (error) {
    console.error("Submit store profile error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Step 6: Upload KYC Documents
exports.uploadKYC = async (request, reply) => {
  try {
    const userId = request.user.userId;
    
    // Files should be uploaded via multer middleware
    // Check if files exist in request
    if (!request.files || request.files.length === 0) {
      return reply.status(400).send({
        success: false,
        message: "Please upload at least one KYC document"
      });
    }

    const uploadedDocuments = [];

    // Upload each file to Cloudinary
    for (const file of request.files) {
      try {
        // Upload to Cloudinary
        const result = await uploadToCloudinary(file.path, 'kyc-documents');
        
        uploadedDocuments.push({
          documentType: file.fieldname,
          documentUrl: result.url,
          publicId: result.publicId,
          originalName: file.originalname,
          uploadedAt: new Date()
        });

        // Delete local file after upload
        await fs.unlink(file.path);
      } catch (uploadError) {
        console.error(`Failed to upload ${file.originalname}:`, uploadError);
        // Continue with other files
      }
    }

    if (uploadedDocuments.length === 0) {
      return reply.status(500).send({
        success: false,
        message: "Failed to upload documents"
      });
    }

    // Update seller profile with KYC documents
    const sellerProfile = await prisma.sellerProfile.update({
      where: { userId },
      data: {
        kycDocuments: uploadedDocuments,
        kycSubmitted: true,
        onboardingStep: 6,
        updatedAt: new Date()
      }
    });

    // Optional: Call Vigil API for identity verification
    // const verificationResult = await verifyIdentityDocument(uploadedDocuments[0].documentUrl);

    reply.status(200).send({
      success: true,
      message: "KYC documents uploaded successfully",
      documents: uploadedDocuments,
      sellerProfile
    });
  } catch (error) {
    console.error("Upload KYC error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Step 7: Submit Bank Details
exports.submitBankDetails = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { bankName, accountName, bsb, accountNumber } = request.body;

    if (!bankName || !accountName || !bsb || !accountNumber) {
      return reply.status(400).send({
        success: false,
        message: "All bank details are required"
      });
    }

    // Update seller profile
    const sellerProfile = await prisma.sellerProfile.update({
      where: { userId },
      data: {
        bankDetails: {
          bankName,
          accountName,
          bsb,
          accountNumber
        },
        onboardingStep: 7,
        updatedAt: new Date()
      }
    });

    reply.status(200).send({
      success: true,
      message: "Bank details submitted successfully",
      sellerProfile
    });
  } catch (error) {
    console.error("Submit bank details error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Step 8: Submit for Review
exports.submitForReview = async (request, reply) => {
  try {
    const userId = request.user.userId;

    // Get seller profile
    const sellerProfile = await prisma.sellerProfile.findUnique({
      where: { userId }
    });

    if (!sellerProfile) {
      return reply.status(404).send({
        success: false,
        message: "Seller profile not found"
      });
    }

    // Validate all required fields are completed
    const requiredFields = [
      'businessName',
      'abn',
      'businessAddress',
      'businessType',
      'storeName',
      'storeDescription'
    ];

    const missingFields = requiredFields.filter(field => !sellerProfile[field]);

    if (missingFields.length > 0) {
      return reply.status(400).send({
        success: false,
        message: `Please complete the following fields: ${missingFields.join(', ')}`
      });
    }

    if (!sellerProfile.kycSubmitted) {
      return reply.status(400).send({
        success: false,
        message: "Please upload KYC documents before submitting"
      });
    }

    // Update status to pending review
    const updatedProfile = await prisma.sellerProfile.update({
      where: { userId },
      data: {
        status: 'PENDING',
        submittedForReviewAt: new Date(),
        onboardingStep: 8,
        updatedAt: new Date()
      }
    });

    // TODO: Send notification to admin for review

    reply.status(200).send({
      success: true,
      message: "Application submitted for review successfully",
      sellerProfile: updatedProfile
    });
  } catch (error) {
    console.error("Submit for review error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Get Seller Profile
exports.getProfile = async (request, reply) => {
  try {
    const userId = request.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        sellerProfile: true
      }
    });

    if (!user || !user.sellerProfile) {
      return reply.status(404).send({
        success: false,
        message: "Seller profile not found"
      });
    }

    // Remove password
    const { password: _, ...userWithoutPassword } = user;

    reply.status(200).send({
      success: true,
      user: userWithoutPassword
    });
  } catch (error) {
    console.error("Get profile error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Update Seller Profile
exports.updateProfile = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const updates = request.body;

    // Remove fields that shouldn't be directly updated
    delete updates.userId;
    delete updates.status;
    delete updates.productCount;
    delete updates.kycSubmitted;

    const sellerProfile = await prisma.sellerProfile.update({
      where: { userId },
      data: {
        ...updates,
        updatedAt: new Date()
      }
    });

    reply.status(200).send({
      success: true,
      message: "Profile updated successfully",
      sellerProfile
    });
  } catch (error) {
    console.error("Update profile error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Get Go-Live Status
exports.getGoLiveStatus = async (request, reply) => {
  try {
    const userId = request.user.userId;

    const sellerProfile = await prisma.sellerProfile.findUnique({
      where: { userId }
    });

    if (!sellerProfile) {
      return reply.status(404).send({
        success: false,
        message: "Seller profile not found"
      });
    }

    // Check all requirements for going live
    const requirements = {
      accountApproved: sellerProfile.status === 'APPROVED' || sellerProfile.status === 'ACTIVE',
      minimumProducts: sellerProfile.minimumProductsUploaded,
      culturalApproved: sellerProfile.culturalApprovalStatus === 'approved',
      kycCompleted: sellerProfile.kycSubmitted,
      bankDetailsAdded: !!sellerProfile.bankDetails
    };

    const canGoLive = Object.values(requirements).every(req => req === true);

    reply.status(200).send({
      success: true,
      canGoLive,
      requirements,
      currentStatus: sellerProfile.status,
      productCount: sellerProfile.productCount
    });
  } catch (error) {
    console.error("Get go-live status error:", error);
    reply.status(500).send({ success: false, message: "Server error" });
  }
};

// Update Product Count (called when products are added/removed)
exports.updateProductCount = async (userId, increment = true) => {
  try {
    const sellerProfile = await prisma.sellerProfile.findUnique({
      where: { userId }
    });

    if (!sellerProfile) {
      throw new Error("Seller profile not found");
    }

    const newCount = increment ? sellerProfile.productCount + 1 : Math.max(0, sellerProfile.productCount - 1);

    // Check if minimum products requirement is met (e.g., 5 products)
    const minimumRequired = 5;
    const minimumProductsUploaded = newCount >= minimumRequired;

    await prisma.sellerProfile.update({
      where: { userId },
      data: {
        productCount: newCount,
        minimumProductsUploaded,
        updatedAt: new Date()
      }
    });

    return { productCount: newCount, minimumProductsUploaded };
  } catch (error) {
    console.error("Update product count error:", error);
    throw error;
  }
};



