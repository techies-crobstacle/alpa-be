const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' 
    ? ['query', 'error', 'warn'] 
    : ['error'],
});

// Test connection
prisma.$connect()
  .then(() => console.log('✅ PostgreSQL connected via Prisma'))
  .catch((err) => console.error('❌ Prisma connection error:', err));

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

module.exports = prisma;
