const prisma = require("../config/prisma");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { generateOTP, sendOTPEmail } = require("../utils/emailService");

// SIGNUP - Send OTP for verification
exports.register = async (request, reply) => {
  try {
    console.log("📝 Register request received:", { email: request.body?.email });
    
    const { name, email, password, mobile, role } = request.body;

    if (!name || !email || !password || !mobile || !role) {
      console.log("❌ Missing required fields");
      return reply.status(400).send({ success: false, message: "All fields are required" });
    }

    // Validate and normalize role
    const roleMap = {
      'customer': 'CUSTOMER',
      'seller': 'SELLER',
      'admin': 'ADMIN'
    };
    
    const normalizedRole = roleMap[role.toLowerCase()];
    
    if (!normalizedRole) {
      return reply.status(400).send({ 
        success: false, 
        message: "Invalid role. Must be 'customer', 'seller', or 'admin'" 
      });
    }

    const normalizedEmail = email.toLowerCase();

    console.log("🔍 Checking if email exists...");
    // Check if email already exists in users or pending registrations
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (existingUser) {
      console.log("❌ Email already registered");
      return reply.status(400).send({ 
        success: false, 
        message: "Email already registered. Please login." 
      });
    }

    // Check for expired pending registration
    const pendingReg = await prisma.pendingRegistration.findUnique({
      where: { email: normalizedEmail }
    });

    if (pendingReg) {
      // If expired, delete it and allow new registration
      if (new Date() > pendingReg.otpExpiry) {
        console.log("♻️ Deleting expired pending registration");
        await prisma.pendingRegistration.delete({
          where: { email: normalizedEmail }
        });
      } else {
        console.log("❌ Pending registration exists");
        return reply.status(400).send({ 
          success: false, 
          message: "Registration pending. Please verify your email or request a new OTP." 
        });
      }
    }

    console.log("🔑 Generating OTP and hashing password...");
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    console.log("💾 Storing pending registration in database...");
    // Store pending registration (convert role to uppercase to match Prisma enum)
    await prisma.pendingRegistration.create({
      data: {
        name,
        email: normalizedEmail,
        password: hashedPassword,
        mobile,
        role: normalizedRole, // Use the validated and normalized role
        otp,
        otpExpiry,
      }
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
      email: normalizedEmail
    });
  } catch (error) {
    console.error("❌ Register error:", error);
    return reply.status(500).send({ success: false, error: error.message });
  }
};

// LOGIN
exports.login = async (request, reply) => {
  try {
    const { email, password } = request.body;
    
    console.log("🔍 Login Request Debug:");
    console.log("  - Origin:", request.headers.origin);
    console.log("  - User-Agent:", request.headers['user-agent']?.substring(0, 50));
    console.log("  - Cookies Received:", request.cookies);

    if (!email || !password) {
      return reply.status(400).send({ success: false, message: "Email & password are required" });
    }

    const normalizedEmail = email.toLowerCase();

    // Get user by email
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (!user) {
      return reply.status(404).send({ success: false, message: "User not found or invalid credentials" });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return reply.status(401).send({ success: false, message: "Invalid credentials" });
    }

    // 🔐 NEW: Check device verification requirement
    const deviceFingerprint = generateDeviceFingerprint(request);
    
    // Check if this device has a valid session
    const existingSession = await prisma.userSession.findUnique({
      where: {
        userId_deviceFingerprint: {
          userId: user.id,
          deviceFingerprint: deviceFingerprint
        }
      }
    });

    const now = new Date();
    let needsVerification = false;

    if (!existingSession) {
      // First time login on this device
      needsVerification = true;
      console.log(`🆕 First time login on this device for ${user.email}`);
    } else if (now > existingSession.verificationExpiryAt || !existingSession.isActive) {
      // Session expired (7 days passed)
      needsVerification = true;
      console.log(`⏰ Session expired for ${user.email} on this device`);
      
      // Mark session as inactive
      await prisma.userSession.update({
        where: { id: existingSession.id },
        data: { isActive: false }
      });
    }

    // If verification is needed, send OTP instead of logging in
    if (needsVerification) {
      // Generate OTP for login verification
      const otp = generateOTP();
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      
      // Delete any existing login verification for this user/device
      await prisma.loginVerification.deleteMany({
        where: {
          userId: user.id,
          deviceFingerprint: deviceFingerprint
        }
      });
      
      // Create new login verification record
      await prisma.loginVerification.create({
        data: {
          userId: user.id,
          email: normalizedEmail,
          otp: otp,
          otpExpiry: otpExpiry,
          deviceFingerprint: deviceFingerprint
        }
      });

      // Send OTP email
      const emailResult = await sendOTPEmail(
        normalizedEmail, 
        otp, 
        user.name, 
        "Login Verification Required - New Device or Session Expired"
      );

      if (!emailResult.success) {
        return reply.status(500).send({
          success: false,
          message: "Failed to send verification email. Please try again.",
          details: emailResult.error
        });
      }

      console.log(`📧 Device verification required for ${normalizedEmail}`);

      return reply.status(200).send({
        success: true,
        message: "Device verification required. Please check your email for the verification code.",
        requiresVerification: true,
        email: normalizedEmail,
        reason: existingSession ? "Session expired after 7 days" : "First time login on this device"
      });
    }

    // 🎉 Device is already verified and session is valid - proceed with normal login
    console.log(`✅ Login successful for user ${user.email} (Device verified)`);

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, uid: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Set secure session cookie
    console.log("🍪 Setting session cookie...");
    reply.setCookie('session_token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/'
    });

    console.log("📊 Response Headers About to Send:", {
      'set-cookie': reply.getHeader?.('set-cookie') || 'NO SET-COOKIE HEADER',
      'access-control-allow-credentials': reply.getHeader?.('access-control-allow-credentials'),
      'access-control-allow-origin': reply.getHeader?.('access-control-allow-origin')
    });

    const userResponse = {
      id: user.id,
      uid: user.id,
      name: user.name,
      email: user.email,
      mobile: user.phone,
      role: user.role,
      emailVerified: user.emailVerified,
      emailVerificationDeadline: user.emailVerificationDeadline,
      createdAt: user.createdAt,
    };

    return reply.status(200).send({ 
      success: true, 
      message: "Login successful", 
      token,
      role: user.role, 
      user: userResponse,
      deviceVerified: true
    });
  } catch (error) {
    console.error("❌ Login error:", error);
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

    const normalizedEmail = email.toLowerCase();

    // Get pending registration
    const pendingData = await prisma.pendingRegistration.findUnique({
      where: { email: normalizedEmail }
    });

    if (!pendingData) {
      return reply.status(404).send({ 
        success: false, 
        message: "No pending registration found. Please register first." 
      });
    }

    // Check if OTP has expired
    if (new Date() > pendingData.otpExpiry) {
      await prisma.pendingRegistration.delete({
        where: { email: normalizedEmail }
      });
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

    // OTP verified - Create user
    // Set email verification deadline to 7 days from now
    const emailVerificationDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    
    const user = await prisma.user.create({
      data: {
        name: pendingData.name,
        email: pendingData.email,
        password: pendingData.password,
        phone: pendingData.mobile,
        role: pendingData.role,
        emailVerified: false, // Still not verified yet - user gets grace period
        isVerified: false,
        emailVerificationDeadline, // Set 7-day deadline
      }
    });

    // Delete pending registration
    await prisma.pendingRegistration.delete({
      where: { email: normalizedEmail }
    });

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, uid: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const userResponse = {
      id: user.id,
      uid: user.id,
      name: user.name,
      email: user.email,
      mobile: user.phone,
      role: user.role,
      emailVerified: user.emailVerified,
      emailVerificationDeadline: user.emailVerificationDeadline,
      createdAt: user.createdAt,
    };

    console.log(`✅ OTP verified for ${user.email}. Email verification deadline set to: ${emailVerificationDeadline}`);

    return reply.status(201).send({ 
      success: true, 
      message: "Email verified successfully. Registration complete! You can now login and use the platform.", 
      token,
      user: userResponse 
    });
  } catch (error) {
    console.error("❌ Verify OTP error:", error);
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

    const normalizedEmail = email.toLowerCase();

    // Get pending registration
    const pendingData = await prisma.pendingRegistration.findUnique({
      where: { email: normalizedEmail }
    });

    if (!pendingData) {
      return reply.status(404).send({ 
        success: false, 
        message: "No pending registration found. Please register first." 
      });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Update OTP
    await prisma.pendingRegistration.update({
      where: { email: normalizedEmail },
      data: {
        otp,
        otpExpiry,
      }
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
    console.error("❌ Resend OTP error:", error);
    return reply.status(500).send({ success: false, error: error.message });
  }
};

// FORGOT PASSWORD - Send OTP for password reset
exports.forgotPassword = async (request, reply) => {
  try {
    const { email } = request.body;

    if (!email) {
      return reply.status(400).send({ success: false, message: "Email is required" });
    }

    const normalizedEmail = email.toLowerCase();

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (!user) {
      return reply.status(404).send({ 
        success: false, 
        message: "No account found with this email address" 
      });
    }

    // Generate OTP for password reset
    const { generateOTP, sendOTPEmail } = require("../utils/emailService");
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store or update password reset request (reuse PendingRegistration table)
    await prisma.pendingRegistration.upsert({
      where: { email: normalizedEmail },
      update: {
        otp,
        otpExpiry,
        role: 'PASSWORD_RESET' // Use as flag for password reset
      },
      create: {
        email: normalizedEmail,
        name: user.name,
        role: 'PASSWORD_RESET', // Use as flag for password reset
        otp,
        otpExpiry
      }
    });

    // Send OTP email
    const emailResult = await sendOTPEmail(email, otp, user.name, 'Password Reset');

    if (!emailResult.success) {
      return reply.status(500).send({ 
        success: false, 
        message: "Failed to send reset email. Please try again." 
      });
    }

    return reply.status(200).send({ 
      success: true, 
      message: "Password reset OTP sent to your email." 
    });
  } catch (error) {
    console.error("❌ Forgot password error:", error);
    return reply.status(500).send({ success: false, error: error.message });
  }
};

// RESET PASSWORD - Verify OTP and update password
exports.resetPassword = async (request, reply) => {
  try {
    const { email, otp, newPassword } = request.body;

    if (!email || !otp || !newPassword) {
      return reply.status(400).send({ 
        success: false, 
        message: "Email, OTP and new password are required" 
      });
    }

    if (newPassword.length < 6) {
      return reply.status(400).send({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    const normalizedEmail = email.toLowerCase();

    // Get password reset request
    const resetData = await prisma.pendingRegistration.findUnique({
      where: { email: normalizedEmail }
    });

    if (!resetData || resetData.role !== 'PASSWORD_RESET') {
      return reply.status(404).send({ 
        success: false, 
        message: "No password reset request found. Please request a new reset." 
      });
    }

    // Check if OTP has expired
    if (new Date() > resetData.otpExpiry) {
      await prisma.pendingRegistration.delete({
        where: { email: normalizedEmail }
      });
      return reply.status(400).send({ 
        success: false, 
        message: "Reset OTP has expired. Please request a new reset." 
      });
    }

    // Verify OTP
    if (resetData.otp !== otp) {
      return reply.status(400).send({ 
        success: false, 
        message: "Invalid OTP. Please try again." 
      });
    }

    // Hash new password
    const saltRounds = 12;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update user password
    await prisma.user.update({
      where: { email: normalizedEmail },
      data: { password: hashedNewPassword }
    });

    // Delete password reset request
    await prisma.pendingRegistration.delete({
      where: { email: normalizedEmail }
    });

    return reply.status(200).send({ 
      success: true, 
      message: "Password reset successfully. You can now login with your new password." 
    });
  } catch (error) {
    console.error("❌ Reset password error:", error);
    return reply.status(500).send({ success: false, error: error.message });
  }
};

// LOGOUT - Clear session cookie
exports.logout = async (request, reply) => {
  try {
    console.log("🚪 Logout request received");
    
    // Clear the session cookie
    reply.clearCookie('session_token', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/'
      // Don't set domain - let browser infer from current host
    });

    console.log("✅ Session cookie cleared");

    return reply.status(200).send({ 
      success: true, 
      message: "Logout successful. Session cookie cleared." 
    });
  } catch (error) {
    console.error("❌ Logout error:", error);
    return reply.status(500).send({ success: false, error: error.message });
  }
};

// VERIFY LOGIN OTP AND COMPLETE LOGIN
exports.verifyLoginOTP = async (request, reply) => {
  try {
    const { email, otp } = request.body;
    if (!email || !otp) {
      return reply.status(400).send({ 
        success: false, 
        message: "Email and OTP are required" 
      });
    }
    const normalizedEmail = email.toLowerCase();
    const deviceFingerprint = generateDeviceFingerprint(request);
    // Find verification record
    const verification = await prisma.loginVerification.findFirst({
      where: {
        email: normalizedEmail,
        deviceFingerprint: deviceFingerprint,
        verified: false
      },
      include: {
        user: true
      }
    });
    if (!verification) {
      return reply.status(404).send({ 
        success: false, 
        message: "No verification request found or already verified" 
      });
    }
    // Check if OTP is expired
    if (new Date() > verification.otpExpiry) {
      return reply.status(400).send({ 
        success: false, 
        message: "OTP has expired. Please request a new one." 
      });
    }
    // Verify OTP
    if (verification.otp !== otp) {
      return reply.status(400).send({ 
        success: false, 
        message: "Invalid OTP" 
      });
    }
    // Mark verification as complete
    await prisma.loginVerification.update({
      where: { id: verification.id },
      data: { verified: true }
    });
    // Create/update user session for this device
    const sessionExpiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await prisma.userSession.upsert({
      where: {
        userId_deviceFingerprint: {
          userId: verification.user.id,
          deviceFingerprint: deviceFingerprint
        }
      },
      update: {
        lastVerifiedAt: new Date(),
        verificationExpiryAt: sessionExpiryDate,
        isActive: true
      },
      create: {
        userId: verification.user.id,
        deviceFingerprint: deviceFingerprint,
        lastVerifiedAt: new Date(),
        verificationExpiryAt: sessionExpiryDate,
        isActive: true
      }
    });
    // Generate JWT token
    const token = jwt.sign(
      { userId: verification.user.id, uid: verification.user.id, email: verification.user.email, role: verification.user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    // Set secure session cookie
    reply.setCookie('session_token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/'
    });
    console.log(`✅ Login verification successful for ${normalizedEmail}`);
    return reply.status(200).send({
      success: true,
      message: "Email verified successfully! You are now logged in.",
      user: {
        id: verification.user.id,
        email: verification.user.email,
        name: verification.user.name,
        role: verification.user.role,
        emailVerified: verification.user.emailVerified
      },
      token: token,
      deviceVerified: true
    });
  } catch (error) {
    console.error("❌ Verify login OTP error:", error);
    return reply.status(500).send({ success: false, error: error.message });
  }
};

// HELPER FUNCTION: Generate device fingerprint
const generateDeviceFingerprint = (request) => {
  const userAgent = request.headers['user-agent'] || '';
  // Use request.ip for Fastify
  const ip = request.headers['x-forwarded-for'] || request.headers['x-real-ip'] || request.ip || '';
  const acceptLanguage = request.headers['accept-language'] || '';
  
  // Create a simple fingerprint from browser info
  const fingerprint = require('crypto')
    .createHash('sha256')
    .update(`${userAgent}-${ip}-${acceptLanguage}`)
    .digest('hex');
    
  return fingerprint.substring(0, 16); // First 16 chars for storage
};

