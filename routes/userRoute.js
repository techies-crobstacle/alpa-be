// ...existing code...
const userController = require('../controllers/user');
const authMiddleware = require('../middlewares/auth');

async function userRoutes(fastify, options) {
	// Get all users (admin only)
	fastify.get('/all', { preHandler: authMiddleware }, userController.getAllUsers);

	// Get profile for any user (no auth)
	fastify.get('/profile', userController.getProfile);
}

module.exports = userRoutes;

