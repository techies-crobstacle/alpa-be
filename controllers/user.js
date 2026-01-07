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
// Get profile for authenticated user
exports.getProfile = async (request, reply) => {
  try {
    console.log('Request user:', request.user); // Add this debug log
    
    const userId = request.user?.id;
    
    if (!userId) {
      return reply.status(401).send({ 
        success: false,
        message: 'Unauthorized - User ID not found in token' 
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        profileImage: true,
        role: true,
        isVerified: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user) {
      return reply.status(404).send({ 
        success: false,
        message: 'User not found' 
      });
    }

    reply.send({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    reply.status(500).send({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
};
