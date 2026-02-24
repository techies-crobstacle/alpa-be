const prisma = require("../config/prisma");
const {
  notifySellerProductStatusChange,
  notifySellerLowStock,
  notifyAdminNewProduct
} = require("./notification");

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
        } else {
          galleryImages.push(result.url); // galleryImages field name or others
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
        galleryImages = request.body.galleryImages;
      } else if (typeof request.body.galleryImages === 'string') {
        galleryImages = [request.body.galleryImages];
      }
    }
    // Backward compat: old 'images' field maps first to featuredImage, rest to gallery
    if (!featuredImageUrl && !galleryImages.length && request.body.images) {
      const imgs = Array.isArray(request.body.images) ? request.body.images : [request.body.images];
      featuredImageUrl = imgs[0] || null;
      galleryImages = imgs.slice(1);
    }
  }

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

    // Update seller product count
    await prisma.sellerProfile.update({
      where: { userId: sellerId },
      data: {
        productCount: { increment: 1 },
        minimumProductsUploaded: true
      }
    });

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
             "featuredImage", images AS "galleryImages", "createdAt", "updatedAt"
      FROM "products"
      WHERE "sellerId" = ${sellerId}
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

    if (!product) {
      return reply.status(404).send({ success: false, message: "Product not found" });
    }

    // Check authorization: only seller (owner) or admin can update
    if (userRole !== "ADMIN" && product.sellerId !== userId) {
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
    }

    // If files were uploaded, upload them to Cloudinary
    if (request.files) {
      let filesArray = Array.isArray(request.files) ? request.files : [request.files];
      if (filesArray.length > 0) {
        for (const file of filesArray) {
          try {
            const result = await uploadToCloudinary(file.path, 'products');
            if (file.fieldname === 'featuredImage') {
              featuredImageUrl = result.url;
            } else {
              galleryImages.push(result.url);
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
          galleryImages = body.galleryImages;
        } else if (typeof body.galleryImages === 'string') {
          galleryImages = [body.galleryImages];
        }
      }
      // Backward compat: old 'images' field maps first to featuredImage, rest to gallery
      if (featuredImageUrl === undefined && !galleryImages.length && body.images) {
        const imgs = Array.isArray(body.images) ? body.images : [body.images];
        featuredImageUrl = imgs[0] || undefined;
        galleryImages = imgs.slice(1);
      }
    }

    // Merge: keep existing gallery URLs + add newly uploaded ones
    const finalGallery = [...existingGalleryImages, ...galleryImages];
    if (finalGallery.length > 0 || body.existingGalleryImages !== undefined) {
      hasGalleryUpdate = true;
      galleryImages = finalGallery;
    }

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

    // Determine if product needs re-approval after update
    let newStatus = product.status; // Keep current status by default
    let newIsActive = true; // Assume active for now
    
    if (userRole === "SELLER" && product.sellerId === userId) {
      // Seller editing their own product - needs re-approval
      newStatus = "PENDING";
      newIsActive = false;
    }
    // Admin edits don't change status

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

// DELETE PRODUCT (Seller only)
exports.deleteProduct = async (request, reply) => {
  try {
    const userId = request.user.userId; // From auth middleware
    const userRole = request.user.role; // From auth middleware
    
    const product = await prisma.product.findUnique({
      where: { id: request.params.id }
    });

    if (!product) {
      return reply.status(404).send({ success: false, message: "Product not found" });
    }

    // Check authorization: only seller (owner) or admin can delete
    if (userRole !== "ADMIN" && product.sellerId !== userId) {
      return reply.status(403).send({ success: false, message: "You are not authorized to delete this product" });
    }

    await prisma.product.delete({
      where: { id: request.params.id }
    });

    // Update seller product count (only for seller actions, not admin)
    if (userRole === "SELLER") {
      const seller = await prisma.sellerProfile.findUnique({
        where: { userId }
      });

      const newCount = Math.max(0, (seller?.productCount || 1) - 1);
      await prisma.sellerProfile.update({
        where: { userId },
        data: {
          productCount: newCount,
          minimumProductsUploaded: newCount >= 1
        }
      });
    }

    return reply.status(200).send({ 
      success: true, 
      message: "Product deleted successfully",
      totalProducts: newCount
    });
  } catch (err) {
    console.error("Delete product error:", err);
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



