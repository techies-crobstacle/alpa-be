const fastify = require("fastify");
const dotenv = require("dotenv");
dotenv.config();

// Import Prisma client
const prisma = require("./config/prisma");

const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const cartRoutes = require("./routes/cart");
const orderRoutes = require("./routes/orderRoutes");
const sellerOrderRoutes = require("./routes/sellerOrderRoutes");
const sellerOnboardingRoutes = require("./routes/sellerOnboardingRoutes");
const adminRoutes = require("./routes/adminRoutes");
const supportRoutes = require("./routes/supportRoutes");
const ratingRoutes = require("./routes/ratingRoutes");
const locationRoutes = require("./routes/locationRoutes.js");
const userRoutes = require("./routes/userRoute");
const profileRoutes = require("./routes/profileRoute");
const couponRoutes = require("./routes/couponRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const wishlistRoutes = require("./routes/wishlistRoutes");
const orderNotificationRoutes = require("./routes/orderNotificationRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const shippingRoutes = require("./routes/shippingRoutes");
const gstRoutes = require("./routes/gstRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const { initializeSLAMonitoring } = require("./utils/slaScheduler");
const { scheduleEmailVerificationReminder } = require("./utils/emailVerificationScheduler");

const app = fastify({ 
  logger: process.env.NODE_ENV === 'production' ? false : true,
  requestTimeout: 30000 // 30 second timeout
});

// Register CORS - Allow all origins with credentials
app.register(require("@fastify/cors"), {
  origin: true, // Allow all origins and echo back the request origin
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

// Register cookie plugin for session management
app.register(require("@fastify/cookie"));

// Register Session (Required for Passport)
app.register(require("@fastify/secure-session"), {
  secret: process.env.SESSION_SECRET || "averylogphrasebiggerthanthirtytwochars", 
  salt: process.env.SESSION_SALT || "mq9hDxBq5Jmq9hDx",
  cookie: {
    path: '/',
    httpOnly: true // Use httpOnly for security
  }
});

// Register Passport
const fastifyPassport = require("@fastify/passport");
app.register(fastifyPassport.initialize());
app.register(fastifyPassport.secureSession());

// Load Passport Config (SAML)
require("./config/passport")(app);

app.register(require("@fastify/formbody"));
app.register(require("@fastify/multipart"), {
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Global error handler
app.setErrorHandler((error, request, reply) => {
  console.error("❌ Fastify error:", error);
  reply.status(error.statusCode || 500).send({
    success: false,
    error: error.message || "Internal server error"
  });
});

// Health check endpoint
app.get("/", async (request, reply) => {
  return { status: "Server is running", timestamp: new Date().toISOString() };
});

// Register routes
app.register(authRoutes, { prefix: "/api/auth" });
app.register(productRoutes, { prefix: "/api/products" });
app.register(cartRoutes, { prefix: "/api/cart" });
app.register(orderRoutes, { prefix: "/api/orders" });
app.register(sellerOrderRoutes, { prefix: "/api/seller/orders" });
app.register(sellerOnboardingRoutes, { prefix: "/api/sellers" });
app.register(supportRoutes, { prefix: "/api/support" });
app.register(adminRoutes, { prefix: "/api/admin" });
app.register(ratingRoutes, { prefix: "/api/ratings" });
app.register(locationRoutes, { prefix: "/api" });
app.register(require("./routes/userRoute"), { prefix: "/api/users" });
app.register(profileRoutes, { prefix: "/api" });
app.register(couponRoutes, { prefix: "/api/coupons" });
app.register(notificationRoutes, { prefix: "/api/notifications" });
app.register(wishlistRoutes, { prefix: "/api/wishlist" });
app.register(orderNotificationRoutes, { prefix: "/api/seller" });
app.register(categoryRoutes, { prefix: "/api/categories" });
app.register(shippingRoutes, { prefix: "/api/shipping" });
app.register(gstRoutes, { prefix: "/api/gst" });
app.register(feedbackRoutes, { prefix: "/api/feedback" });
app.register(paymentRoutes, { prefix: "/api/payments" });



const PORT = parseInt(process.env.PORT) || 5000;

// Graceful shutdown
const closeGracefully = async (signal) => {
  console.log(`Received signal ${signal}, closing gracefully...`);
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', closeGracefully);
process.on('SIGTERM', closeGracefully);

app.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server running on ${address}`);
  
  // Initialize SLA monitoring after server starts
  setTimeout(() => {
    initializeSLAMonitoring();
  }, 5000); // Wait 5 seconds for server to be fully ready
  
  // Initialize email verification reminder scheduler (can be disabled via env var)
  const enableEmailScheduler = process.env.ENABLE_EMAIL_SCHEDULER !== 'false';
  if (enableEmailScheduler) {
    setTimeout(() => {
      scheduleEmailVerificationReminder();
    }, 5000); // Wait 5 seconds for server to be fully ready
  } else {
    console.log("📧 Email verification scheduler disabled via ENABLE_EMAIL_SCHEDULER=false");
  }
});