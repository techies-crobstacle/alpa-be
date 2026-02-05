const fastifyPassport = require("@fastify/passport");
const { register, login, logout, verifyOTP, resendOTP, forgotPassword, resetPassword, verifyLoginOTP, samlCallback } = require("../controllers/auth");

async function authRoutes(fastify, options) {
  fastify.post("/signup", register);
  fastify.post("/verify-otp", verifyOTP);
  fastify.post("/resend-otp", resendOTP);
  fastify.post("/login", login);
  fastify.post("/logout", logout);
  fastify.post("/forgot-password", forgotPassword);
  fastify.post("/reset-password", resetPassword);
  fastify.post("/verify-login-otp", verifyLoginOTP);
  
  // SAML Routes (Lane 2)
  // Initiates the SAML login flow (redirects to AuthPoint)
  fastify.get("/saml/login", fastifyPassport.authenticate("saml", {
      session: false 
  }));

  // Receives the SAML assertion from AuthPoint
  fastify.post("/saml/callback", 
      {
        preValidation: fastifyPassport.authenticate("saml", { 
            failureRedirect: "/login?error=saml_fail", 
            session: false
        })
      }, 
      samlCallback
  );
}

module.exports = authRoutes;



