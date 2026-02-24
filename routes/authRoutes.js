const fastifyPassport = require("@fastify/passport");
const {
  register, login, logout, verifyOTP, resendOTP,
  forgotPassword, resetPassword, verifyLoginOTP, samlCallback,
  createTicket, exchangeTicket
} = require("../controllers/auth");

async function authRoutes(fastify, options) {
  fastify.post("/signup", register);
  fastify.post("/verify-otp", verifyOTP);
  fastify.post("/resend-otp", resendOTP);
  fastify.post("/login", login);
  fastify.post("/logout", logout);
  fastify.post("/forgot-password", forgotPassword);
  fastify.post("/reset-password", resetPassword);
  fastify.post("/verify-login-otp", verifyLoginOTP);

  // SSO Handshake (Sellers & Customers only — Admin uses SAML)
  // Step 1: Website calls this after login to get a short-lived ticket
  fastify.post("/create-ticket", createTicket);
  // Step 2: Dashboard calls this to exchange the ticket for its own JWT/cookie
  fastify.post("/exchange-ticket", exchangeTicket);
  
  // SAML Routes (Lane 2)
  
  // FIX: Add this so the IT Head gets a "Success" message when he clicks the link
  fastify.get("/saml/callback", async (req, reply) => {
      return reply.send("Status: OK. SAML Callback Endpoint is Active (Expecting HTTP-POST data).");
  });

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



