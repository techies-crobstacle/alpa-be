const { authenticateSeller, authenticateUser } = require("../middlewares/authMiddleware");
const { handleProductImagesUpload } = require("../middlewares/upload");
const checkRole = require("../middlewares/checkRole");
const { addProduct, getMyProducts, getAllProducts, getProductById, deleteProduct, updateProduct } = require("../controllers/product");

async function productRoutes(fastify, options) {
  // ADD PRODUCT (Seller only - must be approved, with image upload)
  fastify.post("/add", { preHandler: [authenticateSeller, handleProductImagesUpload] }, addProduct);

  // GET ALL PRODUCTS (Public)
  fastify.get("/all", getAllProducts);

  // GET MY PRODUCTS (Seller only)
  fastify.get("/my-products", { preHandler: authenticateSeller }, getMyProducts);

  // GET PRODUCT BY ID (Public)
  fastify.get("/:id", getProductById);

    // UPDATE PRODUCT (Seller and Admin - own products or admin access, with image upload)
    fastify.put("/:id", { preHandler: [authenticateUser, checkRole(['SELLER', 'ADMIN']), handleProductImagesUpload] }, updateProduct);

  // DELETE PRODUCT (Seller and Admin - own products or admin access)
  fastify.delete("/:id", { preHandler: [authenticateUser, checkRole(['SELLER', 'ADMIN'])] }, deleteProduct);
}

module.exports = productRoutes;


