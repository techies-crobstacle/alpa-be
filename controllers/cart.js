const { db } = require("../config/firebase");

exports.addToCart = async (request, reply) => {
  try {
    const { productId, quantity } = request.body;
    const userId = request.user.uid; // from auth middleware

    if (!productId) {
      return reply.status(400).json({ success: false, message: "productId is required" });
    }

    const cartRef = db.collection("carts").doc(userId);
    const cartSnap = await cartRef.get();

    if (!cartSnap.exists) {
      // create new cart
      await cartRef.set({
        products: [{ productId, quantity: quantity || 1 }],
        updatedAt: new Date(),
      });
    } else {
      // update existing cart
      const cartData = cartSnap.data();
      let items = cartData.products || [];

      const existingIndex = items.findIndex(item => item.productId === productId);

      if (existingIndex > -1) {
        items[existingIndex].quantity += quantity || 1;
      } else {
        items.push({ productId, quantity: quantity || 1 });
      }

      await cartRef.update({
        products: items,
        updatedAt: new Date(),
      });
    }

    return reply.status(200).json({
      success: true,
      message: "Product added to cart successfully",
    });
  } catch (error) {
    return reply.status(500).json({ success: false, message: error.message });
  }
};


// VIEW CART (User only)
exports.getMyCart = async (request, reply) => {
  try {
    const userId = request.user.uid; // from auth middleware

    const cartRef = db.collection("carts").doc(userId);
    const cartSnap = await cartRef.get();

    if (!cartSnap.exists) {
      return reply.status(200).json({
        success: true,
        cart: [],
        message: "Cart is empty",
      });
    }

    return reply.status(200).json({
      success: true,
      cart: cartSnap.data().products || [],
    });
  } catch (error) {
    return reply.status(500).json({ success: false, message: error.message });
  }
};

exports.updateCartQuantity = async (request, reply) => {
  try {
    const userId = request.user.uid;
    const { productId, quantity } = request.body;

    if (!productId || quantity === undefined) {
      return reply.status(400).json({
        success: false,
        message: "productId and quantity are required"
      });
    }

    const cartRef = db.collection("carts").doc(userId);
    const cartDoc = await cartRef.get();

    if (!cartDoc.exists) {
      return reply.status(404).json({
        success: false,
        message: "Cart not found"
      });
    }

    let items = cartDoc.data().products || [];

    let itemIndex = items.findIndex(item => item.productId === productId);
    if (itemIndex === -1) {
      return reply.status(404).json({
        success: false,
        message: "Product not found in cart"
      });
    }

    // Update the quantity
    items[itemIndex].quantity = quantity;

    await cartRef.update({ products: items });

    reply.status(200).json({
      success: true,
      message: "Cart quantity updated successfully",
      items
    });
  } catch (err) {
    reply.status(500).json({
      success: false,
      message: err.message
    });
  }
};


exports.removeFromCart = async (request, reply) => {
  try {
    const userId = request.user.uid;
    const productId = request.params.productId;

    const cartRef = db.collection("carts").doc(userId);
    const cartSnap = await cartRef.get();

    if (!cartSnap.exists) {
      return reply.status(404).json({ success: false, message: "Cart not found" });
    }

    const cartData = cartSnap.data();
    let items = cartData.products || [];

    const newItems = items.filter(item => item.productId !== productId);

    await cartRef.update({
      products: newItems,
      updatedAt: new Date()
    });

    return reply.status(200).json({
      success: true,
      message: "Product removed from cart",
      cart: newItems,
    });
  } catch (error) {
    return reply.status(500).json({ success: false, message: error.message });
  }
};

