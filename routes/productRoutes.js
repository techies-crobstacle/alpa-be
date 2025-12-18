const { authenticateSeller } = require("../middlewares/authMiddleware");
const { addProduct, getMyProducts, getAllProducts, getProductById, deleteProduct, updateProduct } = require("../controllers/product");

async function productRoutes(fastify, options) {
  // ADD PRODUCT (Seller only - must be approved)
  fastify.post("/add", { preHandler: authenticateSeller }, addProduct);

  // GET ALL PRODUCTS (Public)
  fastify.get("/all", getAllProducts);

  // GET MY PRODUCTS (Seller only)
  fastify.get("/my-products", { preHandler: authenticateSeller }, getMyProducts);

  // GET PRODUCT BY ID (Public)
  fastify.get("/:id", getProductById);

  // UPDATE PRODUCT (Seller only - own products)
  fastify.put("/:id", { preHandler: authenticateSeller }, updateProduct);

  // DELETE PRODUCT (Seller only - own products)
  fastify.delete("/:id", { preHandler: authenticateSeller }, deleteProduct);
}

module.exports = productRoutes;


