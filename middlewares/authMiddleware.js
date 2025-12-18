const { admin, db } = require("../config/firebase");
const jwt = require("jsonwebtoken");

// Authenticate Seller (supports both JWT and Firebase tokens)
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
      // Try Firebase token first
      const decodedToken = await admin.auth().verifyIdToken(token);
      request.sellerId = decodedToken.uid;
    } catch (firebaseError) {
      // Fallback to JWT token
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        request.sellerId = decoded.sellerId || decoded.uid;
      } catch (jwtError) {
        return reply.status(401).send({ 
          success: false, 
          message: "Invalid or expired token" 
        });
      }
    }

    // Validate sellerId
    if (!request.sellerId) {
      console.error("❌ Seller ID is undefined after token decode");
      return reply.status(401).send({ 
        success: false, 
        message: "Invalid token: seller ID not found" 
      });
    }

    // Check if seller exists
    const sellerDoc = await db.collection("sellers").doc(request.sellerId).get();
    if (!sellerDoc.exists) {
      return reply.status(404).send({ 
        success: false, 
        message: "Seller not found" 
      });
    }

    request.seller = { id: sellerDoc.id, ...sellerDoc.data() };
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
      // Try Firebase token first
      const decodedToken = await admin.auth().verifyIdToken(token);
      request.userId = decodedToken.uid;
    } catch (firebaseError) {
      // Fallback to JWT token
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        request.userId = decoded.userId || decoded.uid;
      } catch (jwtError) {
        console.error("Token verification failed:", jwtError.message);
        return reply.status(401).send({ 
          success: false, 
          message: "Invalid or expired token" 
        });
      }
    }

    // Validate userId exists
    if (!request.userId) {
      return reply.status(401).send({ 
        success: false, 
        message: "Invalid token - user ID not found" 
      });
    }

    // Check if user exists
    const userDoc = await db.collection("users").doc(request.userId).get();
    if (!userDoc.exists) {
      return reply.status(404).send({ 
        success: false, 
        message: "User not found" 
      });
    }

    request.user = { id: userDoc.id, ...userDoc.data() };
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
      // Try Firebase token first
      const decodedToken = await admin.auth().verifyIdToken(token);
      request.userId = decodedToken.uid;
    } catch (firebaseError) {
      // Fallback to JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      request.userId = decoded.uid;
    }

    // Check if user is admin
    const userDoc = await db.collection("users").doc(request.userId).get();
    if (!userDoc.exists || userDoc.data().role !== "admin") {
      return reply.status(403).send({ 
        success: false, 
        message: "Admin access required" 
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





