const { validate, autocomplete } = require('../controllers/location');
const { authenticateUser } = require('../middlewares/authMiddleware');

async function locationRoutes(fastify, options) {
  // Frontend will use Google Places Autocomplete (client-side)
  // Backend endpoint: Validate place_id from frontend selection
  fastify.post(
    '/validate-location',
    {
      preHandler: [authenticateUser],
      schema: {
        body: {
          type: 'object',
          required: ['place_id'],
          properties: {
            place_id: { 
              type: 'string',
              description: 'Google Place ID from Places Autocomplete'
            }
          }
        }
      }
    },
    validate
  );
}

module.exports = locationRoutes;
