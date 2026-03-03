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
