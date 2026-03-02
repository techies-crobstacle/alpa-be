const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' 
    ? ['query', 'error', 'warn'] 
    : ['error'],
});

// ── Real-time stock broadcast middleware ─────────────────────────────────────
// Intercepts EVERY product.update / product.updateMany that touches `stock`,
// regardless of which controller triggered it (orders, cancellations, seller
// bulk-update, admin edits, etc.).
// Fires AFTER the DB write so the broadcast always carries the committed value.
prisma.$use(async (params, next) => {
  const result = await next(params);

  try {
    if (params.model === 'Product' && params.action === 'update') {
      const dataArg = params.args?.data;
      // Only broadcast when the update actually touches the stock field
      const stockTouched =
        dataArg !== undefined &&
        ('stock' in dataArg ||
          (typeof dataArg.stock === 'object' && dataArg.stock !== null));

      if (stockTouched && result) {
        // result is the full updated product record (all default scalar fields)
        const { broadcastStockUpdate } = require('../utils/stockSocket');
        const productId = result.id || params.args?.where?.id;
        const newStock  = result.stock  ?? 0;
        // isActive may be undefined if SELECT didn't include it — default to true unless stock is 0
        const isActive  = result.isActive !== undefined ? result.isActive : newStock > 0;
        if (productId) {
          broadcastStockUpdate(productId, newStock, isActive);
        }
      }
    }
  } catch (broadcastErr) {
    // Never let a broadcast failure crash a DB operation
    console.error('[prisma middleware] stock broadcast error:', broadcastErr.message);
  }

  return result;
});
// ─────────────────────────────────────────────────────────────────────────────

// Test connection
prisma.$connect()
  .then(() => console.log('✅ PostgreSQL connected via Prisma'))
  .catch((err) => console.error('❌ Prisma connection error:', err));

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

module.exports = prisma;
