const { admin, db } = require("../config/firebase");
const jwt = require("jsonwebtoken");
const { generateOTP, sendOTPEmail } = require("../utils/emailService");
const { checkEmailExists } = require("../utils/emailValidation");

// SIGNUP - Send OTP for verification
exports.register = async (req, res) => {
  try {
    const { name, email, password, mobile, role } = req.body;

    if (!name || !email || !password || !mobile || !role) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    // Check if email exists across all collections
    const emailCheck = await checkEmailExists(email);
    
    if (emailCheck.exists) {
      // Allow resending OTP if pending registration expired
      if (emailCheck.location === "pending_registrations" && emailCheck.allowResend) {
        // Delete expired pending registration and continue
        await db.collection("pending_registrations").doc(email.toLowerCase()).delete();
      } else {
        return res.status(400).json({ 
          success: false, 
          message: emailCheck.message 
        });
      }
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

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

    // Send OTP email
    const emailResult = await sendOTPEmail(email, otp, name);

    if (!emailResult.success) {
      return res.status(500).json({ 
        success: false, 
        message: "Failed to send OTP email. Please try again." 
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: "OTP sent to your email. Please verify to complete registration.",
      email 
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};


// LOGIN - Simplified: Generate JWT after verifying user exists in Firebase Auth
// Note: Firebase Admin SDK cannot verify passwords, so we trust Firebase Auth user exists
// For production, use client-side Firebase SDK to authenticate and send ID token
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email & password are required" });
    }

    // Get user by email from Firebase Auth
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (error) {
      return res.status(404).json({ success: false, message: "User not found or invalid credentials" });
    }

    const uid = userRecord.uid;

    // Get user data from Firestore
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: "User data not found" });
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

    return res.status(200).json({ 
      success: true, 
      message: "Login successful", 
      token, 
      role: user.role, 
      user: userResponse 
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// VERIFY OTP - Complete registration after OTP verification
exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and OTP are required" });
    }

    // Get pending registration
    const pendingDoc = await db.collection("pending_registrations").doc(email).get();

    if (!pendingDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        message: "No pending registration found. Please register first." 
      });
    }

    const pendingData = pendingDoc.data();

    // Check if OTP has expired
    if (new Date() > pendingData.otpExpiry.toDate()) {
      await db.collection("pending_registrations").doc(email).delete();
      return res.status(400).json({ 
        success: false, 
        message: "OTP has expired. Please register again." 
      });
    }

    // Verify OTP
    if (pendingData.otp !== otp) {
      return res.status(400).json({ 
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
    await db.collection("pending_registrations").doc(email).delete();

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

    return res.status(201).json({ 
      success: true, 
      message: "Email verified successfully. Registration complete!", 
      token,
      user: userResponse 
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// RESEND OTP
exports.resendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    // Get pending registration
    const pendingDoc = await db.collection("pending_registrations").doc(email).get();

    if (!pendingDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        message: "No pending registration found. Please register first." 
      });
    }

    const pendingData = pendingDoc.data();

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Update OTP in Firestore
    await db.collection("pending_registrations").doc(email).update({
      otp,
      otpExpiry,
    });

    // Send new OTP email
    const emailResult = await sendOTPEmail(email, otp, pendingData.name);

    if (!emailResult.success) {
      return res.status(500).json({ 
        success: false, 
        message: "Failed to send OTP email. Please try again." 
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: "New OTP sent to your email." 
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
