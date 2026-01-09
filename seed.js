const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create test users
  const hashedPassword = await bcrypt.hash('password123', 10);

  // Admin user
  const admin = await prisma.user.create({
    data: {
      email: 'admin@test.com',
      password: hashedPassword,
      name: 'Test Admin',
      phone: '+1234567890',
      role: 'ADMIN',
      isVerified: true,
      emailVerified: true
    }
  });

  // Customer user
  const customer = await prisma.user.create({
    data: {
      email: 'customer@test.com',
      password: hashedPassword,
      name: 'Test Customer',
      phone: '+1234567891',
      role: 'CUSTOMER',
      isVerified: true,
      emailVerified: true
    }
  });

  // Seller user
  const seller = await prisma.user.create({
    data: {
      email: 'seller@test.com',
      password: hashedPassword,
      name: 'Test Seller',
      phone: '+1234567892',
      role: 'SELLER',
      isVerified: true,
      emailVerified: true
    }
  });

  // Create seller profile
  await prisma.sellerProfile.create({
    data: {
      userId: seller.id,
      contactPerson: 'John Seller',
      businessName: 'Test Business',
      storeName: 'Test Store',
      storeDescription: 'A test store for development',
      status: 'APPROVED',
      kycSubmitted: true,
      onboardingStep: 10
    }
  });

  // Create a test product
  const product = await prisma.product.create({
    data: {
      title: 'Test Product',
      description: 'A test product for development',
      price: 29.99,
      category: 'Electronics',
      stock: 100,
      images: ['https://via.placeholder.com/300x300'],
      sellerId: seller.id,
      sellerName: seller.name,
      status: 'ACTIVE'
    }
  });

  // Create a cart for customer
  const cart = await prisma.cart.create({
    data: {
      userId: customer.id,
      items: {
        create: {
          productId: product.id,
          quantity: 2
        }
      }
    }
  });

  console.log('✅ Database seeded successfully!');
  console.log('📧 Test Users Created:');
  console.log('- Admin: admin@test.com / password123');
  console.log('- Customer: customer@test.com / password123');
  console.log('- Seller: seller@test.com / password123');
  console.log(`🛍️ Test Product: ${product.title} (ID: ${product.id})`);
  console.log(`🛒 Cart created for customer with ${cart.items ? 'items' : '2 items'}`);
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });