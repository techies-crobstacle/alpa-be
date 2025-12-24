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

    // Check if email is verified
    if (!user.emailVerified) {
      return reply.status(403).send({ 
        success: false, 
        message: "Email not verified. Please verify your email first." 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { uid: user.id, email: user.email, role: user.role },
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
      createdAt: user.createdAt,
    };

    return reply.status(200).send({ 
      success: true, 
      message: "Login successful", 
      token, 
      role: user.role, 
      user: userResponse 
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
    const user = await prisma.user.create({
      data: {
        name: pendingData.name,
        email: pendingData.email,
        password: pendingData.password,
        phone: pendingData.mobile,
        role: pendingData.role,
        emailVerified: true,
        isVerified: true,
      }
    });

    // Delete pending registration
    await prisma.pendingRegistration.delete({
      where: { email: normalizedEmail }
    });

    // Generate JWT token
    const token = jwt.sign(
      { uid: user.id, email: user.email, role: user.role },
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
      createdAt: user.createdAt,
    };

    return reply.status(201).send({ 
      success: true, 
      message: "Email verified successfully. Registration complete!", 
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