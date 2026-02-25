const prisma = require("../config/prisma");
const jwt = require("jsonwebtoken");
const { isBlacklisted } = require("../utils/tokenDenylist");

// Authenticate Seller (JWT-based with Prisma)
exports.authenticateSeller = async (request, reply) => {
  try {
    const header = request.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return reply.status(401).send({ 
        success: false, 
        message: "No token provided" 
      });
    }

    const token = header.split(" ")[1];

    try {
      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Reject tokens invalidated via logout
      if (decoded.jti && await isBlacklisted(decoded.jti)) {
        return reply.status(401).send({
          success: false,
          message: "Token has been invalidated. Please log in again."
        });
      }

      // Support both userId and sellerId for backward compatibility
      const userId = decoded.userId || decoded.sellerId;
      
      if (!userId) {
        return reply.status(401).send({ 
          success: false, 
          message: "Invalid token: user ID not found" 
        });
      }

      // Check if user exists and is a seller
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { sellerProfile: true }
      });

      if (!user) {
        return reply.status(404).send({ 
          success: false, 
          message: "User not found" 
        });
      }

      if (user.role !== 'SELLER') {
        return reply.status(403).send({ 
          success: false, 
          message: "Access denied. Seller account required." 
        });
      }

      // Attach user info to request
      request.user = {
        userId: user.id,
        email: user.email,
        role: user.role,
        sellerProfile: user.sellerProfile
      };

    } catch (error) {
      console.error("Token verification error:", error.message);
      return reply.status(401).send({ 
        success: false, 
        message: "Invalid or expired token" 
      });
    }
  } catch (error) {
    console.error("❌ Auth error:", error.message);
    reply.status(401).send({ 
      success: false, 
      message: "Authentication failed",
      error: error.message 
    });
  }
};

// Authenticate User (Customer)
exports.authenticateUser = async (request, reply) => {
  try {
    const header = request.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return reply.status(401).send({ 
        success: false, 
        message: "No token provided" 
      });
    }

    const token = header.split(" ")[1];

    try {
      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Reject tokens invalidated via logout
      if (decoded.jti && await isBlacklisted(decoded.jti)) {
        return reply.status(401).send({
          success: false,
          message: "Token has been invalidated. Please log in again."
        });
      }

      // Support both userId and uid for backward compatibility
      const userId = decoded.userId || decoded.uid;

      if (!userId) {
        return reply.status(401).send({ 
          success: false, 
          message: "Invalid token - user ID not found" 
        });
      }

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        return reply.status(404).send({ 
          success: false, 
          message: "User not found" 
        });
      }

      // Attach user to request
      request.user = {
        userId: user.id,
        email: user.email,
        role: user.role,
        name: user.name
      };

    } catch (error) {
      console.error("Token verification failed:", error.message);
      return reply.status(401).send({ 
        success: false, 
        message: "Invalid or expired token" 
      });
    }
  } catch (error) {
    console.error("User auth error:", error);
    reply.status(401).send({ 
      success: false, 
      message: "Authentication failed",
      details: error.message 
    });
  }
};

// Authenticate Admin
exports.isAdmin = async (request, reply) => {
  try {
    const header = request.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return reply.status(401).send({ 
        success: false, 
        message: "No token provided" 
      });
    }

    const token = header.split(" ")[1];

    try {
      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Reject tokens invalidated via logout
      if (decoded.jti && await isBlacklisted(decoded.jti)) {
        return reply.status(401).send({
          success: false,
          message: "Token has been invalidated. Please log in again."
        });
      }

      // Support both userId and uid for backward compatibility
      const userId = decoded.userId || decoded.uid;

      if (!userId) {
        return reply.status(401).send({ 
          success: false, 
          message: "Invalid token" 
        });
      }

      // Check if user is admin
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user || user.role !== 'ADMIN') {
        return reply.status(403).send({ 
          success: false, 
          message: "Admin access required" 
        });
      }

      // Attach user to request
      request.user = {
        userId: user.id,
        email: user.email,
        role: user.role
      };

    } catch (error) {
      console.error("Token verification failed:", error.message);
      return reply.status(401).send({ 
        success: false, 
        message: "Invalid or expired token" 
      });
    }
  } catch (error) {
    console.error("Admin auth error:", error);
    reply.status(401).send({ 
      success: false, 
      message: "Authentication failed" 
    });
  }
};

