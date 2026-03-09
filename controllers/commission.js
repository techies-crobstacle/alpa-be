const prisma = require("../config/prisma");
const cuid = require("cuid");

// ─── Helper: fetch commission by id ─────────────────────────────────────────
const findCommissionById = async (id) => {
  const rows = await prisma.$queryRaw`
    SELECT id, title, type::text AS type, value, description,
           "isDefault", "isActive", "createdAt", "updatedAt"
    FROM commissions WHERE id = ${id}
  `;
  return rows[0] || null;
};

// ─── CREATE ──────────────────────────────────────────────────────────────────
// POST /api/admin/commissions
exports.createCommission = async (request, reply) => {
  try {
    const { title, type, value, description, isDefault = false, isActive = true } = request.body || {};

    if (!title || !type || value === undefined || value === null) {
      return reply.status(400).send({ success: false, message: "title, type, and value are required" });
    }

    const upperType = String(type).toUpperCase();
    if (!["FIXED", "PERCENTAGE"].includes(upperType)) {
      return reply.status(400).send({ success: false, message: "type must be FIXED or PERCENTAGE" });
    }

    const numericValue = parseFloat(value);
    if (isNaN(numericValue) || numericValue < 0) {
      return reply.status(400).send({ success: false, message: "value must be a positive number" });
    }
    if (upperType === "PERCENTAGE" && numericValue > 100) {
      return reply.status(400).send({ success: false, message: "Percentage value cannot exceed 100" });
    }

    const id = cuid();
    const now = new Date();

    // If this should be default, unset any existing default first
    if (isDefault) {
      await prisma.$executeRaw`UPDATE commissions SET "isDefault" = false WHERE "isDefault" = true`;
    }

    await prisma.$executeRaw`
      INSERT INTO commissions (id, title, type, value, description, "isDefault", "isActive", "createdAt", "updatedAt")
      VALUES (
        ${id},
        ${title},
        ${upperType}::"CommissionType",
        ${numericValue},
        ${description || null},
        ${Boolean(isDefault)},
        ${Boolean(isActive)},
        ${now},
        ${now}
      )
    `;

    const commission = await findCommissionById(id);

    return reply.status(201).send({
      success: true,
      message: "Commission created successfully",
      commission
    });
  } catch (err) {
    console.error("Create commission error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// ─── GET ALL ─────────────────────────────────────────────────────────────────
// GET /api/admin/commissions
exports.getAllCommissions = async (request, reply) => {
  try {
    const { includeInactive } = request.query || {};

    let commissions;
    if (includeInactive === "true") {
      commissions = await prisma.$queryRaw`
        SELECT c.id, c.title, c.type::text AS type, c.value, c.description,
               c."isDefault", c."isActive", c."createdAt", c."updatedAt",
               COUNT(sp.id)::int AS "sellerCount"
        FROM commissions c
        LEFT JOIN seller_profiles sp ON sp.commission_id = c.id
        GROUP BY c.id
        ORDER BY c."isDefault" DESC, c."createdAt" DESC
      `;
    } else {
      commissions = await prisma.$queryRaw`
        SELECT c.id, c.title, c.type::text AS type, c.value, c.description,
               c."isDefault", c."isActive", c."createdAt", c."updatedAt",
               COUNT(sp.id)::int AS "sellerCount"
        FROM commissions c
        LEFT JOIN seller_profiles sp ON sp.commission_id = c.id
        WHERE c."isActive" = true
        GROUP BY c.id
        ORDER BY c."isDefault" DESC, c."createdAt" DESC
      `;
    }

    return reply.send({
      success: true,
      commissions,
      count: commissions.length
    });
  } catch (err) {
    console.error("Get all commissions error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// ─── GET ONE ─────────────────────────────────────────────────────────────────
// GET /api/admin/commissions/:id
exports.getCommissionById = async (request, reply) => {
  try {
    const { id } = request.params;

    const commission = await findCommissionById(id);
    if (!commission) {
      return reply.status(404).send({ success: false, message: "Commission not found" });
    }

    // Count how many sellers use it
    const countRows = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS count FROM seller_profiles WHERE commission_id = ${id}
    `;

    return reply.send({
      success: true,
      commission: { ...commission, sellerCount: countRows[0]?.count || 0 }
    });
  } catch (err) {
    console.error("Get commission error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────
// PUT /api/admin/commissions/:id
exports.updateCommission = async (request, reply) => {
  try {
    const { id } = request.params;
    const { title, type, value, description, isDefault, isActive } = request.body || {};

    const existing = await findCommissionById(id);
    if (!existing) {
      return reply.status(404).send({ success: false, message: "Commission not found" });
    }

    // Validate type if changing
    let upperType = existing.type;
    if (type !== undefined) {
      upperType = String(type).toUpperCase();
      if (!["FIXED", "PERCENTAGE"].includes(upperType)) {
        return reply.status(400).send({ success: false, message: "type must be FIXED or PERCENTAGE" });
      }
    }

    // Validate value if changing
    let numericValue = parseFloat(existing.value);
    if (value !== undefined) {
      numericValue = parseFloat(value);
      if (isNaN(numericValue) || numericValue < 0) {
        return reply.status(400).send({ success: false, message: "value must be a positive number" });
      }
      if (upperType === "PERCENTAGE" && numericValue > 100) {
        return reply.status(400).send({ success: false, message: "Percentage value cannot exceed 100" });
      }
    }

    // If setting as default, unset others first
    if (isDefault === true) {
      await prisma.$executeRaw`UPDATE commissions SET "isDefault" = false WHERE "isDefault" = true AND id != ${id}`;
    }

    const finalTitle       = title       !== undefined ? title       : existing.title;
    const finalDescription = description !== undefined ? description : existing.description;
    const finalIsDefault   = isDefault   !== undefined ? Boolean(isDefault) : existing.isDefault;
    const finalIsActive    = isActive    !== undefined ? Boolean(isActive)  : existing.isActive;
    const now              = new Date();

    await prisma.$executeRaw`
      UPDATE commissions
      SET title = ${finalTitle},
          type  = ${upperType}::"CommissionType",
          value = ${numericValue},
          description = ${finalDescription},
          "isDefault" = ${finalIsDefault},
          "isActive"  = ${finalIsActive},
          "updatedAt" = ${now}
      WHERE id = ${id}
    `;

    const updated = await findCommissionById(id);

    return reply.send({
      success: true,
      message: "Commission updated successfully",
      commission: updated
    });
  } catch (err) {
    console.error("Update commission error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// ─── SET DEFAULT ─────────────────────────────────────────────────────────────
// PUT /api/admin/commissions/:id/set-default
exports.setDefaultCommission = async (request, reply) => {
  try {
    const { id } = request.params;

    const existing = await findCommissionById(id);
    if (!existing) {
      return reply.status(404).send({ success: false, message: "Commission not found" });
    }

    await prisma.$executeRaw`UPDATE commissions SET "isDefault" = false`;
    await prisma.$executeRaw`UPDATE commissions SET "isDefault" = true WHERE id = ${id}`;

    return reply.send({ success: true, message: `"${existing.title}" is now the default commission` });
  } catch (err) {
    console.error("Set default commission error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// ─── ASSIGN TO SELLER ────────────────────────────────────────────────────────
// PUT /api/admin/sellers/:sellerId/commission
exports.assignCommissionToSeller = async (request, reply) => {
  try {
    const { sellerId } = request.params;
    const { commissionId } = request.body || {};

    if (!commissionId) {
      return reply.status(400).send({ success: false, message: "commissionId is required" });
    }

    const commission = await findCommissionById(commissionId);
    if (!commission) {
      return reply.status(404).send({ success: false, message: "Commission not found" });
    }

    const sellerRows = await prisma.$queryRaw`
      SELECT id FROM seller_profiles WHERE "userId" = ${sellerId}
    `;
    if (!sellerRows.length) {
      return reply.status(404).send({ success: false, message: "Seller not found" });
    }

    await prisma.$executeRaw`
      UPDATE seller_profiles SET commission_id = ${commissionId} WHERE "userId" = ${sellerId}
    `;

    return reply.send({
      success: true,
      message: `Commission "${commission.title}" assigned to seller`,
      commission
    });
  } catch (err) {
    console.error("Assign commission error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// ─── DELETE ──────────────────────────────────────────────────────────────────
// DELETE /api/admin/commissions/:id
exports.deleteCommission = async (request, reply) => {
  try {
    const { id } = request.params;

    const existing = await findCommissionById(id);
    if (!existing) {
      return reply.status(404).send({ success: false, message: "Commission not found" });
    }

    // Unlink all sellers using this commission
    await prisma.$executeRaw`UPDATE seller_profiles SET commission_id = NULL WHERE commission_id = ${id}`;

    await prisma.$executeRaw`DELETE FROM commissions WHERE id = ${id}`;

    return reply.send({ success: true, message: "Commission deleted" });
  } catch (err) {
    console.error("Delete commission error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// ─── HELPER for other controllers ────────────────────────────────────────────
// Fetch the current default commission (used during seller registration)
exports.getDefaultCommission = async () => {
  const rows = await prisma.$queryRaw`
    SELECT id, title, type::text AS type, value, description,
           "isDefault", "isActive"
    FROM commissions
    WHERE "isDefault" = true AND "isActive" = true
    LIMIT 1
  `;
  return rows[0] || null;
};

// Fetch commission for a seller profile row
exports.getCommissionForSeller = async (sellerId) => {
  const rows = await prisma.$queryRaw`
    SELECT c.id, c.title, c.type::text AS type, c.value, c.description, c."isDefault", c."isActive"
    FROM commissions c
    JOIN seller_profiles sp ON sp.commission_id = c.id
    WHERE sp."userId" = ${sellerId}
    LIMIT 1
  `;
  return rows[0] || null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMMISSION EARNED — tracks 10 % platform fee recorded on every order
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_COMMISSION_RATE = 10; // % fallback when seller has no commission assigned

/**
 * Internal helper — called by ordersController after every successful order.
 * Creates one CommissionEarned row per seller that appears in the order.
 *
 * @param {Object} params
 * @param {string}  params.orderId
 * @param {string}  params.sellerId
 * @param {number}  params.orderValue  – seller's slice of the order (sum of their items)
 * @param {string}  params.customerName
 * @param {string}  params.customerEmail
 * @param {string|null} params.customerId  – null for guest orders
 * @param {string|null} params.sellerName
 */
exports.createCommissionEarned = async ({
  orderId,
  sellerId,
  orderValue,
  customerName,
  customerEmail,
  customerId = null,
  sellerName = null
}) => {
  try {
    // Always use the platform default commission ("Standard Commission" document).
    // Fall back to hardcoded 10 % only if no default is configured.
    const defaultCommission = await exports.getDefaultCommission();

    let commissionRate = DEFAULT_COMMISSION_RATE;
    let commissionAmount = parseFloat(((orderValue * DEFAULT_COMMISSION_RATE) / 100).toFixed(2));

    if (defaultCommission) {
      const rateValue = parseFloat(defaultCommission.value);
      if (defaultCommission.type === "PERCENTAGE") {
        commissionRate = rateValue;
        commissionAmount = parseFloat(((orderValue * rateValue) / 100).toFixed(2));
      } else {
        // FIXED — flat fee regardless of order size
        commissionRate = rateValue;
        commissionAmount = parseFloat(rateValue.toFixed(2));
      }
    }

    const netPayable = parseFloat((orderValue - commissionAmount).toFixed(2));

    await prisma.$executeRaw`
      INSERT INTO commission_earned
        (id, order_id, seller_id, customer_id, customer_name, customer_email,
         seller_name, order_value, commission_rate, commission_amount, net_payable,
         status, created_at, updated_at)
      VALUES (
        ${require("cuid")()},
        ${orderId},
        ${sellerId},
        ${customerId},
        ${customerName},
        ${customerEmail},
        ${sellerName},
        ${parseFloat(orderValue.toFixed(2))},
        ${commissionRate},
        ${commissionAmount},
        ${netPayable},
        'PENDING'::"CommissionStatus",
        NOW(), NOW()
      )
    `;

    console.log(`💰 Commission recorded — order: ${orderId}, seller: ${sellerId}, orderValue: $${orderValue.toFixed(2)}, commission: $${commissionAmount}, netPayable: $${netPayable}`);
  } catch (err) {
    // Non-fatal — log but never crash the order flow
    console.error("createCommissionEarned error (non-fatal):", err.message);
  }
};

// ─── ADMIN: list all commission earned records ────────────────────────────────
// GET /api/admin/commissions/earned
exports.getAllCommissionEarned = async (request, reply) => {
  try {
    const {
      sellerId,
      status,
      from,
      to,
      page = "1",
      limit = "20"
    } = request.query || {};

    const pageNum  = Math.max(1, parseInt(page, 10)  || 1);
    const limitNum = Math.min(100, parseInt(limit, 10) || 20);
    const offset   = (pageNum - 1) * limitNum;

    // Build WHERE clauses
    const conditions = [];
    if (sellerId) conditions.push(`ce.seller_id = '${sellerId.replace(/'/g, "''")}'`);
    if (status)   conditions.push(`ce.status::text = '${status.toUpperCase().replace(/'/g, "''")}'`);
    if (from)     conditions.push(`ce.created_at >= '${from.replace(/'/g, "''")}'::timestamptz`);
    if (to)       conditions.push(`ce.created_at <= '${to.replace(/'/g, "''")}'::timestamptz`);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        ce.id,
        ce.order_id       AS "orderId",
        ce.seller_id      AS "sellerId",
        ce.customer_id    AS "customerId",
        ce.customer_name  AS "customerName",
        ce.customer_email AS "customerEmail",
        ce.seller_name    AS "sellerName",
        ce.order_value        AS "orderValue",
        ce.commission_rate    AS "commissionRate",
        ce.commission_amount  AS "commissionAmount",
        ce.net_payable        AS "netPayable",
        ce.status::text   AS status,
        ce.created_at     AS "createdAt",
        ce.updated_at     AS "updatedAt",
        u.name            AS "sellerFullName",
        sp."storeName"    AS "storeName",
        sp."businessName" AS "businessName"
      FROM commission_earned ce
      LEFT JOIN users u          ON u.id = ce.seller_id
      LEFT JOIN seller_profiles sp ON sp."userId" = ce.seller_id
      ${whereClause}
      ORDER BY ce.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `);

    const countRows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS total FROM commission_earned ce ${whereClause}
    `);
    const total = countRows[0]?.total || 0;

    return reply.send({
      success: true,
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    console.error("getAllCommissionEarned error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// ─── ADMIN: summary stats ─────────────────────────────────────────────────────
// GET /api/admin/commissions/earned/summary
exports.getCommissionEarnedSummary = async (request, reply) => {
  try {
    const { from, to } = request.query || {};

    const conditions = [];
    if (from) conditions.push(`created_at >= '${from.replace(/'/g, "''")}'::timestamptz`);
    if (to)   conditions.push(`created_at <= '${to.replace(/'/g, "''")}'::timestamptz`);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int                                    AS "totalOrders",
        COALESCE(SUM(order_value), 0)::float             AS "totalOrderValue",
        COALESCE(SUM(commission_amount), 0)::float       AS "totalCommissionEarned",
        COALESCE(SUM(net_payable), 0)::float             AS "totalNetPayable",
        COALESCE(SUM(CASE WHEN status = 'PAID'      THEN commission_amount ELSE 0 END), 0)::float AS "totalPaid",
        COALESCE(SUM(CASE WHEN status = 'PENDING'   THEN commission_amount ELSE 0 END), 0)::float AS "totalPending",
        COALESCE(SUM(CASE WHEN status = 'CANCELLED' THEN commission_amount ELSE 0 END), 0)::float AS "totalCancelled",
        COUNT(DISTINCT seller_id)::int                   AS "uniqueSellers"
      FROM commission_earned
      ${whereClause}
    `);

    return reply.send({ success: true, summary: rows[0] });
  } catch (err) {
    console.error("getCommissionEarnedSummary error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// ─── ADMIN: commission earned for a specific order ────────────────────────────
// GET /api/admin/commissions/earned/order/:orderId
exports.getCommissionEarnedByOrder = async (request, reply) => {
  try {
    const { orderId } = request.params;

    const rows = await prisma.$queryRaw`
      SELECT
        ce.id,
        ce.order_id       AS "orderId",
        ce.seller_id      AS "sellerId",
        ce.customer_id    AS "customerId",
        ce.customer_name  AS "customerName",
        ce.customer_email AS "customerEmail",
        ce.seller_name    AS "sellerName",
        ce.order_value        AS "orderValue",
        ce.commission_rate    AS "commissionRate",
        ce.commission_amount  AS "commissionAmount",
        ce.net_payable        AS "netPayable",
        ce.status::text   AS status,
        ce.created_at     AS "createdAt",
        ce.updated_at     AS "updatedAt"
      FROM commission_earned ce
      WHERE ce.order_id = ${orderId}
      ORDER BY ce.created_at ASC
    `;

    return reply.send({ success: true, data: rows });
  } catch (err) {
    console.error("getCommissionEarnedByOrder error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// ─── ADMIN: update status (PENDING → PAID / CANCELLED) ───────────────────────
// PUT /api/admin/commissions/earned/:id/status
exports.updateCommissionEarnedStatus = async (request, reply) => {
  try {
    const { id } = request.params;
    const { status } = request.body || {};

    const VALID = ["PENDING", "PAID", "CANCELLED"];
    if (!status || !VALID.includes(status.toUpperCase())) {
      return reply.status(400).send({ success: false, message: `status must be one of: ${VALID.join(", ")}` });
    }

    const rows = await prisma.$queryRaw`SELECT id FROM commission_earned WHERE id = ${id}`;
    if (!rows.length) {
      return reply.status(404).send({ success: false, message: "Commission earned record not found" });
    }

    const upperStatus = status.toUpperCase();
    await prisma.$executeRaw`
      UPDATE commission_earned
      SET status = ${upperStatus}::"CommissionStatus", updated_at = NOW()
      WHERE id = ${id}
    `;

    return reply.send({ success: true, message: `Status updated to ${upperStatus}` });
  } catch (err) {
    console.error("updateCommissionEarnedStatus error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// ─── SELLER: view my commission earned ───────────────────────────────────────
// GET /api/commissions/earned/my   (authenticated seller)
exports.getMyCommissionEarned = async (request, reply) => {
  try {
    const sellerId = request.user.userId;
    const { status, from, to, page = "1", limit = "20" } = request.query || {};

    const pageNum  = Math.max(1, parseInt(page, 10)  || 1);
    const limitNum = Math.min(100, parseInt(limit, 10) || 20);
    const offset   = (pageNum - 1) * limitNum;

    const conditions = [`ce.seller_id = '${sellerId.replace(/'/g, "''")}'`];
    if (status) conditions.push(`ce.status::text = '${status.toUpperCase().replace(/'/g, "''")}'`);
    if (from)   conditions.push(`ce.created_at >= '${from.replace(/'/g, "''")}'::timestamptz`);
    if (to)     conditions.push(`ce.created_at <= '${to.replace(/'/g, "''")}'::timestamptz`);

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        ce.id,
        ce.order_id           AS "orderId",
        ce.customer_name      AS "customerName",
        ce.order_value        AS "orderValue",
        ce.commission_rate    AS "commissionRate",
        ce.commission_amount  AS "commissionAmount",
        ce.net_payable        AS "netPayable",
        ce.status::text       AS status,
        ce.created_at         AS "createdAt"
      FROM commission_earned ce
      ${whereClause}
      ORDER BY ce.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `);

    const countRows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS total FROM commission_earned ce ${whereClause}
    `);

    // Aggregate totals for the seller
    const totalsRows = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(order_value), 0)::float             AS "totalOrderValue",
        COALESCE(SUM(commission_amount), 0)::float       AS "totalCommissionDeducted",
        COALESCE(SUM(net_payable), 0)::float             AS "totalNetPayable",
        COALESCE(SUM(CASE WHEN status = 'PAID'    THEN net_payable ELSE 0 END), 0)::float AS "totalPaid",
        COALESCE(SUM(CASE WHEN status = 'PENDING' THEN net_payable ELSE 0 END), 0)::float AS "totalPending"
      FROM commission_earned
      WHERE seller_id = '${sellerId.replace(/'/g, "''")}'
    `);

    return reply.send({
      success: true,
      data: rows,
      totals: totalsRows[0],
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countRows[0]?.total || 0,
        totalPages: Math.ceil((countRows[0]?.total || 0) / limitNum)
      }
    });
  } catch (err) {
    console.error("getMyCommissionEarned error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};
