const prisma = require("../config/prisma");
const {
  notifySellerProductStatusChange,
  notifySellerLowStock,
  notifyAdminNewProduct
} = require("./notification");

// ADD PRODUCT (Seller only)
exports.addProduct = async (request, reply) => {
  let { title, description, price, stock, category } = request.body;
  // Parse price and stock to correct types
  if (typeof price === 'string') price = parseFloat(price);
  if (typeof stock === 'string') stock = parseInt(stock);
  let images = [];
  const { uploadToCloudinary } = require("../config/cloudinary");

  // If files were uploaded, upload them to Cloudinary
  if (request.files && request.files.length > 0) {
    for (const file of request.files) {
      try {
        const result = await uploadToCloudinary(file.path, 'products');
        images.push(result.url);
      } catch (err) {
        console.error('Cloudinary upload error:', err);
      }
    }
  } else if (request.body.images) {
    // If images are provided as URLs in the body (fallback)
    if (Array.isArray(request.body.images)) {
      images = request.body.images;
    } else if (typeof request.body.images === 'string') {
      images = [request.body.images];
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

    // Products are pending until seller goes live (status = "ACTIVE")
    const productStatus = seller.status === "ACTIVE" ? "ACTIVE" : "PENDING";

    const product = await prisma.product.create({
      data: {
        title,
        description,
        price,
        stock,
        category,
        images,
        sellerId,
        sellerName: seller.storeName || seller.businessName,
        status: productStatus
      }
    });

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
        images: product.images,
        status: product.status
      },
      note: productStatus === "PENDING" ? "Product will go live when your store is activated by admin" : "Product is live",
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
    const sellerId = request.user.userId; // From authenticateSeller middleware

    const products = await prisma.product.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' }
    });

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
    const product = await prisma.product.findUnique({
      where: { id: request.params.id },
      include: {
        seller: {
          select: { id: true, name: true, email: true }
        }
      }
    });

    if (!product) {
      return reply.status(404).send({ success: false, message: "Product not found" });
    }

    reply.status(200).send({ success: true, product });
  } catch (err) {
    console.error("Get product by ID error:", err);
    reply.status(500).send({ success: false, error: err.message });
  }
};

// UPDATE PRODUCT (Seller only)
exports.updateProduct = async (request, reply) => {
  try {
    const sellerId = request.user.userId; // From authenticateSeller middleware
    
    const product = await prisma.product.findUnique({
      where: { id: request.params.id }
    });

    if (!product) {
      return reply.status(404).send({ success: false, message: "Product not found" });
    }

    // Check if the logged-in seller is the owner
    if (product.sellerId !== sellerId) {
      return reply.status(403).send({ success: false, message: "You are not authorized to update this product" });
    }

    // Support both JSON and form/multipart bodies
    const body = request.body || {};
    let { title, description, price, stock, category } = body;
    let images = [];
    const { uploadToCloudinary } = require("../config/cloudinary");

    // If files were uploaded, upload them to Cloudinary
    if (request.files) {
      let filesArray = [];
      if (Array.isArray(request.files)) {
          // Debug log incoming body and files
          console.log('UpdateProduct request.body:', request.body);
          console.log('UpdateProduct request.files:', request.files);
        filesArray = request.files;
      } else if (typeof request.files === 'object') {
        filesArray = [request.files];
      }
      if (filesArray.length > 0) {
        for (const file of filesArray) {
          try {
            const result = await uploadToCloudinary(file.path, 'products');
            images.push(result.url);
          } catch (err) {
            console.error('Cloudinary upload error:', err);
          }
        }
      }
    } else if (body.images) {
      // If images are provided as URLs in the body (fallback)
      if (Array.isArray(body.images)) {
        images = body.images;
      } else if (typeof body.images === 'string') {
        images = [body.images];
      }
    }

    // Parse price and stock to correct types, ignore empty string
    if (typeof price === 'string' && price.trim() !== '') price = parseFloat(price);
    else if (typeof price === 'string') price = undefined;
    if (typeof stock === 'string' && stock.trim() !== '') stock = parseInt(stock);
    else if (typeof stock === 'string') stock = undefined;

    // Only update fields that are not undefined and not empty string
    const updateData = {};
    if (title !== undefined && title !== '') updateData.title = title;
    if (description !== undefined && description !== '') updateData.description = description;
    if (price !== undefined && price !== '') updateData.price = price;
    if (stock !== undefined && stock !== '') updateData.stock = stock;
    if (category !== undefined && category !== '') updateData.category = category;
    if (images.length > 0) updateData.images = images;

    const updatedProduct = await prisma.product.update({
      where: { id: request.params.id },
      data: updateData
    });

    return reply.status(200).send({
      success: true,
      message: "Product updated successfully",
      product: updatedProduct
    });
  } catch (err) {
    console.error("Update product error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// DELETE PRODUCT (Seller only)
exports.deleteProduct = async (request, reply) => {
  try {
    const sellerId = request.user.userId; // From authenticateSeller middleware
    
    const product = await prisma.product.findUnique({
      where: { id: request.params.id }
    });

    if (!product) {
          // Debug log updateData before update
          console.log('UpdateProduct updateData:', updateData);
      return reply.status(404).send({ success: false, message: "Product not found" });
    }

    // Check if the logged-in seller is the owner
    if (product.sellerId !== sellerId) {
      return reply.status(403).send({ success: false, message: "You are not authorized to delete this product" });
    }

    await prisma.product.delete({
      where: { id: request.params.id }
    });

    // Update seller product count
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: sellerId }
    });

    const newCount = Math.max(0, (seller?.productCount || 1) - 1);
    await prisma.sellerProfile.update({
      where: { userId: sellerId },
      data: {
        productCount: newCount,
        minimumProductsUploaded: newCount >= 1
      }
    });

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
    const products = await prisma.product.findMany({
      where: {
        status: "ACTIVE",
        seller: {
          sellerProfile: {
            status: "ACTIVE"
          }
        }
      },
      include: {
        seller: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return reply.status(200).send({ success: true, products, count: products.length });
  } catch (err) {
    console.error("Get all products error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};



