const auth = require("../middlewares/auth");
const { addToCart, getMyCart, updateCartQuantity, removeFromCart } = require("../controllers/cart");

async function cartRoutes(fastify, options) {
  // ADD TO CART
  fastify.post("/add", { preHandler: auth }, addToCart);
  fastify.get("/view", { preHandler: auth }, addToCart);
  fastify.get("/my-cart", { preHandler: auth }, getMyCart);
  fastify.delete("/remove/:productId", { preHandler: auth }, removeFromCart);
  fastify.put("/update", { preHandler: auth }, updateCartQuantity);
}

module.exports = cartRoutes;


