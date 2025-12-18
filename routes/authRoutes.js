const { register, login, verifyOTP, resendOTP } = require("../controllers/auth");

async function authRoutes(fastify, options) {
  fastify.post("/signup", register);
  fastify.post("/verify-otp", verifyOTP);
  fastify.post("/resend-otp", resendOTP);
  fastify.post("/login", login);
}

module.exports = authRoutes;
