const fastify = require("fastify");
const dotenv = require("dotenv");
dotenv.config();

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

const app = fastify({ 
  logger: process.env.NODE_ENV === 'production' ? false : true,
  requestTimeout: 30000 // 30 second timeout
});

// Register plugins
app.register(require("@fastify/cors"), {
  origin: true, // Allow all origins (configure as needed)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});
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

const PORT = process.env.PORT || 5000;

app.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server running on ${address}`);
});
