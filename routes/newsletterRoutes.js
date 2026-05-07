const newsletterController = require('../controllers/newsletter');
const { isAdmin } = require('../middlewares/authMiddleware');

async function newsletterRoutes(fastify) {
  // Public route: user submits email for newsletter updates
  fastify.post('/newsletter', newsletterController.submitNewsletterEmail);
  fastify.post('/newsletter/unsubscribe', newsletterController.unsubscribeNewsletterEmail);

  // Protected route: admin views newsletter email submissions
  fastify.get('/newsletter', { preHandler: isAdmin }, newsletterController.getNewsletterEmails);
  fastify.get('/newsletter/export', { preHandler: isAdmin }, newsletterController.exportNewsletterEmailsCsv);
}

module.exports = newsletterRoutes;
