const jwt = require("jsonwebtoken");

module.exports = async (request, reply) => {
  try {
    const header = request.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return reply.status(401).send({
        success: false,
        message: "No token provided"
      });
    }

    const token = header.split(" ")[1];

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Attach user info to request (uid, email, role)
    request.user = decoded;
  } catch (error) {
    return reply.status(401).send({
      success: false,
      message: "Invalid or expired token"
    });
  }
};





