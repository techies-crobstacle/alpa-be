const prisma = require("../config/prisma");

exports.addToCart = async (request, reply) => {
  try {
    const { productId, quantity } = request.body;
    const userId = request.user.userId; // from auth middleware

    if (!productId) {
      return reply.status(400).send({ success: false, message: "productId is required" });
    }

    // Find or create cart
    let cart = await prisma.cart.findUnique({
      where: { userId },
      include: { items: true }
    });

    if (!cart) {
      // Create new cart with item
      cart = await prisma.cart.create({
        data: {
          userId,
          items: {
            create: {
              productId,
              quantity: quantity || 1
            }
          }
        },
        include: { items: true }
      });
    } else {
      // Check if product already in cart
      const existingItem = await prisma.cartItem.findUnique({
        where: {
          cartId_productId: {
            cartId: cart.id,
            productId
          }
        }
      });

      if (existingItem) {
        // Update quantity
        await prisma.cartItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: { increment: quantity || 1 }
          }
        });
      } else {
        // Add new item
        await prisma.cartItem.create({
          data: {
            cartId: cart.id,
            productId,
            quantity: quantity || 1
          }
        });
      }
    }

    return reply.status(200).send({
      success: true,
      message: "Product added to cart successfully",
    });
  } catch (error) {
    console.error("Add to cart error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};


// VIEW CART (User only)
exports.getMyCart = async (request, reply) => {
  try {
    const userId = request.user.userId; // from auth middleware

    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                price: true,
                images: true,
                stock: true,
                category: true
              }
            }
          }
        }
      }
    });

    if (!cart || cart.items.length === 0) {
      return reply.status(200).send({
        success: true,
        cart: [],
        message: "Cart is empty",
      });
    }

    // Clean response: only send necessary data
    const cleanedCart = cart.items.map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      product: item.product
    }));

    return reply.status(200).send({
      success: true,
      cart: cleanedCart,
    });
  } catch (error) {
    console.error("Get cart error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

exports.updateCartQuantity = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { productId, quantity } = request.body;

    if (!productId || quantity === undefined) {
      return reply.status(400).send({
        success: false,
        message: "productId and quantity are required"
      });
    }

    const cart = await prisma.cart.findUnique({
      where: { userId }
    });

    if (!cart) {
      return reply.status(404).send({
        success: false,
        message: "Cart not found"
      });
    }

    const cartItem = await prisma.cartItem.findUnique({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId
        }
      }
    });

    if (!cartItem) {
      return reply.status(404).send({
        success: false,
        message: "Product not found in cart"
      });
    }

    // Update the quantity
    const updatedItem = await prisma.cartItem.update({
      where: { id: cartItem.id },
      data: { quantity }
    });

    reply.status(200).send({
      success: true,
      message: "Cart quantity updated successfully",
      item: {
        productId: updatedItem.productId,
        quantity: updatedItem.quantity
      }
    });
  } catch (err) {
    console.error("Update cart quantity error:", err);
    reply.status(500).send({
      success: false,
      message: err.message
    });
  }
};


exports.removeFromCart = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const productId = request.params.productId;

    const cart = await prisma.cart.findUnique({
      where: { userId }
    });

    if (!cart) {
      return reply.status(404).send({ success: false, message: "Cart not found" });
    }

    // Delete the cart item
    await prisma.cartItem.deleteMany({
      where: {
        cartId: cart.id,
        productId
      }
    });

    // Get updated cart
    const updatedCart = await prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            product: true
          }
        }
      }
    });

    return reply.status(200).send({
      success: true,
      message: "Product removed from cart",
      cart: updatedCart?.items || [],
    });
  } catch (error) {
    console.error("Remove from cart error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};



