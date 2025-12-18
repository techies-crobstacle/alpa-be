const express = require("express");
const cors = require("cors");
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

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth Routes
app.use("/api/auth", authRoutes);

// Product Routes
app.use("/api/products", productRoutes);

// User Routes
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);

// Seller Routes
app.use("/api/seller/orders", sellerOrderRoutes);
app.use("/api/sellers", sellerOnboardingRoutes);

// Support Routes
app.use("/api/support", supportRoutes);

// Admin Routes
app.use("/api/admin", adminRoutes);

// Health check endpoint
app.get("/", (req, res) => {
  res.json({ status: "Server is running", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});