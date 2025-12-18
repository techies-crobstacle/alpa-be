const { admin, db } = require("../config/firebase");
const jwt = require("jsonwebtoken");
const { generateOTP, sendOTPEmail } = require("../utils/emailService");
const { checkEmailExists } = require("../utils/emailValidation");

// SIGNUP - Send OTP for verification
exports.register = async (request, reply) => {
  try {
    console.log("📝 Register request received:", { email: request.body?.email });
    
    const { name, email, password, mobile, role } = request.body;

    if (!name || !email || !password || !mobile || !role) {
      console.log("❌ Missing required fields");
      return reply.status(400).send({ success: false, message: "All fields are required" });
    }

    console.log("🔍 Checking if email exists...");
    // Check if email exists across all collections
    const emailCheck = await checkEmailExists(email);
    
    if (emailCheck.exists) {
      // Allow resending OTP if pending registration expired
      if (emailCheck.location === "pending_registrations" && emailCheck.allowResend) {
        console.log("♻️ Deleting expired pending registration");
        // Delete expired pending registration and continue
        await db.collection("pending_registrations").doc(email.toLowerCase()).delete();
      } else {
        console.log("❌ Email already exists:", emailCheck.message);
        return reply.status(400).send({ 
          success: false, 
          message: emailCheck.message 
        });
      }
    }

    console.log("🔑 Generating OTP...");
    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    console.log("💾 Storing pending registration in Firestore...");
    // Store pending registration in Firestore
    await db.collection("pending_registrations").doc(email.toLowerCase()).set({
      name,
      email: email.toLowerCase(),
      password,
      mobile,
      role,
      otp,
      otpExpiry,
      createdAt: new Date(),
    });

    console.log("📧 Sending OTP email...");
    // Send OTP email
    const emailResult = await sendOTPEmail(email, otp, name);

    if (!emailResult.success) {
      console.error("❌ Email sending failed:", emailResult.error);
      return reply.status(500).send({ 
        success: false, 
        message: "Failed to send OTP email. Please try again.",
        details: emailResult.error 
      });
    }

    console.log("✅ Registration successful, OTP sent");
    return reply.status(200).send({ 
      success: true, 
      message: "OTP sent to your email. Please verify to complete registration.",
      email 
    });
  } catch (error) {
    console.error("❌ Register error:", error);
    return reply.status(500).send({ success: false, error: error.message });
  }
};


// LOGIN - Simplified: Generate JWT after verifying user exists in Firebase Auth
// Note: Firebase Admin SDK cannot verify passwords, so we trust Firebase Auth user exists
// For production, use client-side Firebase SDK to authenticate and send ID token
exports.login = async (request, reply) => {
  try {
    const { email, password } = request.body;

    if (!email || !password) {
      return reply.status(400).send({ success: false, message: "Email & password are required" });
    }

    // Get user by email from Firebase Auth
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (error) {
      return reply.status(404).send({ success: false, message: "User not found or invalid credentials" });
    }

    const uid = userRecord.uid;

    // Get user data from Firestore
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return reply.status(404).send({ success: false, message: "User data not found" });
    }

    const user = userDoc.data();

    // Generate JWT token for API authentication
    const token = jwt.sign(
      { uid, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const userResponse = {
      id: uid,
      uid,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      createdAt: user.createdAt || null,
    };

    return reply.status(200).send({ 
      success: true, 
      message: "Login successful", 
      token, 
      role: user.role, 
      user: userResponse 
    });
  } catch (error) {
    return reply.status(500).send({ success: false, error: error.message });
  }
};

// VERIFY OTP - Complete registration after OTP verification
exports.verifyOTP = async (request, reply) => {
  try {
    const { email, otp } = request.body;

    if (!email || !otp) {
      return reply.status(400).send({ success: false, message: "Email and OTP are required" });
    }

    // Get pending registration (case-insensitive)
    const normalizedEmail = email.toLowerCase();
    const pendingDoc = await db.collection("pending_registrations").doc(normalizedEmail).get();

    if (!pendingDoc.exists) {
      return reply.status(404).send({ 
        success: false, 
        message: "No pending registration found. Please register first." 
      });
    }

    const pendingData = pendingDoc.data();

    // Check if OTP has expired
    if (new Date() > pendingData.otpExpiry.toDate()) {
      await db.collection("pending_registrations").doc(normalizedEmail).delete();
      return reply.status(400).send({ 
        success: false, 
        message: "OTP has expired. Please register again." 
      });
    }

    // Verify OTP
    if (pendingData.otp !== otp) {
      return reply.status(400).send({ 
        success: false, 
        message: "Invalid OTP. Please try again." 
      });
    }

    // OTP verified - Create user in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email: pendingData.email,
      password: pendingData.password,
      displayName: pendingData.name,
      emailVerified: true, // Mark email as verified
    });

    const uid = userRecord.uid;
    const createdAt = new Date();

    // Save user data in Firestore
    await db.collection("users").doc(uid).set({
      uid,
      name: pendingData.name,
      email: pendingData.email,
      mobile: pendingData.mobile,
      role: pendingData.role,
      createdAt,
      emailVerified: true,
    });

    // Delete pending registration
    await db.collection("pending_registrations").doc(normalizedEmail).delete();

    // Generate JWT token
    const token = jwt.sign(
      { uid, email: pendingData.email, role: pendingData.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const userResponse = {
      id: uid,
      uid,
      name: pendingData.name,
      email: pendingData.email,
      mobile: pendingData.mobile,
      role: pendingData.role,
      createdAt,
    };

    return reply.status(201).send({ 
      success: true, 
      message: "Email verified successfully. Registration complete!", 
      token,
      user: userResponse 
    });
  } catch (error) {
    return reply.status(500).send({ success: false, error: error.message });
  }
};

// RESEND OTP
exports.resendOTP = async (request, reply) => {
  try {
    const { email } = request.body;

    if (!email) {
      return reply.status(400).send({ success: false, message: "Email is required" });
    }

    // Get pending registration (case-insensitive)
    const normalizedEmail = email.toLowerCase();
    const pendingDoc = await db.collection("pending_registrations").doc(normalizedEmail).get();

    if (!pendingDoc.exists) {
      return reply.status(404).send({ 
        success: false, 
        message: "No pending registration found. Please register first." 
      });
    }

    const pendingData = pendingDoc.data();

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Update OTP in Firestore
    await db.collection("pending_registrations").doc(normalizedEmail).update({
      otp,
      otpExpiry,
    });

    // Send new OTP email
    const emailResult = await sendOTPEmail(email, otp, pendingData.name);

    if (!emailResult.success) {
      return reply.status(500).send({ 
        success: false, 
        message: "Failed to send OTP email. Please try again." 
      });
    }

    return reply.status(200).send({ 
      success: true, 
      message: "New OTP sent to your email." 
    });
  } catch (error) {
    return reply.status(500).send({ success: false, error: error.message });
  }
};



