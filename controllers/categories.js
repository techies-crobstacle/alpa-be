const prisma = require("../config/prisma");
const { randomUUID } = require("crypto");

// ==================== GET ALL CATEGORIES ====================

// GET ALL CATEGORIES (Shows approved categories + pending requests for admin)
exports.getAllCategories = async (request, reply) => {
  try {
    const isAdmin = request.user.role === 'ADMIN';

    const products = await prisma.product.findMany({
      select: { category: true, sellerId: true }
    });

    // Group categories from products
    const categoryMap = new Map();
    const sellerCategoryMap = new Map(); // For seller-specific counts

    products.forEach(product => {
      const trimmedCategory = product.category?.trim();
      if (trimmedCategory) {
        // Total product count per category
        if (categoryMap.has(trimmedCategory)) {
          categoryMap.set(trimmedCategory, categoryMap.get(trimmedCategory) + 1);
        } else {
          categoryMap.set(trimmedCategory, 1);
        }

        // Seller-specific product count
        if (!isAdmin && product.sellerId === request.user?.userId) {
          const key = trimmedCategory;
          if (sellerCategoryMap.has(key)) {
            sellerCategoryMap.set(key, sellerCategoryMap.get(key) + 1);
          } else {
            sellerCategoryMap.set(key, 1);
          }
        }
      }
    });

    // Get approved categories from category_requests table
    let approvedCategoryRequests = [];
    try {
      approvedCategoryRequests = await prisma.$queryRaw`
        SELECT "id", "categoryName", "description", "sampleProduct", 
               "requestedBy", "approvalMessage", "approvedAt"
        FROM "category_requests"
        WHERE "status" = 'APPROVED'
      `;
    } catch (error) {
      console.warn('Could not fetch approved categories from requests:', error.message);
    }

    // Merge categories from products and approved requests
    approvedCategoryRequests.forEach(cat => {
      if (!categoryMap.has(cat.categoryName)) {
        categoryMap.set(cat.categoryName, { 
          productCount: 0, 
          requestedBy: cat.requestedBy,
          approvalMessage: cat.approvalMessage,
          approvedAt: cat.approvedAt,
          isRequestedCategory: true
        });
      } else {
        // Mark if this category was also requested by someone
        const existing = categoryMap.get(cat.categoryName);
        if (typeof existing === 'number') {
          categoryMap.set(cat.categoryName, {
            productCount: existing,
            requestedBy: cat.requestedBy,
            isRequestedCategory: true
          });
        }
      }
    });

    const approvedCategories = Array.from(categoryMap.entries())
      .map(([name, data]) => {
        if (typeof data === 'number') {
          return {
            categoryName: name,
            ...(isAdmin && { totalProductCount: data }),
            ...(!isAdmin && { myProductCount: sellerCategoryMap.get(name) || 0 })
          };
        } else {
          return {
            categoryName: name,
            ...(isAdmin && { totalProductCount: data.productCount || 0 }),
            ...(!isAdmin && { myProductCount: sellerCategoryMap.get(name) || 0 }),
            isRequestedCategory: data.isRequestedCategory || false,
            requestedByMe: !isAdmin && data.requestedBy === request.user?.userId,
            ...(isAdmin && data.approvalMessage && { approvalMessage: data.approvalMessage }),
            ...(isAdmin && data.approvedAt && { approvedAt: data.approvedAt })
          };
        }
      })
      .sort((a, b) => {
        if (isAdmin) {
          return (b.totalProductCount || 0) - (a.totalProductCount || 0);
        }
        // Sellers: show their requested categories first
        if (a.requestedByMe && !b.requestedByMe) return -1;
        if (!a.requestedByMe && b.requestedByMe) return 1;
        return a.categoryName.localeCompare(b.categoryName);
      });

    // Get pending requests if admin and table exists
    let pendingRequests = [];
    let rejectedRequests = [];
    let myPendingRequests = [];
    let myRejectedRequests = [];
    
    try {
      if (isAdmin) {
        pendingRequests = await prisma.$queryRaw`
          SELECT cr."id", cr."categoryName", cr."description", cr."sampleProduct", 
                 cr."requestedAt", cr."requestedBy",
                 u."id" as seller_id, u."email", u."name" as seller_name,
                 sp."storeName", sp."businessName", sp."status" as seller_status
          FROM "category_requests" cr
          LEFT JOIN "users" u ON cr."requestedBy" = u."id"
          LEFT JOIN "seller_profiles" sp ON u."id" = sp."userId"
          WHERE cr."status" = 'PENDING'
          ORDER BY cr."requestedAt" DESC
        `;

        rejectedRequests = await prisma.$queryRaw`
          SELECT cr."id", cr."categoryName", cr."rejectionMessage", 
                 cr."rejectedAt", cr."rejectedBy",
                 u."id" as seller_id, u."email", u."name" as seller_name,
                 sp."storeName", sp."businessName"
          FROM "category_requests" cr
          LEFT JOIN "users" u ON cr."requestedBy" = u."id"
          LEFT JOIN "seller_profiles" sp ON u."id" = sp."userId"
          WHERE cr."status" = 'REJECTED'
          ORDER BY cr."rejectedAt" DESC
        `;
      } else {
        // Sellers see their own pending requests
        myPendingRequests = await prisma.$queryRaw`
          SELECT "id", "categoryName", "description", "sampleProduct", 
                 "requestedAt", "status"
          FROM "category_requests" 
          WHERE "requestedBy" = ${request.user?.userId}
          AND "status" = 'PENDING'
          ORDER BY "requestedAt" DESC
        `;

        // Sellers see their own rejected requests with rejection message
        myRejectedRequests = await prisma.$queryRaw`
          SELECT "id", "categoryName", "rejectionMessage", 
                 "rejectedAt", "status"
          FROM "category_requests" 
          WHERE "requestedBy" = ${request.user?.userId}
          AND "status" = 'REJECTED'
          ORDER BY "rejectedAt" DESC
        `;
      }
    } catch (tableError) {
      console.warn('CategoryRequest table not yet created:', tableError.message);
      // Continue without pending requests if table doesn't exist
    }

    const totalProducts = await prisma.product.count();
    const totalCategories = approvedCategories.length;
    
    // For sellers, calculate their total products
    let myTotalProducts = 0;
    if (!isAdmin) {
      myTotalProducts = products.filter(p => p.sellerId === request.user?.userId).length;
    }

    // Response based on role
    if (isAdmin) {
      reply.send({
        success: true,
        data: {
          approvedCategories,
          totalApproved: approvedCategories.length,
          totalProducts,
          totalCategories,
          pendingRequests,
          rejectedRequests,
          totalPending: pendingRequests.length,
          totalRejected: rejectedRequests.length
        }
      });
    } else {
      // Seller view - approved categories + their own requests (pending & rejected)
      reply.send({
        success: true,
        data: {
          approvedCategories,
          totalCategories,
          myTotalProducts,
          myPendingRequests,
          totalMyPending: myPendingRequests.length,
          myRejectedRequests: myRejectedRequests.map(req => ({
            id: req.id,
            categoryName: req.categoryName,
            rejectionMessage: req.rejectionMessage,
            rejectedAt: req.rejectedAt,
            status: req.status
          })),
          totalMyRejected: myRejectedRequests.length
        }
      });
    }
  } catch (error) {
    console.error('Get all categories error:', error);
    reply.status(500).send({ success: false, error: error.message });
  }
};

// ==================== CREATE CATEGORIES DIRECTLY (Admin Only) ====================

// CREATE CATEGORY DIRECTLY - Admin can create multiple categories at once
exports.createCategoryDirect = async (request, reply) => {
  try {
    const { categories } = request.body; // Array of category names

    // Validate input
    if (!categories || !Array.isArray(categories) || categories.length === 0) {
      return reply.status(400).send({
        success: false,
        message: 'Please provide an array of category names'
      });
    }

    // Validate each category name
    const invalidCategories = categories.filter(cat => !cat || typeof cat !== 'string' || cat.trim() === '');
    if (invalidCategories.length > 0) {
      return reply.status(400).send({
        success: false,
        message: 'All category names must be non-empty strings'
      });
    }

    // Trim and check for duplicates in the request
    const trimmedCategories = [...new Set(categories.map(c => c.trim()))];

    // Check which categories already exist in the product table
    const existingProducts = await prisma.product.findMany({
      select: { category: true },
      distinct: ['category']
    });

    const existingCategories = existingProducts
      .map(p => p.category?.trim())
      .filter(c => c);

    // Check which categories already exist in category_requests
    let existingRequests = [];
    try {
      existingRequests = await prisma.$queryRaw`
        SELECT "categoryName" FROM "category_requests" 
        WHERE "status" IN ('APPROVED', 'PENDING')
      `;
    } catch (error) {
      console.warn('Could not fetch existing requests:', error.message);
    }

    const existingRequestNames = existingRequests.map(r => r.categoryName?.trim());

    // Filter out categories that already exist
    const newCategories = trimmedCategories.filter(
      cat => !existingCategories.includes(cat) && !existingRequestNames.includes(cat)
    );

    if (newCategories.length === 0) {
      return reply.status(400).send({
        success: false,
        message: 'All provided categories already exist'
      });
    }

    // Insert new categories as APPROVED directly
    const createdCategories = [];
    for (const categoryName of newCategories) {
      try {
        await prisma.$executeRaw`
          INSERT INTO "category_requests" (
            "id", "categoryName", "description", "sampleProduct", 
            "requestedBy", "status", "approvedBy", "approvedAt", "requestedAt", "updatedAt"
          ) VALUES (
            ${randomUUID()}, ${categoryName}, NULL, NULL,
            NULL, 'APPROVED', ${request.user?.userId}, NOW(), NOW(), NOW()
          )
        `;
        createdCategories.push({
          categoryName,
          status: 'APPROVED',
          createdBy: request.user?.userId,
          createdAt: new Date()
        });
      } catch (error) {
        console.error(`Error creating category ${categoryName}:`, error.message);
      }
    }

    reply.status(201).send({
      success: true,
      message: `${createdCategories.length} categor${createdCategories.length === 1 ? 'y' : 'ies'} created successfully`,
      data: {
        created: createdCategories,
        totalCreated: createdCategories.length,
        skipped: trimmedCategories.length - createdCategories.length,
        skippedCategories: trimmedCategories.filter(cat => !newCategories.includes(cat))
      }
    });
  } catch (error) {
    console.error('Create category error:', error);
    reply.status(500).send({ success: false, error: error.message });
  }
};

// ==================== REQUEST A NEW CATEGORY ====================

// REQUEST A NEW CATEGORY (Seller/Admin can request)
exports.requestCategory = async (request, reply) => {
  try {
    const { categoryName, description, sampleProduct } = request.body;

    // Validate input
    if (!categoryName || categoryName.trim() === '') {
      return reply.status(400).send({
        success: false,
        message: 'Category name is required'
      });
    }

    // Check if category already exists using raw query
    const existingCategory = await prisma.$queryRaw`
      SELECT id FROM "category_requests" 
      WHERE LOWER("categoryName") = LOWER(${categoryName.trim()})
      AND "status" IN ('APPROVED', 'PENDING')
      LIMIT 1
    `;

    if (existingCategory && existingCategory.length > 0) {
      return reply.status(400).send({
        success: false,
        message: `Category "${categoryName}" already exists or is pending approval`
      });
    }

    // Create category request using raw query
    const result = await prisma.$executeRaw`
      INSERT INTO "category_requests" (
        "id", "categoryName", "description", "sampleProduct", 
        "requestedBy", "status", "requestedAt", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${categoryName.trim()}, 
        ${description || null}, ${sampleProduct || null},
        ${request.user?.userId || null}, 'PENDING',
        NOW(), NOW()
      )
    `;

    reply.status(201).send({
      success: true,
      message: 'Category request submitted successfully',
      data: {
        categoryName: categoryName.trim(),
        description: description || null,
        sampleProduct: sampleProduct || null,
        status: 'PENDING'
      }
    });
  } catch (error) {
    console.error('Request category error:', error);
    reply.status(500).send({ success: false, error: error.message });
  }
};

// ==================== APPROVE CATEGORY REQUEST ====================

// APPROVE CATEGORY REQUEST (Admin only)
exports.approveCategory = async (request, reply) => {
  try {
    const { id } = request.params;
    const { approvalMessage } = request.body;

    // Check if category request exists 
    const categoryRequest = await prisma.$queryRaw`
      SELECT * FROM "category_requests" WHERE "id" = ${id}
    `;

    if (!categoryRequest || categoryRequest.length === 0) {
      return reply.status(404).send({
        success: false,
        message: 'Category request not found'
      });
    }

    const category = categoryRequest[0];
    if (category.status !== 'PENDING') {
      return reply.status(400).send({
        success: false,
        message: `Cannot approve a ${category.status.toLowerCase()} request`
      });
    }

    // Update category request to approved
    await prisma.$executeRaw`
      UPDATE "category_requests" 
      SET "status" = 'APPROVED',
          "approvedBy" = ${request.user?.userId},
          "approvalMessage" = ${approvalMessage || null},
          "approvedAt" = NOW(),
          "updatedAt" = NOW()
      WHERE "id" = ${id}
    `;

    reply.send({
      success: true,
      message: 'Category approved successfully',
      data: {
        id,
        categoryName: category.categoryName,
        status: 'APPROVED',
        approvalMessage: approvalMessage || null
      }
    });
  } catch (error) {
    console.error('Approve category error:', error);
    reply.status(500).send({ success: false, error: error.message });
  }
};

// ==================== REJECT CATEGORY REQUEST ====================

// REJECT CATEGORY REQUEST (Admin only)
exports.rejectCategory = async (request, reply) => {
  try {
    const { id } = request.params;
    const { rejectionMessage } = request.body;

    // Validate rejection message
    if (!rejectionMessage || rejectionMessage.trim() === '') {
      return reply.status(400).send({
        success: false,
        message: 'Rejection message is required'
      });
    }

    // Check if category request exists
    const categoryRequest = await prisma.$queryRaw`
      SELECT * FROM "category_requests" WHERE "id" = ${id}
    `;

    if (!categoryRequest || categoryRequest.length === 0) {
      return reply.status(404).send({
        success: false,
        message: 'Category request not found'
      });
    }

    const category = categoryRequest[0];
    if (category.status !== 'PENDING') {
      return reply.status(400).send({
        success: false,
        message: `Cannot reject a ${category.status.toLowerCase()} request`
      });
    }

    // Update category request to rejected
    await prisma.$executeRaw`
      UPDATE "category_requests" 
      SET "status" = 'REJECTED',
          "rejectedBy" = ${request.user?.userId},
          "rejectionMessage" = ${rejectionMessage.trim()},
          "rejectedAt" = NOW(),
          "updatedAt" = NOW()
      WHERE "id" = ${id}
    `;

    reply.send({
      success: true,
      message: 'Category request rejected successfully',
      data: {
        id,
        categoryName: category.categoryName,
        status: 'REJECTED',
        rejectionMessage: rejectionMessage.trim()
      }
    });
  } catch (error) {
    console.error('Reject category error:', error);
    reply.status(500).send({ success: false, error: error.message });
  }
};
