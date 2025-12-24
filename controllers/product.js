const prisma = require("../config/prisma");

// ADD PRODUCT (Seller only)
exports.addProduct = async (request, reply) => {
  const { title, description, price, stock, category, images } = request.body;

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
        images: images || [],
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

    const { title, description, price, stock, category, images } = request.body;

    // Update only the provided fields
    const updatedProduct = await prisma.product.update({
      where: { id: request.params.id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(price !== undefined && { price }),
        ...(stock !== undefined && { stock }),
        ...(category !== undefined && { category }),
        ...(images !== undefined && { images })
      }
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



