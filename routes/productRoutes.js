const express = require("express");
const router = express.Router();
const { authenticateSeller } = require("../middlewares/authMiddleware");
const { addProduct, getMyProducts, getAllProducts, getProductById, deleteProduct, updateProduct } = require("../controllers/product");

// ADD PRODUCT (Seller only - must be approved)
router.post("/add", authenticateSeller, addProduct);

// GET ALL PRODUCTS (Public)
router.get("/all", getAllProducts);

// GET MY PRODUCTS (Seller only)
router.get("/my-products", authenticateSeller, getMyProducts);

// GET PRODUCT BY ID (Public)
router.get("/:id", getProductById);

// UPDATE PRODUCT (Seller only - own products)
router.put("/:id", authenticateSeller, updateProduct);

// DELETE PRODUCT (Seller only - own products)
router.delete("/:id", authenticateSeller, deleteProduct);

module.exports = router;
