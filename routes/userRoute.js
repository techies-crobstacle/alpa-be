// ...existing code...
const userController = require('../controllers/user');
const authMiddleware = require('../middlewares/auth');

async function userRoutes(fastify, options) {
	// Get all users (admin only)
	fastify.get('/all', { preHandler: authMiddleware }, userController.getAllUsers);
}

module.exports = userRoutes;