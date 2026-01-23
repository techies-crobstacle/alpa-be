// const prisma = require("../config/prisma");
// const jwt = require("jsonwebtoken");
// const bcrypt = require("bcryptjs");
// const { generateOTP, sendOTPEmail } = require("../utils/emailService");

// // SIGNUP - Send OTP for verification
// exports.register = async (request, reply) => {
//   try {
//     console.log("📝 Register request received:", { email: request.body?.email });
    
//     const { name, email, password, mobile, role } = request.body;

//     if (!name || !email || !password || !mobile || !role) {
//       console.log("❌ Missing required fields");
//       return reply.status(400).send({ success: false, message: "All fields are required" });
//     }

//     // Validate and normalize role
//     const roleMap = {
//       'customer': 'CUSTOMER',
//       'seller': 'SELLER',
//       'admin': 'ADMIN'
//     };
    
//     const normalizedRole = roleMap[role.toLowerCase()];
    
//     if (!normalizedRole) {
//       return reply.status(400).send({ 
//         success: false, 
//         message: "Invalid role. Must be 'customer', 'seller', or 'admin'" 
//       });
//     }

//     const normalizedEmail = email.toLowerCase();

//     console.log("🔍 Checking if email exists...");
//     // Check if email already exists in users or pending registrations
//     const existingUser = await prisma.user.findUnique({
//       where: { email: normalizedEmail }
//     });

//     if (existingUser) {
//       console.log("❌ Email already registered");
//       return reply.status(400).send({ 
//         success: false, 
//         message: "Email already registered. Please login." 
//       });
//     }

//     // Check for expired pending registration
//     const pendingReg = await prisma.pendingRegistration.findUnique({
//       where: { email: normalizedEmail }
//     });

//     if (pendingReg) {
//       // If expired, delete it and allow new registration
//       if (new Date() > pendingReg.otpExpiry) {
//         console.log("♻️ Deleting expired pending registration");
//         await prisma.pendingRegistration.delete({
//           where: { email: normalizedEmail }
//         });
//       } else {
//         console.log("❌ Pending registration exists");
//         return reply.status(400).send({ 
//           success: false, 
//           message: "Registration pending. Please verify your email or request a new OTP." 
//         });
//       }
//     }

//     console.log("🔑 Generating OTP and hashing password...");
//     // Hash password
//     const hashedPassword = await bcrypt.hash(password, 10);
    
//     // Generate OTP
//     const otp = generateOTP();
//     const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

//     console.log("💾 Storing pending registration in database...");
//     // Store pending registration
//     await prisma.pendingRegistration.create({
//       data: {
//         name,
//         email: normalizedEmail,
//         password: hashedPassword,
//         mobile,
//         role: normalizedRole,
//         otp,
//         otpExpiry,
//       }
//     });

//     console.log("📧 Sending OTP email...");
//     // Send OTP email
//     const emailResult = await sendOTPEmail(email, otp, name);

//     if (!emailResult.success) {
//       console.error("❌ Email sending failed:", emailResult.error);
//       return reply.status(500).send({ 
//         success: false, 
//         message: "Failed to send OTP email. Please try again.",
//         details: emailResult.error 
//       });
//     }

//     console.log("✅ Registration successful, OTP sent");
//     return reply.status(200).send({ 
//       success: true, 
//       message: "OTP sent to your email. Please verify to complete registration.",
//       email: normalizedEmail
//     });
//   } catch (error) {
//     console.error("❌ Register error:", error);
//     return reply.status(500).send({ success: false, error: error.message });
//   }
// };

// // LOGIN
// exports.login = async (request, reply) => {
//   try {
//     const { email, password } = request.body;
//     if (!email || !password) {
//       return reply.status(400).send({ success: false, message: "Email & password are required" });
//     }
//     const normalizedEmail = email.toLowerCase();
//     const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
//     if (!user) {
//       return reply.status(404).send({ success: false, message: "User not found or invalid credentials" });
//     }
//     const isPasswordValid = await bcrypt.compare(password, user.password);
//     if (!isPasswordValid) {
//       return reply.status(401).send({ success: false, message: "Invalid credentials" });
//     }
//     const token = jwt.sign(
//       { userId: user.id, uid: user.id, email: user.email, role: user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: "7d" }
//     );
//     reply.setCookie('session_token', token, {
//       httpOnly: true,
//       secure: false,
//       sameSite: 'lax',
//       maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
//       path: '/'
//     });
//     const userResponse = {
//       id: user.id,
//       uid: user.id,
//       name: user.name,
//       email: user.email,
//       mobile: user.phone,
//       role: user.role,
//       emailVerified: user.emailVerified,
//       emailVerificationDeadline: user.emailVerificationDeadline,
//       createdAt: user.createdAt,
//     };
//     return reply.status(200).send({
//       success: true,
//       message: "Login successful",
//       token,
//       role: user.role,
//       user: userResponse
//     });
//   } catch (error) {
//     console.error("❌ Login error:", error);
//     return reply.status(500).send({ success: false, error: error.message });
//   }
// };

// // VERIFY OTP - Complete registration after OTP verification
// exports.verifyOTP = async (request, reply) => {
//   try {
//     const { email, otp } = request.body;

//     if (!email || !otp) {
//       return reply.status(400).send({ success: false, message: "Email and OTP are required" });
//     }

//     const normalizedEmail = email.toLowerCase();

//     // Get pending registration
//     const pendingData = await prisma.pendingRegistration.findUnique({
//       where: { email: normalizedEmail }
//     });

//     if (!pendingData) {
//       return reply.status(404).send({ 
//         success: false, 
//         message: "No pending registration found. Please register first." 
//       });
//     }

//     // Check if OTP has expired
//     if (new Date() > pendingData.otpExpiry) {
//       await prisma.pendingRegistration.delete({
//         where: { email: normalizedEmail }
//       });
//       return reply.status(400).send({ 
//         success: false, 
//         message: "OTP has expired. Please register again." 
//       });
//     }

//     // Verify OTP
//     if (pendingData.otp !== otp) {
//       return reply.status(400).send({ 
//         success: false, 
//         message: "Invalid OTP. Please try again." 
//       });
//     }

//     // OTP verified - Create user (emailVerified will be false, user will verify on first login)
//     const user = await prisma.user.create({
//       data: {
//         name: pendingData.name,
//         email: pendingData.email,
//         password: pendingData.password,
//         phone: pendingData.mobile,
//         role: pendingData.role,
//         emailVerified: false, // User needs to verify on first login
//         isVerified: false,
//       }
//     });

//     // Delete pending registration
//     await prisma.pendingRegistration.delete({
//       where: { email: normalizedEmail }
//     });

//     // Generate JWT token
//     const token = jwt.sign(
//       { userId: user.id, uid: user.id, email: user.email, role: user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: "7d" }
//     );

//     const userResponse = {
//       id: user.id,
//       uid: user.id,
//       name: user.name,
//       email: user.email,
//       mobile: user.phone,
//       role: user.role,
//       emailVerified: user.emailVerified,
//       createdAt: user.createdAt,
//     };

//     console.log(`✅ OTP verified for ${user.email}. User will need to verify on first login.`);

//     return reply.status(201).send({ 
//       success: true, 
//       message: "Email verified successfully. Registration complete! You can now login.", 
//       token,
//       user: userResponse 
//     });
//   } catch (error) {
//     console.error("❌ Verify OTP error:", error);
//     return reply.status(500).send({ success: false, error: error.message });
//   }
// };

// // RESEND OTP
// exports.resendOTP = async (request, reply) => {
//   try {
//     const { email } = request.body;

//     if (!email) {
//       return reply.status(400).send({ success: false, message: "Email is required" });
//     }

//     const normalizedEmail = email.toLowerCase();

//     // Get pending registration
//     const pendingData = await prisma.pendingRegistration.findUnique({
//       where: { email: normalizedEmail }
//     });

//     if (!pendingData) {
//       return reply.status(404).send({ 
//         success: false, 
//         message: "No pending registration found. Please register first." 
//       });
//     }

//     // Generate new OTP
//     const otp = generateOTP();
//     const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

//     // Update OTP
//     await prisma.pendingRegistration.update({
//       where: { email: normalizedEmail },
//       data: {
//         otp,
//         otpExpiry,
//       }
//     });

//     // Send new OTP email
//     const emailResult = await sendOTPEmail(email, otp, pendingData.name);

//     if (!emailResult.success) {
//       return reply.status(500).send({ 
//         success: false, 
//         message: "Failed to send OTP email. Please try again." 
//       });
//     }

//     return reply.status(200).send({ 
//       success: true, 
//       message: "New OTP sent to your email." 
//     });
//   } catch (error) {
//     console.error("❌ Resend OTP error:", error);
//     return reply.status(500).send({ success: false, error: error.message });
//   }
// };

// // FORGOT PASSWORD - Send OTP for password reset
// exports.forgotPassword = async (request, reply) => {
//   try {
//     const { email } = request.body;

//     if (!email) {
//       return reply.status(400).send({ success: false, message: "Email is required" });
//     }

//     const normalizedEmail = email.toLowerCase();

//     // Check if user exists
//     const user = await prisma.user.findUnique({
//       where: { email: normalizedEmail }
//     });

//     if (!user) {
//       return reply.status(404).send({ 
//         success: false, 
//         message: "No account found with this email address" 
//       });
//     }

//     // Generate OTP for password reset
//     const otp = generateOTP();
//     const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

//     // Store or update password reset request
//     await prisma.pendingRegistration.upsert({
//       where: { email: normalizedEmail },
//       update: {
//         otp,
//         otpExpiry,
//         role: 'PASSWORD_RESET'
//       },
//       create: {
//         email: normalizedEmail,
//         name: user.name,
//         password: user.password, // Store existing password temporarily
//         mobile: user.phone || '',
//         role: 'PASSWORD_RESET',
//         otp,
//         otpExpiry
//       }
//     });

//     // Send OTP email
//     const emailResult = await sendOTPEmail(email, otp, user.name, 'Password Reset');

//     if (!emailResult.success) {
//       return reply.status(500).send({ 
//         success: false, 
//         message: "Failed to send reset email. Please try again." 
//       });
//     }

//     return reply.status(200).send({ 
//       success: true, 
//       message: "Password reset OTP sent to your email." 
//     });
//   } catch (error) {
//     console.error("❌ Forgot password error:", error);
//     return reply.status(500).send({ success: false, error: error.message });
//   }
// };

// // RESET PASSWORD - Verify OTP and update password
// exports.resetPassword = async (request, reply) => {
//   try {
//     const { email, otp, newPassword } = request.body;

//     if (!email || !otp || !newPassword) {
//       return reply.status(400).send({ 
//         success: false, 
//         message: "Email, OTP and new password are required" 
//       });
//     }

//     if (newPassword.length < 6) {
//       return reply.status(400).send({
//         success: false,
//         message: 'New password must be at least 6 characters long'
//       });
//     }

//     const normalizedEmail = email.toLowerCase();

//     // Get password reset request
//     const resetData = await prisma.pendingRegistration.findUnique({
//       where: { email: normalizedEmail }
//     });

//     if (!resetData || resetData.role !== 'PASSWORD_RESET') {
//       return reply.status(404).send({ 
//         success: false, 
//         message: "No password reset request found. Please request a new reset." 
//       });
//     }

//     // Check if OTP has expired
//     if (new Date() > resetData.otpExpiry) {
//       await prisma.pendingRegistration.delete({
//         where: { email: normalizedEmail }
//       });
//       return reply.status(400).send({ 
//         success: false, 
//         message: "Reset OTP has expired. Please request a new reset." 
//       });
//     }

//     // Verify OTP
//     if (resetData.otp !== otp) {
//       return reply.status(400).send({ 
//         success: false, 
//         message: "Invalid OTP. Please try again." 
//       });
//     }

//     // Hash new password
//     const hashedNewPassword = await bcrypt.hash(newPassword, 12);

//     // Update user password
//     await prisma.user.update({
//       where: { email: normalizedEmail },
//       data: { password: hashedNewPassword }
//     });

//     // Delete password reset request
//     await prisma.pendingRegistration.delete({
//       where: { email: normalizedEmail }
//     });

//     return reply.status(200).send({ 
//       success: true, 
//       message: "Password reset successfully. You can now login with your new password." 
//     });
//   } catch (error) {
//     console.error("❌ Reset password error:", error);
//     return reply.status(500).send({ success: false, error: error.message });
//   }
// };

// // LOGOUT - Clear session cookie
// exports.logout = async (request, reply) => {
//   try {
//     console.log("🚪 Logout request received");
    
//     // Clear the session cookie
//     reply.clearCookie('session_token', {
//       httpOnly: true,
//       secure: false,
//       sameSite: 'lax',
//       path: '/'
//     });

//     console.log("✅ Session cookie cleared");

//     return reply.status(200).send({ 
//       success: true, 
//       message: "Logout successful. Session cookie cleared." 
//     });
//   } catch (error) {
//     console.error("❌ Logout error:", error);
//     return reply.status(500).send({ success: false, error: error.message });
//   }
// };

// // VERIFY LOGIN OTP AND COMPLETE LOGIN
// exports.verifyLoginOTP = async (request, reply) => {
//   try {
//     const { email, otp } = request.body;
    
//     if (!email || !otp) {
//       return reply.status(400).send({ 
//         success: false, 
//         message: "Email and OTP are required" 
//       });
//     }
    
//     const normalizedEmail = email.toLowerCase();

//     // Find the most recent unverified verification record for this email
//     const verification = await prisma.loginVerification.findFirst({
//       where: {
//         email: normalizedEmail,
//         verified: false
//       },
//       include: {
//         user: true
//       },
//       orderBy: {
//         createdAt: 'desc'
//       }
//     });

//     if (!verification) {
//       console.log(`❌ No verification found for ${normalizedEmail}`);
//       return reply.status(404).send({ 
//         success: false, 
//         message: "Verification session expired. Please login again to receive a new OTP." 
//       });
//     }

//     // Check if OTP is expired
//     if (new Date() > verification.otpExpiry) {
//       console.log(`⏰ OTP expired for ${normalizedEmail}`);
//       // Delete expired verification
//       await prisma.loginVerification.delete({
//         where: { id: verification.id }
//       });
//       return reply.status(400).send({ 
//         success: false, 
//         message: "OTP has expired. Please login again to get a new OTP." 
//       });
//     }

//     // Verify OTP
//     if (verification.otp !== otp) {
//       console.log(`❌ Invalid OTP for ${normalizedEmail}`);
//       return reply.status(400).send({ 
//         success: false, 
//         message: "Invalid OTP. Please check and try again." 
//       });
//     }

//     console.log(`✅ OTP verified for ${normalizedEmail}`);

//     // Delete the verification record (clean up)
//     await prisma.loginVerification.delete({
//       where: { id: verification.id }
//     });

//     // Create/update user session for this device (7 days validity)
//     const sessionExpiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
//     await prisma.userSession.upsert({
//       where: {
//         userId_deviceFingerprint: {
//           userId: verification.user.id,
//           deviceFingerprint: verification.deviceFingerprint
//         }
//       },
//       update: {
//         lastVerifiedAt: new Date(),
//         verificationExpiryAt: sessionExpiryDate,
//         isActive: true
//       },
//       create: {
//         userId: verification.user.id,
//         deviceFingerprint: verification.deviceFingerprint,
//         lastVerifiedAt: new Date(),
//         verificationExpiryAt: sessionExpiryDate,
//         isActive: true
//       }
//     });

//     // Generate JWT token
//     const token = jwt.sign(
//       { userId: verification.user.id, uid: verification.user.id, email: verification.user.email, role: verification.user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: "7d" }
//     );

//     // Set secure session cookie
//     reply.setCookie('session_token', token, {
//       httpOnly: true,
//       secure: false,
//       sameSite: 'lax',
//       maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
//       path: '/'
//     });

//     console.log(`✅ Login verification successful for ${normalizedEmail}. Device session valid for 7 days.`);

//     return reply.status(200).send({
//       success: true,
//       message: "Email verified successfully! You are now logged in.",
//       user: {
//         id: verification.user.id,
//         uid: verification.user.id,
//         email: verification.user.email,
//         name: verification.user.name,
//         mobile: verification.user.phone,
//         role: verification.user.role,
//         emailVerified: verification.user.emailVerified,
//         createdAt: verification.user.createdAt
//       },
//       token: token,
//       role: verification.user.role,
//       deviceVerified: true
//     });
//   } catch (error) {
//     console.error("❌ Verify login OTP error:", error);
//     return reply.status(500).send({ success: false, error: error.message });
//   }
// };

// // RESEND LOGIN OTP
// exports.resendLoginOTP = async (request, reply) => {
//   try {
//     const { email } = request.body;

//     if (!email) {
//       return reply.status(400).send({ success: false, message: "Email is required" });
//     }

//     const normalizedEmail = email.toLowerCase();

//     // Find the user
//     const user = await prisma.user.findUnique({
//       where: { email: normalizedEmail }
//     });

//     if (!user) {
//       return reply.status(404).send({ 
//         success: false, 
//         message: "User not found" 
//       });
//     }

//     // Generate device fingerprint
//     const deviceFingerprint = generateDeviceFingerprint(request);

//     // Generate new OTP
//     const otp = generateOTP();
//     const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

//     // Delete existing unverified verification records for this user
//     await prisma.loginVerification.deleteMany({
//       where: {
//         userId: user.id,
//         verified: false
//       }
//     });

//     // Create new verification record
//     await prisma.loginVerification.create({
//       data: {
//         userId: user.id,
//         email: normalizedEmail,
//         otp: otp,
//         otpExpiry: otpExpiry,
//         deviceFingerprint: deviceFingerprint,
//         verified: false
//       }
//     });

//     // Send OTP email
//     const emailResult = await sendOTPEmail(
//       normalizedEmail,
//       otp,
//       user.name,
//       "Email Verification Required"
//     );

//     if (!emailResult.success) {
//       return reply.status(500).send({
//         success: false,
//         message: "Failed to send verification email. Please try again."
//       });
//     }

//     return reply.status(200).send({ 
//       success: true, 
//       message: "Verification OTP resent to your email." 
//     });
//   } catch (error) {
//     console.error("❌ Resend login OTP error:", error);
//     return reply.status(500).send({ success: false, error: error.message });
//   }
// };

const prisma = require("../config/prisma");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { generateOTP, sendOTPEmail } = require("../utils/emailService");

// HELPER FUNCTION: Generate device fingerprint
const generateDeviceFingerprint = (request) => {
  // Use only stable headers for device identification (exclude IP address)
  const userAgent = request.headers['user-agent'] || '';
  const acceptLanguage = request.headers['accept-language'] || '';
  const acceptEncoding = request.headers['accept-encoding'] || '';

  // Create fingerprint from stable sources only
  const fingerprintData = [
    userAgent,
    acceptLanguage,
    acceptEncoding
  ].join('|');

  const fingerprint = require('crypto')
    .createHash('sha256')
    .update(fingerprintData)
    .digest('hex');

  console.log("🔐 Device fingerprint created (no IP):", {
    userAgentLength: userAgent.length,
    fingerprintPrefix: fingerprint.substring(0, 8)
  });

  return fingerprint.substring(0, 32); // First 32 chars for storage
};

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
    // Store pending registration
    await prisma.pendingRegistration.create({
      data: {
        name,
        email: normalizedEmail,
        password: hashedPassword,
        mobile,
        role: normalizedRole,
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
    
    if (!email || !password) {
      return reply.status(400).send({ success: false, message: "Email & password are required" });
    }
    
    const normalizedEmail = email.toLowerCase();
    
    // Find user
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    
    if (!user) {
      return reply.status(404).send({ success: false, message: "User not found or invalid credentials" });
    }
    
    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return reply.status(401).send({ success: false, message: "Invalid credentials" });
    }

    // Generate device fingerprint
    const deviceFingerprint = generateDeviceFingerprint(request);
    const now = new Date();

    console.log("🔍 Checking device session for:", { 
      email: normalizedEmail, 
      deviceFingerprint,
      userId: user.id 
    });

    // Check if this device has a valid session (verified within last 7 days)
    const existingSession = await prisma.userSession.findUnique({
      where: {
        userId_deviceFingerprint: {
          userId: user.id,
          deviceFingerprint: deviceFingerprint
        }
      }
    });

    console.log("📊 Existing session:", existingSession ? {
      isActive: existingSession.isActive,
      expiresAt: existingSession.verificationExpiryAt,
      expired: now > existingSession.verificationExpiryAt
    } : "No session found");

    let needsVerification = false;
    let verificationReason = "";

    // Determine if verification is needed
    if (!user.emailVerified) {
      // First login after signup - always require verification
      console.log("🔐 First login after signup - email verification required");
      needsVerification = true;
      verificationReason = "first_login_after_signup";
    } else if (!existingSession) {
      // New device - require verification
      console.log("🆕 New device detected - verification needed");
      needsVerification = true;
      verificationReason = "new_device";
    } else if (!existingSession.isActive) {
      // Session exists but is inactive (user logged out)
      console.log("⚠️ Session exists but is inactive - verification needed");
      needsVerification = true;
      verificationReason = "session_inactive";
    } else if (now > existingSession.verificationExpiryAt) {
      // Session expired (7 days passed)
      console.log("⏰ Session expired (7 days passed) - verification needed");
      needsVerification = true;
      verificationReason = "session_expired";
    } else {
      // Session is valid and active - allow direct login
      console.log("✅ Valid session found - direct login allowed");
      needsVerification = false;
      verificationReason = "session_valid";
    }

    // If verification is NOT needed, proceed with direct login
    if (!needsVerification) {
      console.log("✅ Device verified and session active - direct login");

      const token = jwt.sign(
        { userId: user.id, uid: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      reply.setCookie('session_token', token, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/'
      });

      const userResponse = {
        id: user.id,
        uid: user.id,
        name: user.name,
        email: user.email,
        mobile: user.phone,
        role: user.role,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
      };

      return reply.status(200).send({
        success: true,
        message: "Login successful - device already verified",
        token,
        role: user.role,
        user: userResponse,
        deviceVerified: true,
        verificationReason: verificationReason
      });
    }

    // If we reach here, verification IS needed
    if (needsVerification) {
      // Check if there's already a recent verification request for this user
      // This prevents spam OTP generation from repeated login attempts
      const recentVerification = await prisma.loginVerification.findFirst({
        where: {
          userId: user.id,
          verified: false,
          createdAt: {
            gte: new Date(Date.now() - 2 * 60 * 1000) // Within last 2 minutes
          }
        }
      });

      if (recentVerification) {
        // Check if the existing OTP is still valid
        if (new Date() < recentVerification.otpExpiry) {
          console.log("⏳ Recent OTP request exists - using existing verification");
          
          const messageMap = {
            first_login_after_signup: "A verification code was already sent for your first login. Please check your email or wait 2 minutes to request a new code.",
            new_device: "A verification code was already sent for this new device. Please check your email or wait 2 minutes to request a new code.", 
            session_inactive: "A verification code was already sent. Please check your email or wait 2 minutes to request a new code.",
            session_expired: "A verification code was already sent. Please check your email or wait 2 minutes to request a new code."
          };
          
          return reply.status(200).send({
            success: true,
            message: messageMap[verificationReason] || "A verification code was already sent to your email recently. Please check your email or wait 2 minutes to request a new code.",
            requiresVerification: true,
            email: normalizedEmail,
            existingRequest: true,
            verificationReason: verificationReason
          });
        } else {
          // Existing OTP is expired, clean it up
          await prisma.loginVerification.delete({
            where: { id: recentVerification.id }
          });
        }
      }

      // Generate OTP for email verification
      const otp = generateOTP();
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Delete ALL existing login verifications for this user (both verified and unverified)
      await prisma.loginVerification.deleteMany({
        where: {
          userId: user.id
        }
      });

      // Create new login verification record
      await prisma.loginVerification.create({
        data: {
          userId: user.id,
          email: normalizedEmail,
          otp: otp,
          otpExpiry: otpExpiry,
          deviceFingerprint: deviceFingerprint,
          verified: false
        }
      });

      // Send OTP email
      const emailResult = await sendOTPEmail(
        normalizedEmail,
        otp,
        user.name,
        "Email Verification Required"
      );

      if (!emailResult.success) {
        return reply.status(500).send({
          success: false,
          message: "Failed to send verification email. Please try again.",
          details: emailResult.error
        });
      }

      console.log("✅ Verification OTP sent to email");

      return reply.status(200).send({
        success: true,
        message: verificationReason === "first_login_after_signup" 
          ? "Welcome! Please verify your email to complete your first login." 
          : "Email verification required. Please check your email for the verification code.",
        requiresVerification: true,
        email: normalizedEmail,
        verificationReason: verificationReason
      });
    }
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

    // OTP verified - Create user (emailVerified will be false, user will verify on first login)
    const user = await prisma.user.create({
      data: {
        name: pendingData.name,
        email: pendingData.email,
        password: pendingData.password,
        phone: pendingData.mobile,
        role: pendingData.role,
        emailVerified: false, // User needs to verify on first login
        isVerified: false,
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
      createdAt: user.createdAt,
    };

    console.log(`✅ OTP verified for ${user.email}. User will need to verify on first login.`);

    return reply.status(201).send({ 
      success: true, 
      message: "Email verified successfully. Registration complete! You can now login.", 
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

    // Rate limiting: Check if OTP was updated recently (within 1 minute)
    const now = new Date();
    const timeSinceLastUpdate = now.getTime() - pendingData.updatedAt.getTime();
    const oneMinute = 60 * 1000;

    if (timeSinceLastUpdate < oneMinute) {
      const waitTime = Math.ceil((oneMinute - timeSinceLastUpdate) / 1000);
      return reply.status(429).send({ 
        success: false, 
        message: `Please wait ${waitTime} seconds before requesting a new OTP.`,
        waitTime: waitTime
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

    console.log(`✅ Registration OTP resent to ${normalizedEmail}`);

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
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store or update password reset request
    await prisma.pendingRegistration.upsert({
      where: { email: normalizedEmail },
      update: {
        otp,
        otpExpiry,
        role: 'PASSWORD_RESET'
      },
      create: {
        email: normalizedEmail,
        name: user.name,
        password: user.password, // Store existing password temporarily
        mobile: user.phone || '',
        role: 'PASSWORD_RESET',
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
    const hashedNewPassword = await bcrypt.hash(newPassword, 12);

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

// LOGOUT - Clear session cookie and invalidate device session
exports.logout = async (request, reply) => {
  try {
    console.log("🚪 Logout request received");
    
    // Try to get user info from token to invalidate their session
    const token = request.cookies.session_token || request.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId || decoded.uid;
        
        if (userId) {
          // Generate device fingerprint
          const deviceFingerprint = generateDeviceFingerprint(request);
          
          // Find and deactivate the user session for this device
          const session = await prisma.userSession.findUnique({
            where: {
              userId_deviceFingerprint: {
                userId: userId,
                deviceFingerprint: deviceFingerprint
              }
            }
          });
          
          if (session) {
            // Mark session as inactive instead of deleting (keeps history)
            await prisma.userSession.update({
              where: { id: session.id },
              data: { isActive: false }
            });
            console.log(`✅ Device session deactivated for user ${userId}`);
          }
        }
      } catch (err) {
        console.log("⚠️ Could not decode token or invalidate session:", err.message);
      }
    }
    
    // Clear the session cookie
    reply.clearCookie('session_token', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/'
    });

    console.log("✅ Session cookie cleared");

    return reply.status(200).send({ 
      success: true, 
      message: "Logout successful. You will need to verify your email on next login." 
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

    // Find the most recent unverified verification record for this email
    const verification = await prisma.loginVerification.findFirst({
      where: {
        email: normalizedEmail,
        verified: false
      },
      include: {
        user: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!verification) {
      console.log(`❌ No verification found for ${normalizedEmail}`);
      return reply.status(404).send({ 
        success: false, 
        message: "Verification session expired. Please login again to receive a new OTP." 
      });
    }

    // Check if OTP is expired
    if (new Date() > verification.otpExpiry) {
      console.log(`⏰ OTP expired for ${normalizedEmail}`);
      // Delete expired verification
      await prisma.loginVerification.delete({
        where: { id: verification.id }
      });
      return reply.status(400).send({ 
        success: false, 
        message: "OTP has expired. Please login again to get a new OTP." 
      });
    }

    // Verify OTP
    if (verification.otp !== otp) {
      console.log(`❌ Invalid OTP for ${normalizedEmail}`);
      return reply.status(400).send({ 
        success: false, 
        message: "Invalid OTP. Please check and try again." 
      });
    }

    console.log(`✅ OTP verified for ${normalizedEmail}`);

    // If this was the user's first login after signup, mark email as verified
    if (!verification.user.emailVerified) {
      await prisma.user.update({
        where: { id: verification.user.id },
        data: { emailVerified: true }
      });
      console.log(`📧 Email marked as verified for ${normalizedEmail} (first login completed)`);
    }

    // Delete the verification record (clean up)
    await prisma.loginVerification.delete({
      where: { id: verification.id }
    });

    // Create/update user session for this device (7 days validity)
    const sessionExpiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
    await prisma.userSession.upsert({
      where: {
        userId_deviceFingerprint: {
          userId: verification.user.id,
          deviceFingerprint: verification.deviceFingerprint
        }
      },
      update: {
        lastVerifiedAt: new Date(),
        verificationExpiryAt: sessionExpiryDate,
        isActive: true
      },
      create: {
        userId: verification.user.id,
        deviceFingerprint: verification.deviceFingerprint,
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

    console.log(`✅ Login verification successful for ${normalizedEmail}. Device session valid for 7 days.`);

    // Get updated user data (in case emailVerified was updated)
    const updatedUser = await prisma.user.findUnique({
      where: { id: verification.user.id }
    });

    return reply.status(200).send({
      success: true,
      message: !verification.user.emailVerified 
        ? "Welcome! Your email has been verified and you're now logged in." 
        : "Email verified successfully! You are now logged in.",
      user: {
        id: updatedUser.id,
        uid: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        mobile: updatedUser.phone,
        role: updatedUser.role,
        emailVerified: updatedUser.emailVerified,
        createdAt: updatedUser.createdAt
      },
      token: token,
      role: updatedUser.role,
      deviceVerified: true,
      firstLoginCompleted: !verification.user.emailVerified // True if this was their first login
    });
  } catch (error) {
    console.error("❌ Verify login OTP error:", error);
    return reply.status(500).send({ success: false, error: error.message });
  }
};

// RESEND LOGIN OTP
exports.resendLoginOTP = async (request, reply) => {
  try {
    const { email } = request.body;

    if (!email) {
      return reply.status(400).send({ success: false, message: "Email is required" });
    }

    const normalizedEmail = email.toLowerCase();

    // Find the user
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (!user) {
      return reply.status(404).send({ 
        success: false, 
        message: "User not found" 
      });
    }

    // Check for recent resend attempts (rate limiting)
    const recentRequest = await prisma.loginVerification.findFirst({
      where: {
        userId: user.id,
        verified: false,
        createdAt: {
          gte: new Date(Date.now() - 60 * 1000) // Within last 1 minute
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (recentRequest) {
      const secondsSinceLastRequest = Math.floor((Date.now() - recentRequest.createdAt.getTime()) / 1000);
      const waitTime = 60 - secondsSinceLastRequest;
      
      return reply.status(429).send({ 
        success: false, 
        message: `Please wait ${waitTime} seconds before requesting a new OTP.`,
        waitTime: waitTime
      });
    }

    // Generate device fingerprint
    const deviceFingerprint = generateDeviceFingerprint(request);

    // Generate new OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Delete existing unverified verification records for this user
    await prisma.loginVerification.deleteMany({
      where: {
        userId: user.id,
        verified: false
      }
    });

    // Create new verification record
    await prisma.loginVerification.create({
      data: {
        userId: user.id,
        email: normalizedEmail,
        otp: otp,
        otpExpiry: otpExpiry,
        deviceFingerprint: deviceFingerprint,
        verified: false
      }
    });

    // Send OTP email
    const emailResult = await sendOTPEmail(
      normalizedEmail,
      otp,
      user.name,
      "Email Verification Required"
    );

    if (!emailResult.success) {
      return reply.status(500).send({
        success: false,
        message: "Failed to send verification email. Please try again."
      });
    }

    console.log(`✅ New login OTP sent to ${normalizedEmail}`);

    return reply.status(200).send({
      success: true,
      message: "New OTP sent to your email."
    });
  } catch (error) {
    console.error("❌ Resend login OTP error:", error);
    return reply.status(500).send({ success: false, error: error.message });
  }
};