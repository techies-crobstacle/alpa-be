const prisma = require('../config/prisma');

// Get profile for authenticated user (id from token)
exports.getProfile = async (request, reply) => {
  try {
    const userId = request.user?.userId || request.user?.uid || request.user?.id;
    if (!userId) {
      return reply.status(401).send({ message: 'Unauthorized - User ID not found in token' });
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
      return reply.status(404).send({ message: 'User not found' });
    }
    reply.send(user);
  } catch (error) {
    reply.status(500).send({ message: 'Server error', error: error.message });
  }
};

// Update profile for authenticated user (id from token)
exports.updateProfile = async (request, reply) => {
  try {
    const userId = request.user?.userId || request.user?.uid || request.user?.id;
    if (!userId) {
      return reply.status(401).send({ message: 'Unauthorized - User ID not found in token' });
    }
    // Support both form-data and JSON body
    let name, phone;
    if (request.body) {
      name = request.body.name;
      phone = request.body.phone;
    } else if (request.raw.body) {
      name = request.raw.body.name;
      phone = request.raw.body.phone;
    }
    let profileImageUrl;

    // Handle profile image upload if file is present
    try {
      // Fastify v4+ puts files in request.files, older in request.raw.files
      let file = undefined;
      if (request.files && request.files.profileImage) {
        file = request.files.profileImage;
      } else if (request.raw && request.raw.files && request.raw.files.profileImage) {
        file = request.raw.files.profileImage;
      }
      console.log('Received file (request.files):', request.files);
      console.log('Received file (request.raw.files):', request.raw && request.raw.files);
      if (file) {
        const { uploadToCloudinary } = require('../config/cloudinary');
        const fs = require('fs');
        const path = require('path');
        const tempPath = path.join(__dirname, '../uploads/', `${Date.now()}_${file.name}`);
        await fs.promises.writeFile(tempPath, file.data);
        const uploadResult = await uploadToCloudinary(tempPath, 'profile');
        console.log('Cloudinary upload result:', uploadResult);
        profileImageUrl = uploadResult.url;
        await fs.promises.unlink(tempPath);
      } else if (request.body && request.body.profileImage) {
        profileImageUrl = request.body.profileImage;
      } else {
        profileImageUrl = undefined;
      }
    } catch (uploadError) {
      console.error('Profile image upload error:', uploadError);
      profileImageUrl = undefined;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        phone,
        profileImage: profileImageUrl
      },
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
    reply.send(updatedUser);
  } catch (error) {
    reply.status(500).send({ message: 'Server error', error: error.message });
  }
};
