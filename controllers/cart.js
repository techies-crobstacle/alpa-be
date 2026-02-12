const prisma = require("../config/prisma");

/**
 * Calculate cart totals with shipping and GST
 * @param {Array} cartItems - Array of cart items with product details
 * @param {String} shippingMethodId - Selected shipping method ID (optional)
 * @param {String} gstId - Selected GST ID (optional)
 * @returns {Object} - Calculated totals
 */
const calculateCartTotals = async (cartItems, shippingMethodId = null, gstId = null) => {
  try {
    // Calculate subtotal
    const subtotal = cartItems.reduce((sum, item) => {
      const price = parseFloat(item.product.price || 0);
      const quantity = item.quantity || 0;
      return sum + (price * quantity);
    }, 0);

    // Get shipping cost
    let shippingCost = 0;
    let selectedShipping = null;
    
    if (shippingMethodId) {
      const shipping = await prisma.shippingMethod.findUnique({
        where: { id: shippingMethodId, isActive: true }
      });
      if (shipping) {
        shippingCost = parseFloat(shipping.cost || 0);
        selectedShipping = shipping;
      }
    }

    // Get GST - either specific GST or default
    let gstDetails = null;
    if (gstId) {
      gstDetails = await prisma.gST.findUnique({
        where: { id: gstId, isActive: true }
      });
    } else {
      gstDetails = await prisma.gST.findFirst({
        where: { isActive: true, isDefault: true }
      });
    }

    const gstPercentage = gstDetails ? parseFloat(gstDetails.percentage || 0) : 0;
    const gstAmount = ((subtotal + shippingCost) * gstPercentage) / 100;
    
    const grandTotal = subtotal + shippingCost + gstAmount;

    return {
      subtotal: subtotal.toFixed(2),
      shippingCost: shippingCost.toFixed(2),
      gstPercentage: gstPercentage.toFixed(2),
      gstAmount: gstAmount.toFixed(2),
      grandTotal: grandTotal.toFixed(2),
      selectedShipping,
      gstDetails
    };
  } catch (error) {
    console.error("Calculate cart totals error:", error);
    throw error;
  }
};

exports.addToCart = async (request, reply) => {
  try {
    // Check if request body exists
    if (!request.body) {
      return reply.status(400).send({ success: false, message: "Request body is required" });
    }

    const { productId, quantity } = request.body;
    const userId = request.user.userId; // from auth middleware

    if (!productId) {
      return reply.status(400).send({ success: false, message: "productId is required" });
    }


    // Get product stock
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { stock: true }
    });
    if (!product) {
      return reply.status(404).send({ success: false, message: "Product not found" });
    }

    // Find or create cart
    let cart = await prisma.cart.findUnique({
      where: { userId },
      include: { items: true }
    });

    let newQuantity = quantity || 1;
    if (!cart) {
      // If creating new cart, just check requested quantity
      if (newQuantity > product.stock) {
        return reply.status(400).send({ success: false, message: `Cannot add more than available stock (${product.stock})` });
      }
      cart = await prisma.cart.create({
        data: {
          userId,
          items: {
            create: {
              productId,
              quantity: newQuantity
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
        // Calculate new total quantity
        const totalQuantity = existingItem.quantity + newQuantity;
        if (totalQuantity > product.stock) {
          return reply.status(400).send({ success: false, message: `Cannot add more than available stock (${product.stock})` });
        }
        await prisma.cartItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: totalQuantity
          }
        });
      } else {
        if (newQuantity > product.stock) {
          return reply.status(400).send({ success: false, message: `Cannot add more than available stock (${product.stock})` });
        }
        await prisma.cartItem.create({
          data: {
            cartId: cart.id,
            productId,
            quantity: newQuantity
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
    const { shippingMethodId, gstId } = request.query; // Optional: selected shipping method and GST

    console.log(`🛒 Fetching cart for user: ${userId}`);

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

    console.log(`📋 Cart found:`, cart ? 
      `Cart ID: ${cart.id}, Items: ${cart.items.length}` : 'No cart found');

    if (cart && cart.items.length > 0) {
      console.log('📦 Cart items:', cart.items.map(item => 
        `${item.product?.title || 'Unknown'} (ID: ${item.productId}) - Qty: ${item.quantity}`
      ));
    }

    if (!cart || cart.items.length === 0) {
      return reply.status(200).send({
        success: true,
        cart: [],
        message: "Cart is empty",
        availableShipping: [],
        calculations: {
          subtotal: "0.00",
          shippingCost: "0.00",
          gstPercentage: "0.00",
          gstAmount: "0.00",
          grandTotal: "0.00"
        }
      });
    }

    // Clean response: only send necessary data
    const cleanedCart = cart.items.map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      product: item.product
    }));

    // Get available shipping methods
    const availableShipping = await prisma.shippingMethod.findMany({
      where: { isActive: true },
      orderBy: { cost: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        cost: true,
        estimatedDays: true
      }
    });

    // Get default GST
    const defaultGST = await prisma.gST.findFirst({
      where: { isActive: true, isDefault: true },
      select: {
        id: true,
        name: true,
        percentage: true,
        description: true
      }
    });

    // Calculate totals
    const calculations = await calculateCartTotals(cleanedCart, shippingMethodId, gstId);

    return reply.status(200).send({
      success: true,
      cart: cleanedCart,
      availableShipping,
      gst: defaultGST,
      calculations
    });
  } catch (error) {
    console.error("Get cart error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

exports.updateCartQuantity = async (request, reply) => {
  try {
    const userId = request.user.userId;
    
    // Check if request body exists
    if (!request.body) {
      return reply.status(400).send({
        success: false,
        message: "Request body is required"
      });
    }

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

/**
 * Calculate cart totals for guest checkout
 * POST /api/cart/calculate-guest
 * Body: { items: [{ productId, quantity }], shippingMethodId }
 */
exports.calculateGuestCart = async (request, reply) => {
  try {
    const { items, shippingMethodId, gstId } = request.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return reply.status(400).send({
        success: false,
        message: "Items array is required and must not be empty"
      });
    }

    // Validate all items have required fields
    for (const item of items) {
      if (!item.productId || !item.quantity) {
        return reply.status(400).send({
          success: false,
          message: "Each item must have productId and quantity"
        });
      }
    }

    // Fetch product details for all items
    const productIds = items.map(item => item.productId);
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds }
      },
      select: {
        id: true,
        title: true,
        price: true,
        images: true,
        stock: true,
        category: true
      }
    });

    // Check if all products exist
    if (products.length !== items.length) {
      return reply.status(404).send({
        success: false,
        message: "One or more products not found"
      });
    }

    // Build cart items with product details
    const cartItems = items.map(item => {
      const product = products.find(p => p.id === item.productId);
      return {
        productId: item.productId,
        quantity: item.quantity,
        product
      };
    });

    // Check stock availability
    for (const item of cartItems) {
      if (item.quantity > item.product.stock) {
        return reply.status(400).send({
          success: false,
          message: `Insufficient stock for ${item.product.title}. Available: ${item.product.stock}`
        });
      }
    }

    // Get available options for guest users
    const availableShipping = await prisma.shippingMethod.findMany({
      where: { isActive: true },
      orderBy: { cost: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        cost: true,
        estimatedDays: true
      }
    });

    const availableGST = await prisma.gST.findMany({
      where: { isActive: true },
      orderBy: { percentage: 'asc' },
      select: {
        id: true,
        name: true,
        percentage: true,
        description: true,
        isDefault: true
      }
    });

    const defaultGST = await prisma.gST.findFirst({
      where: { isActive: true, isDefault: true },
      select: {
        id: true,
        name: true,
        percentage: true,
        description: true
      }
    });

    // Calculate totals
    const calculations = await calculateCartTotals(cartItems, shippingMethodId, gstId);

    return reply.status(200).send({
      success: true,
      cart: cartItems,
      availableShipping,
      availableGST,
      defaultGST,
      calculations
    });
  } catch (error) {
    console.error("Calculate guest cart error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message
    });
  }
};

/**
 * PUBLIC - Get checkout options (shipping methods and GST) for guest users
 */
const getCheckoutOptions = async (request, reply) => {
  try {
    // Get available shipping methods
    const availableShipping = await prisma.shippingMethod.findMany({
      where: { isActive: true },
      orderBy: { cost: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        cost: true,
        estimatedDays: true
      }
    });

    // Get all active GST options
    const availableGST = await prisma.gST.findMany({
      where: { isActive: true },
      orderBy: { percentage: 'asc' },
      select: {
        id: true,
        name: true,
        percentage: true,
        description: true,
        isDefault: true
      }
    });

    // Get default GST
    const defaultGST = await prisma.gST.findFirst({
      where: { isActive: true, isDefault: true },
      select: {
        id: true,
        name: true,
        percentage: true,
        description: true
      }
    });

    return reply.status(200).send({
      success: true,
      data: {
        shipping: availableShipping,
        gst: {
          options: availableGST,
          default: defaultGST
        }
      }
    });
  } catch (error) {
    console.error("Get checkout options error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message
    });
  }
};

// Export the helper function for use in other controllers
exports.calculateCartTotals = calculateCartTotals;
exports.getCheckoutOptions = getCheckoutOptions;
