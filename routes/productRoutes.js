const { authenticateSeller, authenticateUser } = require("../middlewares/authMiddleware");
const { handleProductImagesUpload } = require("../middlewares/upload");
const checkRole = require("../middlewares/checkRole");
const {
  addProduct,
  getMyProducts,
  getAllProducts,
  getProductById,
  deleteProduct,
  updateProduct,
  getProductStock,
  getBulkStock
} = require("../controllers/product");

async function productRoutes(fastify, options) {
  // ADD PRODUCT (Seller only - must be approved, with image upload)
  fastify.post("/add", { preHandler: [authenticateSeller, handleProductImagesUpload] }, addProduct);

  // GET ALL PRODUCTS (Public)
  fastify.get("/all", getAllProducts);

  // BULK STOCK CHECK (Public) — must be registered before /:id to avoid route conflict
  fastify.post("/bulk-stock", getBulkStock);

  // GET MY PRODUCTS (Seller only)
  fastify.get("/my-products", { preHandler: authenticateSeller }, getMyProducts);

  // GET PRODUCT STOCK BY ID (Public — lightweight real-time polling endpoint)
  fastify.get("/:id/stock", getProductStock);

  // GET PRODUCT BY ID (Public)
  fastify.get("/:id", getProductById);

  // UPDATE PRODUCT (Seller and Admin - own products or admin access, with image upload)
  fastify.put("/:id", { preHandler: [authenticateUser, checkRole(['SELLER', 'ADMIN']), handleProductImagesUpload] }, updateProduct);

  // DELETE PRODUCT (Seller and Admin - own products or admin access)
  fastify.delete("/:id", { preHandler: [authenticateUser, checkRole(['SELLER', 'ADMIN'])] }, deleteProduct);
}

module.exports = productRoutes;


