const { authenticateUser } = require("../middlewares/authMiddleware");
const checkRole = require("../middlewares/checkRole");
const commissionController = require("../controllers/commission");

async function commissionRoutes(fastify, options) {
  // GET /api/commissions/earned/my
  // Seller views their own commission earned records (with optional filters)
  fastify.get(
    "/earned/my",
    { preHandler: [authenticateUser, checkRole(["SELLER"])] },
    commissionController.getMyCommissionEarned
  );
}

module.exports = commissionRoutes;
