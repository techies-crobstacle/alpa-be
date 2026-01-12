const wishlistController = require("../controllers/wishlist");
const { authenticateUser } = require("../middlewares/authMiddleware");

async function wishlistRoutes(fastify, options) {
  // Get user's wishlist
  fastify.get("/", { preHandler: authenticateUser }, wishlistController.getWishlist);

  // Add product to wishlist
  fastify.post("/:productId", { preHandler: authenticateUser }, wishlistController.addToWishlist);

  // Remove product from wishlist
  fastify.delete("/:productId", { preHandler: authenticateUser }, wishlistController.removeFromWishlist);

  // Toggle product in wishlist (add/remove)
  fastify.put("/toggle/:productId", { preHandler: authenticateUser }, wishlistController.toggleWishlist);

  // Check if product is in wishlist
  fastify.get("/check/:productId", { preHandler: authenticateUser }, wishlistController.isInWishlist);

  // Clear entire wishlist
  fastify.delete("/", { preHandler: authenticateUser }, wishlistController.clearWishlist);

  // Move wishlist item to cart
  fastify.post("/move-to-cart/:productId", { preHandler: authenticateUser }, wishlistController.moveToCart);
}

module.exports = wishlistRoutes;
