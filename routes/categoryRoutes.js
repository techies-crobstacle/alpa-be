const categoryController = require("../controllers/categories");
const { authenticateSeller } = require("../middlewares/authMiddleware");
const authMiddleware = require("../middlewares/auth");
const checkRole = require("../middlewares/checkRole");

async function categoryRoutes(fastify, options) {
  // GET ALL CATEGORIES - accessible to sellers and admin
  // Shows approved categories, and pending/rejected for admins only
  fastify.get("/", {
    preHandler: [authMiddleware, checkRole(['SELLER', 'ADMIN'])]
  }, categoryController.getAllCategories);

  // REQUEST A NEW CATEGORY - sellers and admin can request
  fastify.post("/request", {
    preHandler: [authMiddleware, checkRole(['SELLER', 'ADMIN'])]
  }, categoryController.requestCategory);

  // CREATE CATEGORIES DIRECTLY - admin only, bulk create
  fastify.post("/create-direct", {
    preHandler: [authMiddleware, checkRole('ADMIN')]
  }, categoryController.createCategoryDirect);

  // APPROVE CATEGORY REQUEST - admin only
  fastify.post("/approve/:id", {
    preHandler: [authMiddleware, checkRole('ADMIN')]
  }, categoryController.approveCategory);

  // REJECT CATEGORY REQUEST - admin only
  fastify.post("/reject/:id", {
    preHandler: [authMiddleware, checkRole('ADMIN')]
  }, categoryController.rejectCategory);
}

module.exports = categoryRoutes;
