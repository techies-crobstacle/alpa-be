const profileController = require('../controllers/profile');
const authMiddleware = require('../middlewares/auth');

async function profileRoutes(fastify, options) {
  // Get user profile for authenticated user
  fastify.get('/profile', { preHandler: authMiddleware }, profileController.getProfile);

  // Update user profile for authenticated user
  fastify.put('/profile', { preHandler: authMiddleware }, profileController.updateProfile);

  // Change password for authenticated user
  fastify.put('/change-password', { preHandler: authMiddleware }, profileController.changePassword);
}

module.exports = profileRoutes;
