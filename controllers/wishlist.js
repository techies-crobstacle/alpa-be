const prisma = require("../config/prisma");

// ADD PRODUCT TO WISHLIST
exports.addToWishlist = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { productId } = request.params;

    // Check if product exists
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, title: true, status: true }
    });

    if (!product) {
      return reply.status(404).send({ 
        success: false, 
        message: "Product not found" 
      });
    }

    if (product.status !== "ACTIVE") {
      return reply.status(400).send({ 
        success: false, 
        message: "Cannot add inactive product to wishlist" 
      });
    }

    // Check if already in wishlist
    const existingWishlist = await prisma.wishlist.findUnique({
      where: {
        userId_productId: {
          userId,
          productId
        }
      }
    });

    if (existingWishlist) {
      return reply.status(400).send({ 
        success: false, 
        message: "Product already in wishlist" 
      });
    }

    // Add to wishlist
    const wishlistItem = await prisma.wishlist.create({
      data: {
        userId,
        productId
      },
      include: {
        product: {
          select: {
            id: true,
            title: true,
            price: true,
            images: true,
            stock: true
          }
        }
      }
    });

    return reply.status(201).send({
      success: true,
      message: "Product added to wishlist successfully",
      wishlistItem
    });

  } catch (error) {
    console.error("Add to wishlist error:", error);
    return reply.status(500).send({ 
      success: false, 
      message: error.message 
    });
  }
};

// REMOVE PRODUCT FROM WISHLIST
exports.removeFromWishlist = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { productId } = request.params;

    // Check if item exists in wishlist
    const wishlistItem = await prisma.wishlist.findUnique({
      where: {
        userId_productId: {
          userId,
          productId
        }
      }
    });

    if (!wishlistItem) {
      return reply.status(404).send({ 
        success: false, 
        message: "Product not found in wishlist" 
      });
    }

    // Remove from wishlist
    await prisma.wishlist.delete({
      where: {
        userId_productId: {
          userId,
          productId
        }
      }
    });

    return reply.status(200).send({
      success: true,
      message: "Product removed from wishlist successfully"
    });

  } catch (error) {
    console.error("Remove from wishlist error:", error);
    return reply.status(500).send({ 
      success: false, 
      message: error.message 
    });
  }
};

// GET USER'S WISHLIST
exports.getWishlist = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { page = 1, limit = 20 } = request.query;

    const wishlist = await prisma.wishlist.findMany({
      where: { userId },
      include: {
        product: {
          select: {
            id: true,
            title: true,
            description: true,
            price: true,
            images: true,
            stock: true,
            status: true,
            category: true,
            seller: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: parseInt(limit)
    });

    const totalCount = await prisma.wishlist.count({
      where: { userId }
    });

    return reply.status(200).send({
      success: true,
      wishlist: wishlist.map(item => ({
        id: item.id,
        product: item.product,
        addedAt: item.createdAt
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });

  } catch (error) {
    console.error("Get wishlist error:", error);
    return reply.status(500).send({ 
      success: false, 
      message: error.message 
    });
  }
};

// CHECK IF PRODUCT IS IN WISHLIST
exports.isInWishlist = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { productId } = request.params;

    const wishlistItem = await prisma.wishlist.findUnique({
      where: {
        userId_productId: {
          userId,
          productId
        }
      }
    });

    return reply.status(200).send({
      success: true,
      isInWishlist: !!wishlistItem
    });

  } catch (error) {
    console.error("Check wishlist error:", error);
    return reply.status(500).send({ 
      success: false, 
      message: error.message 
    });
  }
};

// CLEAR ENTIRE WISHLIST
exports.clearWishlist = async (request, reply) => {
  try {
    const userId = request.user.userId;

    const result = await prisma.wishlist.deleteMany({
      where: { userId }
    });

    return reply.status(200).send({
      success: true,
      message: `Wishlist cleared successfully. ${result.count} items removed.`
    });

  } catch (error) {
    console.error("Clear wishlist error:", error);
    return reply.status(500).send({ 
      success: false, 
      message: error.message 
    });
  }
};

// MOVE WISHLIST ITEM TO CART
exports.moveToCart = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { productId } = request.params;
    const { quantity = 1 } = request.body;

    // Check if product is in wishlist
    const wishlistItem = await prisma.wishlist.findUnique({
      where: {
        userId_productId: {
          userId,
          productId
        }
      },
      include: {
        product: true
      }
    });

    if (!wishlistItem) {
      return reply.status(404).send({ 
        success: false, 
        message: "Product not found in wishlist" 
      });
    }

    // Check stock
    if (wishlistItem.product.stock < quantity) {
      return reply.status(400).send({ 
        success: false, 
        message: "Insufficient stock" 
      });
    }

    // Get or create cart
    let cart = await prisma.cart.findUnique({
      where: { userId }
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: { userId }
      });
    }

    // Check if product already in cart
    const existingCartItem = await prisma.cartItem.findUnique({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId
        }
      }
    });

    if (existingCartItem) {
      // Update quantity
      await prisma.cartItem.update({
        where: {
          cartId_productId: {
            cartId: cart.id,
            productId
          }
        },
        data: {
          quantity: { increment: quantity }
        }
      });
    } else {
      // Add new cart item
      await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId,
          quantity
        }
      });
    }

    // Remove from wishlist
    await prisma.wishlist.delete({
      where: {
        userId_productId: {
          userId,
          productId
        }
      }
    });

    return reply.status(200).send({
      success: true,
      message: "Product moved to cart successfully"
    });

  } catch (error) {
    console.error("Move to cart error:", error);
    return reply.status(500).send({ 
      success: false, 
      message: error.message 
    });
  }
};

// TOGGLE PRODUCT IN WISHLIST (Add if not present, remove if present)
exports.toggleWishlist = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { productId } = request.params;

    // Check if product exists and is active
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, title: true, status: true }
    });

    if (!product) {
      return reply.status(404).send({ 
        success: false, 
        message: "Product not found" 
      });
    }

    if (product.status !== "ACTIVE") {
      return reply.status(400).send({ 
        success: false, 
        message: "Cannot add inactive product to wishlist" 
      });
    }

    // Check if already in wishlist
    const existingWishlist = await prisma.wishlist.findUnique({
      where: {
        userId_productId: {
          userId,
          productId
        }
      }
    });

    if (existingWishlist) {
      // Remove from wishlist
      await prisma.wishlist.delete({
        where: {
          userId_productId: {
            userId,
            productId
          }
        }
      });

      return reply.status(200).send({
        success: true,
        message: "Product removed from wishlist",
        action: "removed",
        isInWishlist: false
      });
    } else {
      // Add to wishlist
      await prisma.wishlist.create({
        data: {
          userId,
          productId
        }
      });

      return reply.status(200).send({
        success: true,
        message: "Product added to wishlist",
        action: "added",
        isInWishlist: true
      });
    }

  } catch (error) {
    console.error("Toggle wishlist error:", error);
    return reply.status(500).send({ 
      success: false, 
      message: error.message 
    });
  }
};
