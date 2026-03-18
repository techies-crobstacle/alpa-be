const prisma = require("../config/prisma");
const {
  notifySellerProductStatusChange,
  notifySellerLowStock,
  notifyAdminNewProduct,
  notifyAdminProductPending,
  notifyAdminLowStockDeactivation,
  notifyAdminProductSubmitReview,
  notifyAdminProductSellerDeactivated
} = require("./notification");
const {
  sendSellerLowStockEmail,
  sendAdminProductPendingEmail,
  sendAdminProductSellerDeactivatedEmail,
  sendAdminProductSubmitReviewEmail,
  sendSellerProductSelfDeactivatedEmail,
  sendSellerProductSubmitReviewConfirmEmail
} = require("../utils/emailService");
const auditLogger = require("../utils/auditLogger");
const { log: auditLog, extractRequestMeta, AUDIT_ACTIONS, ENTITY_TYPES } = auditLogger;

const LOW_STOCK_THRESHOLD = 2;

// ADD PRODUCT (Seller only)
exports.addProduct = async (request, reply) => {
  let { title, description, price, stock, category, featured, tags, artistName, "artist name": artistNameWithSpace } = request.body;
  
  // Handle both artistName and "artist name" field formats
  const finalArtistName = artistName || artistNameWithSpace || null;
  
  // Parse price and stock to correct types
  if (typeof price === 'string') price = parseFloat(price);
  if (typeof stock === 'string') stock = parseInt(stock);
  
  // Parse featured to boolean (default false if not provided)
  featured = featured === 'true' || featured === true ? true : false;
  
  // Parse tags - can be single string or array
  let parsedTags = [];
  if (tags) {
    if (Array.isArray(tags)) {
      parsedTags = tags.filter(tag => tag && tag.trim() !== '');
    } else if (typeof tags === 'string') {
      parsedTags = tags.split(',').map(tag => tag.trim()).filter(tag => tag !== '');
    }
  }
  
  let featuredImageUrl = null;
  let galleryImages = [];
  const { uploadToCloudinary } = require("../config/cloudinary");

  // If files were uploaded, upload them to Cloudinary
  if (request.files && request.files.length > 0) {
    for (const file of request.files) {
      try {
        const result = await uploadToCloudinary(file.path, 'products');
        if (file.fieldname === 'featuredImage') {
          featuredImageUrl = result.url; // Only one featured image
        } else if (file.fieldname === 'galleryImages') {
          galleryImages.push(result.url); // Gallery images field
        }
      } catch (err) {
        console.error('Cloudinary upload error:', err);
      }
    }
  } else {
    // Fallback: images provided as URLs in the body
    if (request.body.featuredImage) {
      featuredImageUrl = typeof request.body.featuredImage === 'string'
        ? request.body.featuredImage
        : request.body.featuredImage[0];
    }
    if (request.body.galleryImages) {
      if (Array.isArray(request.body.galleryImages)) {
        galleryImages = request.body.galleryImages.filter(img => img && img.trim() !== '');
      } else if (typeof request.body.galleryImages === 'string') {
        galleryImages = [request.body.galleryImages].filter(img => img && img.trim() !== '');
      }
    }
    // Backward compat: old 'images' field maps first to featuredImage, rest to gallery
    if (!featuredImageUrl && !galleryImages.length && request.body.images) {
      const imgs = Array.isArray(request.body.images) ? request.body.images : [request.body.images];
      featuredImageUrl = imgs[0] || null;
      galleryImages = imgs.slice(1);
    }
  }

  // Remove duplicates from gallery images
  galleryImages = [...new Set(galleryImages)];

  // Debug logging
  console.log('DEBUG - Add Product Images:', {
    featuredImage: featuredImageUrl,
    galleryImagesCount: galleryImages.length,
    galleryImages: galleryImages
  });

  try {
    const sellerId = request.user.userId; // From authenticateSeller middleware

    // Check if seller is approved and active
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: sellerId },
      include: { user: true }
    });
    
    if (!seller) {
      return reply.status(404).send({ success: false, message: "Seller account not found" });
    }

    if (seller.status !== "APPROVED" && seller.status !== "ACTIVE") {
      return reply.status(403).send({ 
        success: false, 
        message: "Your seller account must be approved before adding products. Current status: " + seller.status 
      });
    }

    // Determine product status based on user role (temporary - using status)
    const userRole = request.user.role; // From auth middleware
    let productStatus = "PENDING"; // Default for sellers - requires approval
    let isActive = false; // Will be set via raw SQL
    
    if (userRole === "ADMIN") {
      // Admin products go live immediately
      productStatus = "ACTIVE";
      isActive = true;
    } else {
      // Seller products always require approval
      productStatus = "PENDING";
      isActive = false;
    }

    const product = await prisma.product.create({
      data: {
        title,
        description,
        price,
        stock,
        category,
        sellerId,
        sellerName: seller.storeName || seller.businessName,
        artistName: finalArtistName, // Use the processed artist name
        images: galleryImages,
        status: productStatus,
        featured,
        tags: parsedTags
      }
    });

    // Set isActive and featuredImage using raw SQL until Prisma client is regenerated
    await prisma.$executeRaw`UPDATE "products" SET "isActive" = ${isActive} WHERE "id" = ${product.id}`;
    if (featuredImageUrl) {
      await prisma.$executeRaw`UPDATE "products" SET "featuredImage" = ${featuredImageUrl} WHERE "id" = ${product.id}`;
    }

    // ── Audit log: product created ────────────────────────────────────────────
    auditLog({
      entityType: ENTITY_TYPES.PRODUCT,
      entityId:   product.id,
      action:     AUDIT_ACTIONS.PRODUCT_CREATED,
      newData:    { ...product, isActive, featuredImage: featuredImageUrl },
      ...extractRequestMeta(request),
    });

    // Update seller product count
    await prisma.sellerProfile.update({
      where: { userId: sellerId },
      data: {
        productCount: { increment: 1 },
        minimumProductsUploaded: true
      }
    });

    // ── Low stock auto-deactivation (admin-added products only; sellers start as PENDING) ──
    if (isActive && stock <= LOW_STOCK_THRESHOLD) {
      await prisma.$executeRaw`UPDATE "products" SET "isActive" = false, status = 'INACTIVE' WHERE id = ${product.id}`;
      isActive = false;
      console.log(`⚠️  New product "${product.title}" auto-deactivated on add — stock: ${stock}`);

      // ── Audit log: auto-deactivated due to low stock ───────────────────────
      auditLog({
        entityType:   ENTITY_TYPES.PRODUCT,
        entityId:     product.id,
        action:       AUDIT_ACTIONS.PRODUCT_AUTO_DEACTIVATED_LOW_STOCK,
        previousData: { ...product, isActive: true },
        newData:      { ...product, isActive: false, status: 'INACTIVE' },
        reason:       `Stock (${stock}) at or below low-stock threshold (${LOW_STOCK_THRESHOLD})`,
        ...extractRequestMeta(request),
      });

      const sellerUser = await prisma.user.findUnique({
        where: { id: sellerId },
        select: { email: true, name: true }
      });

      notifySellerLowStock(sellerId, product.id, product.title, stock)
        .catch(err => console.error("Low stock notification error (addProduct):", err.message));

      notifyAdminLowStockDeactivation(product.id, {
        productTitle: product.title,
        sellerName:   seller.storeName || seller.businessName || 'Unknown',
        stock
      }).catch(err => console.error("Admin low stock deactivation notification error (addProduct):", err.message));

      if (sellerUser?.email) {
        sendSellerLowStockEmail(sellerUser.email, sellerUser.name || "Seller",
          product.title, stock, product.id)
          .then(result => {
            if (!result.success) console.warn(`⚠️  [Low Stock] Email not sent to ${sellerUser.email}: ${result.error}`);
            else console.log(`✅ [Low Stock] Email sent to ${sellerUser.email} for "${product.title}"`);
          })
          .catch(err => console.error("Low stock email error (addProduct):", err.message));
      } else {
        console.warn(`⚠️  [Low Stock] No email for seller ${sellerId} — email skipped`);
      }
    }

    // ── Notify all admins about new product pending review ───────────────────
    if (userRole === "SELLER" && productStatus === "PENDING") {
      try {
        const sellerUserInfo = await prisma.user.findUnique({
          where: { id: sellerId },
          select: { name: true }
        });
        const pendingDetails = {
          productTitle: title,
          sellerName: sellerUserInfo?.name || seller.storeName || seller.businessName || 'Unknown'
        };

        // In-app notifications for all admins (failure must not block email)
        try {
          await notifyAdminNewProduct(product.id, pendingDetails);
          console.log(`✅ [addProduct] In-app notifications sent to all admins for product "${title}"`);
        } catch (inAppErr) {
          console.error('❌ [addProduct] In-app notification error (non-fatal):', inAppErr.message);
        }

        // Email all admins — separate try/catch so notification failure never blocks email
        try {
          const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { email: true, name: true } });
          console.log(`📧 [addProduct] Found ${admins.length} admin(s) to email — product "${title}"`);
          for (const admin of admins) {
            if (admin.email) {
              const result = await sendAdminProductPendingEmail(admin.email, admin.name, {
                productTitle: title,
                sellerName: pendingDetails.sellerName,
                productId: product.id
              });
              if (result.success) {
                console.log(`✅ [addProduct] Pending-review email sent to admin ${admin.email}`);
              } else {
                console.error(`❌ [addProduct] Failed to email admin ${admin.email}:`, result.error);
              }
            } else {
              console.warn(`⚠️  [addProduct] Admin user has no email address — skipping`);
            }
          }
        } catch (emailErr) {
          console.error('❌ [addProduct] Admin email error:', emailErr.message);
        }
      } catch (notifyErr) {
        console.error('❌ [addProduct] Admin notification/email block error:', notifyErr.message);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    return reply.status(200).send({ 
      success: true, 
      message: "Product added successfully",
      productId: product.id,
      product: {
        id: product.id,
        title: product.title,
        description: product.description,
        price: product.price,
        stock: product.stock,
        category: product.category,
        featuredImage: featuredImageUrl,
        galleryImages: product.images,
        artistName: product.artistName,
        status: product.status,
        isActive: product.isActive,
        featured: product.featured,
        tags: product.tags
      },
      note: userRole === "ADMIN" ? "Product is live" : "Product submitted for admin review - will be live after approval",
      totalProducts: seller.productCount + 1
    });

    // ── [DEAD CODE REMOVED] Notification block was here but after return ──

  } catch (err) {
    console.error("Add product error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// GET MY PRODUCTS (Seller only)
exports.getMyProducts = async (request, reply) => {
  try {
    const sellerId = request.user.userId;

    const products = await prisma.$queryRaw`
      SELECT id, title, description, price, category, stock, "sellerId", "sellerName",
             "artistName", status, "isActive", featured, tags,
             "featuredImage", images AS "galleryImages",
             "rejectionReason", "createdAt", "updatedAt"
      FROM "products"
      WHERE "sellerId" = ${sellerId}
        AND "deletedAt" IS NULL
      ORDER BY "createdAt" DESC
    `;

    return reply.status(200).send({ 
      success: true, 
      products,
      count: products.length 
    });
  } catch (err) {
    console.error("Get my products error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// GET PRODUCT BY ID (Public)
exports.getProductById = async (request, reply) => {
  try {
    const id = request.params.id;

    const rows = await prisma.$queryRaw`
      SELECT p.id, p.title, p.description, p.price, p.category, p.stock,
             p."sellerId", p."sellerName", p."artistName", p.status, p."isActive",
             p.featured, p.tags, p."featuredImage", p.images AS "galleryImages",
             p."createdAt", p."updatedAt",
             u.id AS "seller_id", u.name AS "seller_name", u.email AS "seller_email"
      FROM "products" p
      JOIN "users" u ON p."sellerId" = u.id
      WHERE p.id = ${id}
        AND p."deletedAt" IS NULL
    `;

    if (!rows.length) {
      return reply.status(404).send({ success: false, message: "Product not found" });
    }

    const row = rows[0];
    const { seller_id, seller_name, seller_email, ...productFields } = row;

    return reply.status(200).send({
      success: true,
      product: {
        ...productFields,
        seller: { id: seller_id, name: seller_name, email: seller_email }
      }
    });
  } catch (err) {
    console.error("Get product by ID error:", err);
    reply.status(500).send({ success: false, error: err.message });
  }
};

// UPDATE PRODUCT (Seller or Admin)
exports.updateProduct = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const userRole = request.user.role; // From auth middleware
    
    const product = await prisma.product.findUnique({
      where: { id: request.params.id }
    });

    if (!product || product.deletedAt) {
      return reply.status(404).send({ success: false, message: "Product not found" });
    }

    // Check authorization: only seller (owner), admin, or super admin can update
    if (userRole !== "ADMIN" && userRole !== "SUPER_ADMIN" && product.sellerId !== userId) {
      return reply.status(403).send({ success: false, message: "You are not authorized to update this product" });
    }

    // Support both JSON and form/multipart bodies
    const body = request.body || {};
    let { title, description, price, stock, category, featured, tags, artistName, "artist name": artistNameWithSpace } = body;
    
    // Handle both artistName and "artist name" field formats
    const finalArtistName = artistName || artistNameWithSpace;
    
    let featuredImageUrl = undefined; // undefined = don't change; null = clear it
    let galleryImages = [];
    let hasGalleryUpdate = false;
    const { uploadToCloudinary } = require("../config/cloudinary");

    // Parse existingGalleryImages from body (URLs the frontend wants to keep)
    let existingGalleryImages = [];
    if (body.existingGalleryImages) {
      existingGalleryImages = Array.isArray(body.existingGalleryImages)
        ? body.existingGalleryImages
        : [body.existingGalleryImages];
      // Filter out empty strings
      existingGalleryImages = existingGalleryImages.filter(img => img && img.trim() !== '');
    }

    // Array to collect new uploaded gallery files
    let newGalleryFiles = [];

    // If files were uploaded, upload them to Cloudinary
    if (request.files) {
      let filesArray = Array.isArray(request.files) ? request.files : [request.files];
      if (filesArray.length > 0) {
        for (const file of filesArray) {
          try {
            const result = await uploadToCloudinary(file.path, 'products');
            if (file.fieldname === 'featuredImage') {
              featuredImageUrl = result.url;
            } else if (file.fieldname === 'galleryImages') {
              newGalleryFiles.push(result.url);
            }
          } catch (err) {
            console.error('Cloudinary upload error:', err);
          }
        }
      }
    } else {
      // Fallback: images provided as URLs in the body
      if (body.featuredImage !== undefined) {
        featuredImageUrl = typeof body.featuredImage === 'string' ? body.featuredImage : body.featuredImage[0];
      }
      if (body.galleryImages) {
        if (Array.isArray(body.galleryImages)) {
          newGalleryFiles = body.galleryImages;
        } else if (typeof body.galleryImages === 'string') {
          newGalleryFiles = [body.galleryImages];
        }
      }
      // Backward compat: old 'images' field maps first to featuredImage, rest to gallery
      if (featuredImageUrl === undefined && !newGalleryFiles.length && body.images) {
        const imgs = Array.isArray(body.images) ? body.images : [body.images];
        featuredImageUrl = imgs[0] || undefined;
        newGalleryFiles = imgs.slice(1);
      }
    }

    // Debug logging
    console.log('DEBUG - Form Data Received:', {
      existingGalleryImages: existingGalleryImages,
      newGalleryFiles: newGalleryFiles,
      keepExistingGallery: body.keepExistingGallery
    });

    // MERGE existing images with new uploaded images
    let allGalleryImages = [];
    
    // Handle edge cases according to the guide
    if (newGalleryFiles.length > 0 && existingGalleryImages.length > 0) {
      // User added new files AND has existing images - merge both
      allGalleryImages = [...existingGalleryImages, ...newGalleryFiles];
      hasGalleryUpdate = true;
    } else if (newGalleryFiles.length > 0 && existingGalleryImages.length === 0) {
      // User deleted all old images but added new files - use only new files
      allGalleryImages = newGalleryFiles;
      hasGalleryUpdate = true;
    } else if (newGalleryFiles.length === 0 && existingGalleryImages.length > 0) {
      // User didn't add new files but has existing images - keep existing as-is
      allGalleryImages = existingGalleryImages;
      hasGalleryUpdate = true;
    } else if (body.existingGalleryImages !== undefined || body.keepExistingGallery !== undefined) {
      // Explicit gallery update (even if empty)
      allGalleryImages = [];
      hasGalleryUpdate = true;
    }

    // Remove duplicates
    const uniqueGalleryImages = [...new Set(allGalleryImages)];
    
    if (hasGalleryUpdate) {
      galleryImages = uniqueGalleryImages;
    }

    console.log('DEBUG - Final Gallery Images:', {
      count: galleryImages.length,
      images: galleryImages
    });

    // Parse price and stock to correct types, ignore empty string
    if (typeof price === 'string' && price.trim() !== '') price = parseFloat(price);
    else if (typeof price === 'string') price = undefined;
    if (typeof stock === 'string' && stock.trim() !== '') stock = parseInt(stock);
    else if (typeof stock === 'string') stock = undefined;

    // Parse featured to boolean
    let parsedFeatured = undefined;
    if (featured !== undefined) {
      parsedFeatured = featured === 'true' || featured === true ? true : false;
    }

    // Parse tags - can be single string or array
    let parsedTags = undefined;
    if (tags) {
      if (Array.isArray(tags)) {
        parsedTags = tags.filter(tag => tag && tag.trim() !== '');
      } else if (typeof tags === 'string') {
        parsedTags = tags.split(',').map(tag => tag.trim()).filter(tag => tag !== '');
      }
    }

    // Build human-readable list of changed fields for admin notification
    const changedFields = [];
    if (title          !== undefined && title          !== '' && title          !== product.title)                        changedFields.push('Title');
    if (description    !== undefined && description    !== '' && description    !== product.description)                  changedFields.push('Description');
    if (price          !== undefined                          && parseFloat(price)  !== parseFloat(product.price))        changedFields.push(`Price (${product.price} → ${price})`);
    if (stock          !== undefined                          && parseInt(stock)    !== product.stock)                    changedFields.push(`Stock (${product.stock} → ${stock})`);
    if (category       !== undefined && category       !== '' && category       !== product.category)                    changedFields.push('Category');
    if (finalArtistName !== undefined && finalArtistName !== '' && finalArtistName !== product.artistName)               changedFields.push('Artist Name');
    if (parsedFeatured !== undefined && parsedFeatured !== product.featured)                                              changedFields.push('Featured');
    if (parsedTags     !== undefined)                                                                                     changedFields.push('Tags');
    if (featuredImageUrl !== undefined)                                                                                   changedFields.push('Featured Image');
    if (hasGalleryUpdate)                                                                                                 changedFields.push('Gallery Images');

    // Determine if product needs re-approval after update
    let newStatus = product.status; // Keep current status by default
    let newIsActive = true; // Assume active for now
    
    if (userRole === "SELLER" && product.sellerId === userId) {
      // Seller editing their own product - always goes back to PENDING for re-approval
      // This covers both normal edits AND re-submissions after a REJECTED status
      newStatus = "PENDING";
      newIsActive = false;
    }
    // Admin edits don't change approval status

    // Only update fields that are not undefined and not empty string
    const updateData = {};
    if (title !== undefined && title !== '') updateData.title = title;
    if (description !== undefined && description !== '') updateData.description = description;
    if (price !== undefined && price !== '') updateData.price = price;
    if (stock !== undefined && stock !== '') updateData.stock = stock;
    if (category !== undefined && category !== '') updateData.category = category;
    if (hasGalleryUpdate) updateData.images = galleryImages;
    if (parsedFeatured !== undefined) updateData.featured = parsedFeatured;
    if (parsedTags !== undefined) updateData.tags = parsedTags;
    if (finalArtistName !== undefined && finalArtistName !== '') updateData.artistName = finalArtistName;

    // Clear rejection reason when seller re-submits a rejected product
    if (userRole === "SELLER" && product.status === "REJECTED") {
      updateData.rejectionReason = null;
    }
    
    // Set status for approval workflow
    updateData.status = newStatus;

    const updatedProduct = await prisma.product.update({
      where: { id: request.params.id },
      data: updateData
    });

    // Update isActive and featuredImage using raw SQL
    await prisma.$executeRaw`UPDATE "products" SET "isActive" = ${newIsActive} WHERE "id" = ${request.params.id}`;
    if (featuredImageUrl !== undefined) {
      await prisma.$executeRaw`UPDATE "products" SET "featuredImage" = ${featuredImageUrl} WHERE "id" = ${request.params.id}`;
    }

    // ── Audit log: product updated ────────────────────────────────────────────
    auditLog({
      entityType:   ENTITY_TYPES.PRODUCT,
      entityId:     request.params.id,
      action:       AUDIT_ACTIONS.PRODUCT_UPDATED,
      previousData: product,
      newData:      updatedProduct,
      ...extractRequestMeta(request),
    });

    // ── Low stock auto-deactivation ──────────────────────────────────────────
    // Work out the effective stock after this update
    let lowStockTriggered = false;
    const finalStock = (stock !== undefined && stock !== '') ? stock : product.stock;
    if (finalStock <= LOW_STOCK_THRESHOLD) {
      // Force inactive regardless of role or status
      await prisma.$executeRaw`
        UPDATE "products"
        SET "isActive" = false, status = 'INACTIVE'
        WHERE id = ${request.params.id}
      `;
      newIsActive = false;
      lowStockTriggered = true;
      console.log(`⚠️  Product "${updatedProduct.title}" auto-deactivated — stock: ${finalStock}`);

      // ── Audit log: auto-deactivated due to low stock ───────────────────────
      auditLog({
        entityType:   ENTITY_TYPES.PRODUCT,
        entityId:     request.params.id,
        action:       AUDIT_ACTIONS.PRODUCT_AUTO_DEACTIVATED_LOW_STOCK,
        previousData: { ...updatedProduct, isActive: true },
        newData:      { ...updatedProduct, isActive: false, status: 'INACTIVE' },
        reason:       `Stock (${finalStock}) at or below low-stock threshold (${LOW_STOCK_THRESHOLD})`,
        ...extractRequestMeta(request),
      });

      // Fetch seller email for notification
      const sellerUser = await prisma.user.findUnique({
        where: { id: product.sellerId },
        select: { email: true, name: true }
      });

      notifySellerLowStock(
        product.sellerId,
        request.params.id,
        updatedProduct.title,
        finalStock
      ).catch(err => console.error("Low stock notification error:", err.message));

      notifyAdminLowStockDeactivation(request.params.id, {
        productTitle: updatedProduct.title,
        sellerName:   product.sellerName || 'Unknown',
        stock:        finalStock
      }).catch(err => console.error("Admin low stock deactivation notification error:", err.message));

      if (sellerUser?.email) {
        sendSellerLowStockEmail(
          sellerUser.email,
          sellerUser.name || "Seller",
          updatedProduct.title,
          finalStock,
          request.params.id
        ).then(result => {
          if (!result.success) console.warn(`⚠️  [Low Stock] Email not sent to ${sellerUser.email}: ${result.error}`);
          else console.log(`✅ [Low Stock] Email sent to ${sellerUser.email} for "${updatedProduct.title}"`);
        }).catch(err => console.error("Low stock email error:", err.message));
      } else {
        console.warn(`⚠️  [Low Stock] No email for seller ${product.sellerId} — email skipped`);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Notify admin when seller edit sends product back to PENDING ───────
    if (userRole === "SELLER" && newStatus === "PENDING" && !lowStockTriggered) {
      try {
        const sellerUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { name: true }
        });
        const pendingDetails = {
          productTitle: title || product.title,
          sellerName: sellerUser?.name || 'Unknown',
          changedFields
        };

        // In-app notifications for all admins (failure must not block email)
        try {
          await notifyAdminProductPending(request.params.id, pendingDetails);
          console.log(`✅ [updateProduct] In-app notifications sent to all admins for product "${pendingDetails.productTitle}"`);
        } catch (inAppErr) {
          console.error('❌ [updateProduct] In-app notification error (non-fatal):', inAppErr.message);
        }

        // Email all admins — separate try/catch so notification failure never blocks email
        try {
          const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { email: true, name: true } });
          console.log(`📧 [updateProduct] Found ${admins.length} admin(s) to email — product "${pendingDetails.productTitle}"`);
          for (const admin of admins) {
            if (admin.email) {
              const result = await sendAdminProductPendingEmail(admin.email, admin.name, {
                productTitle: pendingDetails.productTitle,
                sellerName: pendingDetails.sellerName,
                productId: request.params.id
              });
              if (result.success) {
                console.log(`✅ [updateProduct] Pending-review email sent to admin ${admin.email}`);
              } else {
                console.error(`❌ [updateProduct] Failed to email admin ${admin.email}:`, result.error);
              }
            } else {
              console.warn(`⚠️  [updateProduct] Admin user has no email address — skipping`);
            }
          }
        } catch (emailErr) {
          console.error('❌ [updateProduct] Admin email error:', emailErr.message);
        }
      } catch (notifyErr) {
        console.error('❌ [updateProduct] Admin notification/email block error:', notifyErr.message);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const resolvedFeaturedImage = featuredImageUrl !== undefined ? featuredImageUrl : product.featuredImage;
    const { images: _imgs, ...productFields } = updatedProduct;

    return reply.status(200).send({
      success: true,
      message: userRole === "SELLER" && newStatus === "PENDING" ? 
        "Product updated and sent for admin review" : 
        "Product updated successfully",
      product: {
        ...productFields,
        featuredImage: resolvedFeaturedImage,
        galleryImages: updatedProduct.images,
        isActive: newIsActive
      },
      requiresApproval: userRole === "SELLER" && newStatus === "PENDING"
    });
  } catch (err) {
    console.error("Update product error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// DELETE PRODUCT — soft delete (moves to Recycle Bin)
exports.deleteProduct = async (request, reply) => {
  try {
    const userId   = request.user.userId;
    const userRole = request.user.role;

    // Support both :id (product routes) and :productId (admin routes)
    const productId = request.params.id || request.params.productId;

    const product = await prisma.product.findUnique({
      where: { id: productId }
    });

    if (!product || product.deletedAt) {
      return reply.status(404).send({ success: false, message: "Product not found" });
    }

    // Only the owning seller or an admin may delete
    if (userRole !== "ADMIN" && userRole !== "SUPER_ADMIN" && product.sellerId !== userId) {
      return reply.status(403).send({ success: false, message: "You are not authorized to delete this product" });
    }

    const now = new Date();

    // Soft delete — mark deleted, deactivate, keep the row
    await prisma.$executeRaw`
      UPDATE "products"
      SET "deletedAt"     = ${now},
          "deletedBy"     = ${userId},
          "deletedByRole" = ${userRole},
          "isActive"      = false,
          status          = 'INACTIVE'::"ProductStatus"
      WHERE id = ${productId}
    `;

    // Audit log
    auditLog({
      entityType:   ENTITY_TYPES.PRODUCT,
      entityId:     productId,
      action:       AUDIT_ACTIONS.PRODUCT_DELETED,
      previousData: product,
      newData:      { ...product, deletedAt: now, deletedBy: userId, deletedByRole: userRole, deletedByEmail: request.user.email, isActive: false, status: 'INACTIVE' },
      reason:       request.body?.reason ?? `Moved to Recycle Bin by ${userRole} (${request.user.email})`,
      ...extractRequestMeta(request),
    });

    // Update seller product count
    let newCount = null;
    if (userRole === "SELLER") {
      const seller = await prisma.sellerProfile.findUnique({ where: { userId } });
      newCount = Math.max(0, (seller?.productCount || 1) - 1);
      await prisma.sellerProfile.update({
        where: { userId },
        data:  { productCount: newCount, minimumProductsUploaded: newCount >= 1 }
      });
    }

    return reply.status(200).send({
      success: true,
      message: "Product moved to Recycle Bin. It can be restored from there.",
      ...(newCount !== null && { totalProducts: newCount })
    });
  } catch (err) {
    console.error("Delete product error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// GET RECYCLE BIN — seller sees their own deleted products
exports.getRecycleBin = async (request, reply) => {
  try {
    const sellerId = request.user.userId;

    const products = await prisma.$queryRaw`
      SELECT id, title, description, price, category, stock, "sellerId", "sellerName",
             "artistName", status, featured, tags,
             "featuredImage", images AS "galleryImages",
             "rejectionReason", "deletedAt", "deletedBy", "deletedByRole",
             "createdAt", "updatedAt"
      FROM "products"
      WHERE "sellerId" = ${sellerId}
        AND "deletedAt" IS NOT NULL
      ORDER BY "deletedAt" DESC
    `;

    return reply.status(200).send({ success: true, products, count: products.length });
  } catch (err) {
    console.error("Get recycle bin error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// RESTORE PRODUCT from Recycle Bin
exports.restoreProduct = async (request, reply) => {
  try {
    const userId   = request.user.userId;
    const userRole = request.user.role;

    // Support both :id (seller routes) and :productId (admin routes)
    const productId = request.params.id || request.params.productId;

    // Fetch including soft-deleted rows
    const rows = await prisma.$queryRaw`
      SELECT * FROM "products" WHERE id = ${productId}
    `;
    const product = rows[0];

    if (!product) {
      return reply.status(404).send({ success: false, message: "Product not found" });
    }

    if (!product.deletedAt) {
      return reply.status(400).send({ success: false, message: "Product is not in the Recycle Bin" });
    }

    // Ownership check for sellers
    if (userRole !== "ADMIN" && userRole !== "SUPER_ADMIN" && product.sellerId !== userId) {
      return reply.status(403).send({ success: false, message: "You are not authorized to restore this product" });
    }

    // Sellers restore to PENDING (re-approval required); Admins/SuperAdmins restore to INACTIVE (can activate manually)
    const restoredStatus = (userRole === "ADMIN" || userRole === "SUPER_ADMIN") ? "INACTIVE" : "PENDING";

    await prisma.$executeRaw`
      UPDATE "products"
      SET "deletedAt"     = NULL,
          "deletedBy"     = NULL,
          "deletedByRole" = NULL,
          "isActive"      = false,
          status          = ${restoredStatus}::"ProductStatus"
      WHERE id = ${productId}
    `;

    // Audit log
    auditLog({
      entityType:   ENTITY_TYPES.PRODUCT,
      entityId:     productId,
      action:       AUDIT_ACTIONS.PRODUCT_RESTORED,
      previousData: product,
      newData:      {
        ...product,
        deletedAt:       null,
        deletedBy:       null,
        deletedByRole:   null,
        restoredAt:      new Date(),
        restoredById:    userId,
        restoredByEmail: request.user.email,
        restoredByRole:  userRole,
        isActive:        false,
        status:          restoredStatus,
      },
      reason:       `Restored by ${userRole} (${request.user.email}). Status set to ${restoredStatus} — ${userRole === 'SELLER' ? 'awaiting admin approval' : 'activate when ready'}.`,
      ...extractRequestMeta(request),
    });

    // Update seller product count back up
    const sellerIdToUpdate = userRole === "SELLER" ? userId : product.sellerId;
    const seller = await prisma.sellerProfile.findUnique({ where: { userId: sellerIdToUpdate } });
    if (seller) {
      const newCount = (seller.productCount || 0) + 1;
      await prisma.sellerProfile.update({
        where: { userId: sellerIdToUpdate },
        data:  { productCount: newCount, minimumProductsUploaded: newCount >= 1 }
      });
    }

    return reply.status(200).send({
      success: true,
      message: userRole === "ADMIN"
        ? "Product restored. Set it to Active when ready."
        : "Product restored and submitted for admin review.",
      restoredStatus
    });
  } catch (err) {
    console.error("Restore product error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// GET PRODUCT STOCK BY ID  (Public — lightweight, used for polling / page-load checks)
exports.getProductStock = async (request, reply) => {
  try {
    const { id } = request.params;

    const rows = await prisma.$queryRaw`
      SELECT id, stock, "isActive", status
      FROM "products"
      WHERE id = ${id}
        AND "deletedAt" IS NULL
    `;

    if (!rows.length) {
      return reply.status(404).send({ success: false, message: 'Product not found' });
    }

    const p = rows[0];
    return reply.status(200).send({
      success: true,
      productId: p.id,
      stock: p.stock,
      isAvailable: p.isActive && p.stock > 0,
      isActive: p.isActive
    });
  } catch (err) {
    console.error('Get product stock error:', err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// BULK STOCK CHECK (Public — used by cart page on load to validate all items at once)
exports.getBulkStock = async (request, reply) => {
  try {
    const { productIds } = request.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return reply.status(400).send({ success: false, message: 'productIds array is required' });
    }

    // Limit to 100 products per request to prevent abuse
    const ids = productIds.slice(0, 100);

    const products = await prisma.product.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, stock: true, isActive: true }
    });

    const stockMap = {};
    products.forEach((p) => {
      stockMap[p.id] = {
        productId: p.id,
        stock: p.stock,
        isAvailable: p.isActive && p.stock > 0,
        isActive: p.isActive
      };
    });

    // Include entries for any IDs not found in DB (treat as unavailable)
    ids.forEach((id) => {
      if (!stockMap[id]) {
        stockMap[id] = { productId: id, stock: 0, isAvailable: false, isActive: false };
      }
    });

    return reply.status(200).send({
      success: true,
      stock: stockMap
    });
  } catch (err) {
    console.error('Bulk stock check error:', err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// GET ALL PRODUCTS (Public - only active sellers' products)
exports.getAllProducts = async (request, reply) => {
  try {
    const products = await prisma.$queryRaw`
      SELECT
        p.*,
        u.name AS "sellerUserName",
        ROUND(AVG(r.rating)::numeric, 1)  AS "avgRating",
        COUNT(r.id)::int                  AS "ratingCount"
      FROM "products" p
      JOIN "users" u ON p."sellerId" = u.id
      JOIN "seller_profiles" sp ON u.id = sp."userId"
      LEFT JOIN "ratings" r ON r."productId" = p.id
      WHERE p."isActive" = true AND sp.status = 'ACTIVE'
        AND p."deletedAt" IS NULL
      GROUP BY p.id, u.name
      ORDER BY p."createdAt" DESC
    `;

    const mapped = products.map(({ images, ...p }) => ({
      ...p,
      featuredImage: p.featuredImage || null,
      galleryImages: images,
      avgRating: p.avgRating ? parseFloat(p.avgRating) : null,
      ratingCount: p.ratingCount ?? 0
    }));

    return reply.status(200).send({ success: true, products: mapped, count: mapped.length });
  } catch (err) {
    console.error("Get all products error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// ── SELLER: DEACTIVATE MY PRODUCT ────────────────────────────────────────────
// Seller can deactivate their own product with a mandatory reason.
// Product moves to INACTIVE status. Admin is notified with the reason.
exports.deactivateMyProduct = async (request, reply) => {
  try {
    const sellerId = request.user.userId;
    const { id: productId } = request.params;
    const body = request.body || {};
    const inactiveReason = body.reason || body.inactiveReason;

    if (!inactiveReason || !inactiveReason.trim()) {
      return reply.status(400).send({ success: false, message: 'A reason is required to deactivate your product.' });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { seller: { select: { id: true, name: true, email: true } } }
    });

    if (!product) {
      return reply.status(404).send({ success: false, message: 'Product not found.' });
    }

    // Ensure the seller owns this product
    if (product.sellerId !== sellerId) {
      return reply.status(403).send({ success: false, message: 'You do not own this product.' });
    }

    // Only active products can be deactivated by seller
    if (product.status !== 'ACTIVE') {
      return reply.status(400).send({
        success: false,
        message: `Product cannot be deactivated — current status is ${product.status}. Only ACTIVE products can be deactivated.`
      });
    }

    // Deactivate
    await prisma.product.update({
      where: { id: productId },
      data: {
        status: 'INACTIVE',
        sellerInactiveReason: inactiveReason.trim()
      }
    });
    await prisma.$executeRaw`UPDATE "products" SET "isActive" = false WHERE "id" = ${productId}`;

    auditLog({
      entityType: ENTITY_TYPES.PRODUCT,
      entityId: productId,
      action: AUDIT_ACTIONS.PRODUCT_DEACTIVATED,
      previousData: product,
      newData: { ...product, status: 'INACTIVE', isActive: false, sellerInactiveReason: inactiveReason.trim() },
      reason: inactiveReason.trim(),
      ...extractRequestMeta(request)
    });

    // Notify admins (in-app)
    notifyAdminProductSellerDeactivated(productId, {
      productTitle: product.title,
      sellerName: product.seller?.name || 'Unknown',
      inactiveReason: inactiveReason.trim()
    }).catch(err => console.error('Admin deactivate notification error:', err.message));

    // Email seller confirmation (non-blocking)
    if (product.seller?.email) {
      sendSellerProductSelfDeactivatedEmail(product.seller.email, product.seller.name || 'Seller', {
        productTitle: product.title,
        productId,
        inactiveReason: inactiveReason.trim()
      }).catch(err => console.error('Seller self-deactivate email error:', err.message));
    }

    // Email admins (non-blocking)
    prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { email: true, name: true } })
      .then(admins => {
        for (const admin of admins) {
          sendAdminProductSellerDeactivatedEmail(admin.email, admin.name || 'Admin', {
            productTitle: product.title,
            productId,
            sellerName: product.seller?.name || 'Unknown',
            inactiveReason: inactiveReason.trim()
          }).catch(err => console.error('Admin deactivate email error:', err.message));
        }
      }).catch(err => console.error('Admin lookup error (deactivate email):', err.message));

    return reply.send({ success: true, message: 'Product deactivated successfully.' });
  } catch (error) {
    console.error('Seller deactivate product error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ── SELLER: SUBMIT PRODUCT FOR REVIEW ────────────────────────────────────────
// Seller submits an INACTIVE or REJECTED product for admin review.
// Product moves to PENDING. Admin is notified with the seller's note.
// Seller CANNOT make a product directly ACTIVE — only admin can approve it.
exports.submitProductForReview = async (request, reply) => {
  try {
    const sellerId = request.user.userId;
    const { id: productId } = request.params;
    const body = request.body || {};
    const reviewNote = body.reviewNote || body.note || body.reason || '';

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { seller: { select: { id: true, name: true, email: true } } }
    });

    if (!product) {
      return reply.status(404).send({ success: false, message: 'Product not found.' });
    }

    if (product.sellerId !== sellerId) {
      return reply.status(403).send({ success: false, message: 'You do not own this product.' });
    }

    // Only INACTIVE or REJECTED products can be submitted for review
    if (!['INACTIVE', 'REJECTED'].includes(product.status)) {
      return reply.status(400).send({
        success: false,
        message: `Product cannot be submitted for review — current status is ${product.status}. Only INACTIVE or REJECTED products can be submitted.`
      });
    }

    // Set status to PENDING and store the review note
    await prisma.product.update({
      where: { id: productId },
      data: {
        status: 'PENDING',
        reviewNote: reviewNote.trim() || null,
        rejectionReason: null   // clear old rejection reason on new review request
      }
    });
    await prisma.$executeRaw`UPDATE "products" SET "isActive" = false WHERE "id" = ${productId}`;

    auditLog({
      entityType: ENTITY_TYPES.PRODUCT,
      entityId: productId,
      action: AUDIT_ACTIONS.PRODUCT_UPDATED,
      previousData: product,
      newData: { ...product, status: 'PENDING', reviewNote: reviewNote.trim() || null },
      reason: 'Seller submitted product for admin review',
      ...extractRequestMeta(request)
    });

    // Notify admins (in-app)
    notifyAdminProductSubmitReview(productId, {
      productTitle: product.title,
      sellerName: product.seller?.name || 'Unknown',
      reviewNote: reviewNote.trim() || null
    }).catch(err => console.error('Admin submit-review notification error:', err.message));

    // Email admins (non-blocking)
    prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { email: true, name: true } })
      .then(admins => {
        for (const admin of admins) {
          sendAdminProductSubmitReviewEmail(admin.email, admin.name || 'Admin', {
            productTitle: product.title,
            productId,
            sellerName: product.seller?.name || 'Unknown',
            reviewNote: reviewNote.trim() || null
          }).catch(err => console.error('Admin submit-review email error:', err.message));
        }
      }).catch(err => console.error('Admin lookup error (submit-review email):', err.message));

    // Email seller confirmation (non-blocking)
    if (product.seller?.email) {
      sendSellerProductSubmitReviewConfirmEmail(product.seller.email, product.seller.name || 'Seller', {
        productTitle: product.title,
        productId,
        reviewNote: reviewNote.trim() || null
      }).catch(err => console.error('Seller submit-review confirm email error:', err.message));
    }

    return reply.send({
      success: true,
      message: 'Product submitted for review. An admin will review and approve it shortly.'
    });
  } catch (error) {
    console.error('Seller submit-for-review error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};



