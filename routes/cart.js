const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const { addToCart, getMyCart,updateCartQuantity ,removeFromCart } = require("../controllers/cart");

// ADD TO CART
router.post("/add", auth, addToCart);
router.get("/view", auth, addToCart);
router.get("/my-cart", auth, getMyCart);
router.delete("/remove/:productId", auth, removeFromCart);
router.put("/update", auth, updateCartQuantity);


module.exports = router;
