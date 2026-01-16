const { register, login, logout, verifyOTP, resendOTP, forgotPassword, resetPassword, verifyLoginOTP } = require("../controllers/auth");

async function authRoutes(fastify, options) {
  fastify.post("/signup", register);
  fastify.post("/verify-otp", verifyOTP);
  fastify.post("/resend-otp", resendOTP);
  fastify.post("/login", login);
  fastify.post("/logout", logout);
  fastify.post("/forgot-password", forgotPassword);
  fastify.post("/reset-password", resetPassword);
  fastify.post("/verify-login-otp", verifyLoginOTP);
  

}

module.exports = authRoutes;


