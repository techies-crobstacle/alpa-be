// ...existing code...
const prisma = require('../config/prisma');

exports.getAllUsers = async (request, reply) => {
  try {
    // Debug: log the user object
    console.log('Authenticated user:', request.user);
    // Prisma enum is ADMIN (not 'admin')
    if (!request.user || request.user.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Access denied. Admins only.' });
    }
    const users = await prisma.user.findMany();
    reply.send(users);
  } catch (error) {
    reply.status(500).send({ message: 'Server error', error: error.message });
  }
};
// ...existing code...