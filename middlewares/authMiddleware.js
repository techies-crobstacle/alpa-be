const { admin, db } = require("../config/firebase");
const jwt = require("jsonwebtoken");

// Authenticate Seller (supports both JWT and Firebase tokens)
exports.authenticateSeller = async (req, res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ 
        success: false, 
        message: "No token provided" 
      });
    }

    const token = header.split(" ")[1];

    try {
      // Try Firebase token first
      const decodedToken = await admin.auth().verifyIdToken(token);
      req.sellerId = decodedToken.uid;
    } catch (firebaseError) {
      // Fallback to JWT token
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.sellerId = decoded.sellerId || decoded.uid;
      } catch (jwtError) {
        return res.status(401).json({ 
          success: false, 
          message: "Invalid or expired token" 
        });
      }
    }

    // Check if seller exists
    const sellerDoc = await db.collection("sellers").doc(req.sellerId).get();
    if (!sellerDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        message: "Seller not found" 
      });
    }

    req.seller = { id: sellerDoc.id, ...sellerDoc.data() };
    next();
  } catch (error) {
    console.error("Auth error:", error);
    res.status(401).json({ 
      success: false, 
      message: "Authentication failed" 
    });
  }
};

// Authenticate User (Customer)
exports.authenticateUser = async (req, res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ 
        success: false, 
        message: "No token provided" 
      });
    }

    const token = header.split(" ")[1];

    try {
      // Try Firebase token first
      const decodedToken = await admin.auth().verifyIdToken(token);
      req.userId = decodedToken.uid;
    } catch (firebaseError) {
      // Fallback to JWT token
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId || decoded.uid;
      } catch (jwtError) {
        console.error("Token verification failed:", jwtError.message);
        return res.status(401).json({ 
          success: false, 
          message: "Invalid or expired token" 
        });
      }
    }

    // Validate userId exists
    if (!req.userId) {
      return res.status(401).json({ 
        success: false, 
        message: "Invalid token - user ID not found" 
      });
    }

    // Check if user exists
    const userDoc = await db.collection("users").doc(req.userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found" 
      });
    }

    req.user = { id: userDoc.id, ...userDoc.data() };
    next();
  } catch (error) {
    console.error("User auth error:", error);
    res.status(401).json({ 
      success: false, 
      message: "Authentication failed",
      details: error.message 
    });
  }
};

// Authenticate Admin
exports.isAdmin = async (req, res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ 
        success: false, 
        message: "No token provided" 
      });
    }

    const token = header.split(" ")[1];

    try {
      // Try Firebase token first
      const decodedToken = await admin.auth().verifyIdToken(token);
      req.userId = decodedToken.uid;
    } catch (firebaseError) {
      // Fallback to JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.userId = decoded.uid;
    }

    // Check if user is admin
    const userDoc = await db.collection("users").doc(req.userId).get();
    if (!userDoc.exists || userDoc.data().role !== "admin") {
      return res.status(403).json({ 
        success: false, 
        message: "Admin access required" 
      });
    }

    next();
  } catch (error) {
    console.error("Admin auth error:", error);
    res.status(401).json({ 
      success: false, 
      message: "Authentication failed" 
    });
  }
};
