const { 
  createShippingMethod,
  getActiveShippingMethods,
  getAllShippingMethods,
  getShippingMethodById,
  updateShippingMethod,
  deleteShippingMethod,
  toggleShippingMethodStatus
} = require('../controllers/shipping');
const { isAdmin } = require('../middlewares/authMiddleware');

async function shippingRoutes(fastify, options) {
  /**
   * PUBLIC ROUTES - For customers to view available shipping options
   */
  // GET /api/shipping/active - Get all active shipping methods
  fastify.get('/active', getActiveShippingMethods);

  /**
   * ADMIN ONLY ROUTES - For managing shipping methods
   */
  // POST /api/shipping - Create new shipping method
  fastify.post('/', { preHandler: isAdmin }, createShippingMethod);

  // GET /api/shipping - Get all shipping methods (including inactive)
  fastify.get('/', { preHandler: isAdmin }, getAllShippingMethods);

  // GET /api/shipping/:id - Get single shipping method by ID
  fastify.get('/:id', { preHandler: isAdmin }, getShippingMethodById);

  // PUT /api/shipping/:id - Update shipping method
  fastify.put('/:id', { preHandler: isAdmin }, updateShippingMethod);

  // DELETE /api/shipping/:id - Delete shipping method
  fastify.delete('/:id', { preHandler: isAdmin }, deleteShippingMethod);

  // PATCH /api/shipping/:id/toggle - Toggle shipping method active status
  fastify.patch('/:id/toggle', { preHandler: isAdmin }, toggleShippingMethodStatus);
}

module.exports = shippingRoutes;
