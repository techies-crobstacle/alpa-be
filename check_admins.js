const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const users = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN' } });
  console.log("SUPER_ADMINS:", users);
  
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
  console.log("ADMINS:", admins);
  
  await prisma.$disconnect();
}

run().catch(console.error);
