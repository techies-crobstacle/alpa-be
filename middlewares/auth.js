const jwt = require("jsonwebtoken");

module.exports = async (request, reply) => {
  try {
    const header = request.headers.authorization;
    console.log('Authorization header:', header);
    console.log('JWT_SECRET:', process.env.JWT_SECRET);

    if (!header || !header.startsWith("Bearer ")) {
      console.log('No token provided');
      return reply.status(401).send({
        success: false,
        message: "No token provided"
      });
    }

    const token = header.split(" ")[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      request.user = decoded;
    } catch (jwtError) {
      console.log('JWT verification error:', jwtError);
      return reply.status(401).send({
        success: false,
        message: "Invalid or expired token"
      });
    }
  } catch (error) {
    console.log('Auth middleware error:', error);
    return reply.status(401).send({
      success: false,
      message: "Invalid or expired token"
    });
  }
};





