const prisma = require("../config/prisma");
const { checkInventory } = require("../utils/checkInventory");
const { 
  sendOrderConfirmationEmail, 
  sendOrderStatusEmail,
  sendSellerOrderNotificationEmail 
} = require("../utils/emailService");
const {
  notifyCustomerOrderStatusChange,
  notifySellerNewOrder,
  notifyAdminNewOrder
} = require("./notification");
const { createOrderNotification } = require("./orderNotification");

// Stock Management and Inventory Alert with SMS Notification
exports.createOrder = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { shippingAddress, paymentMethod } = request.body;

    if (!shippingAddress || !paymentMethod) {
      return reply.status(400).send({ success: false, message: "All fields are required" });
    }

    // Get user details for SMS
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return reply.status(404).send({ success: false, message: "User not found" });
    }

    // Get user's cart with items and products
    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            product: true
          }
        }
      }
    });

    if (!cart || cart.items.length === 0) {
      return reply.status(400).send({ success: false, message: "Cart is empty" });
    }

    let totalAmount = 0;
    let sellerNotifications = new Map();
    const orderItems = [];

    // Stock validation + price calculation
    for (const item of cart.items) {
      const product = item.product;

      // Check stock
      if (product.stock < item.quantity) {
        return reply.status(400).send({
          success: false,
          message: `Insufficient stock for product: ${product.title}`
        });
      }

      const itemPrice = Number(product.price);
      const itemTotal = itemPrice * item.quantity;
      totalAmount += itemTotal;

      orderItems.push({
        productId: product.id,
        quantity: item.quantity,
        price: itemPrice
      });

      // Track seller products for notification
      if (!sellerNotifications.has(product.sellerId)) {
        sellerNotifications.set(product.sellerId, {
          productCount: 0,
          totalAmount: 0,
          products: []
        });
      }
      const sellerData = sellerNotifications.get(product.sellerId);
      sellerData.productCount += item.quantity;
      sellerData.totalAmount += itemTotal;
      sellerData.products.push({
        productId: product.id,
        title: product.title,
        quantity: item.quantity,
        price: itemPrice
      });
    }

    // Use transaction to ensure atomicity
    const order = await prisma.$transaction(async (tx) => {
      // Deduct stock
      for (const item of cart.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: { decrement: item.quantity }
          }
        });
      }

      // Create order with items
      const newOrder = await tx.order.create({
        data: {
          userId,
          totalAmount,
          shippingAddress,
          paymentMethod,
          status: "PENDING",
          customerName: user.name,
          customerEmail: user.email,
          customerPhone: user.phone || '',
          items: {
            create: orderItems
          }
        },
        include: {
          items: {
            include: {
              product: true
            }
          }
        }
      });

      // Clear cart
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id }
      });

      return newOrder;
    });

    console.log(`✅ Order created: ${order.id}`);

    // Get seller information for notifications
    let sellerNames = [];
    for (const [sellerId, _] of sellerNotifications) {
      try {
        const seller = await prisma.user.findUnique({
          where: { id: sellerId },
          select: { name: true }
        });
        if (seller) {
          sellerNames.push(seller.name);
        }
      } catch (error) {
        console.error(`Error fetching seller ${sellerId}:`, error);
      }
    }

    // Create notifications
    const orderNotificationData = {
      customerName: user.name,
      sellerName: sellerNames.length > 0 ? sellerNames.join(', ') : 'Unknown',
      totalAmount: totalAmount.toFixed(2),
      itemCount: order.items.length,
      orderId: order.id
    };

    // Notify admins about new order
    notifyAdminNewOrder(order.id, orderNotificationData).catch(error => {
      console.error("Admin notification error (non-blocking):", error.message);
    });

    // Send email to customer (non-blocking)
    if (user.email) {
      console.log(`📧 Sending order confirmation email to customer: ${user.email}`);
      sendOrderConfirmationEmail(user.email, user.name, {
        orderId: order.id,
        totalAmount,
        itemCount: order.items.length,
        products: order.items.map(item => ({
          title: item.product.title,
          quantity: item.quantity,
          price: item.price
        })),
        shippingAddress,
        paymentMethod,
        customerPhone: user.phone
      }).catch(error => {
        console.error("Email error (non-blocking):", error.message);
      });
    }

    // Send email to each seller (non-blocking)
    for (const [sellerId, sellerData] of sellerNotifications) {
      try {
        const seller = await prisma.user.findUnique({
          where: { id: sellerId },
          include: { sellerProfile: true }
        });

        if (seller && seller.email && seller.sellerProfile) {
          const sellerName = seller.sellerProfile.storeName || seller.sellerProfile.businessName || 'Seller';
          console.log(`📧 Sending order notification email to seller: ${seller.email}`);

          // Create order notification with SLA tracking
          createOrderNotification(
            order.id,
            sellerId,
            'ORDER_PROCESSING',
            'HIGH',
            {
              message: `New order received from ${user.name}`,
              notes: `${sellerData.productCount} item(s), Total: $${sellerData.totalAmount.toFixed(2)}`
            }
          ).catch(error => {
            console.error("Order notification creation error (non-blocking):", error.message);
          });
          
          // Send email notification
          sendSellerOrderNotificationEmail(seller.email, sellerName, {
            orderId: order.id,
            productCount: sellerData.productCount,
            totalAmount: sellerData.totalAmount,
            products: sellerData.products,
            shippingAddress,
            paymentMethod,
            customerName: user.name,
            customerEmail: user.email,
            customerPhone: user.phone
          }).catch(error => {
            console.error("Seller email error (non-blocking):", error.message);
          });

          // Create notification for seller
          notifySellerNewOrder(sellerId, order.id, {
            customerName: user.name,
            totalAmount: sellerData.totalAmount.toFixed(2),
            itemCount: sellerData.productCount,
            sellerName: sellerName
          }).catch(error => {
            console.error("Seller notification error (non-blocking):", error.message);
          });
        }
      } catch (error) {
        console.error(`Error notifying seller ${sellerId}:`, error.message);
      }
    }

    return reply.status(200).send({
      success: true,
      message: "Order placed successfully! Confirmation email sent.",
      orderId: order.id,
      totalAmount
    });

  } catch (error) {
    console.error("Create order error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// USER — VIEW MY ORDERS
exports.getMyOrders = async (request, reply) => {
  try {
    const userId = request.user.userId;
    
    const orders = await prisma.order.findMany({
      where: { userId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                images: true,
                price: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return reply.status(200).send({ success: true, orders });
  } catch (error) {
    console.error("Get my orders error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// USER — CANCEL ORDER (with SMS notification)
exports.cancelOrder = async (request, reply) => {
  try {
    const orderId = request.params.id;
    const userId = request.user.userId;

    const order = await prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!order) return reply.status(404).send({ success: false, message: "Order not found" });

    if (order.userId !== userId) return reply.status(403).send({ success: false, message: "Not authorized" });

    if (order.status !== "PENDING") {
      return reply.status(400).send({ success: false, message: "Order cannot be cancelled" });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED" }
    });

    // Send email notification about cancellation
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (user && user.email) {
      console.log(`📧 Sending cancellation email to customer: ${user.email}`);
      sendOrderStatusEmail(user.email, user.name, {
        orderId,
        status: "cancelled"
      }).catch(error => {
        console.error("Email error (non-blocking):", error.message);
      });

      // Create notification for customer about cancellation
      notifyCustomerOrderStatusChange(user.id, orderId, "cancelled", {
        totalAmount: order.totalAmount.toString(),
        itemCount: order.items?.length || 0
      }).catch(error => {
        console.error("Customer notification error (non-blocking):", error.message);
      });
    }

    return reply.status(200).send({ success: true, message: "Order cancelled successfully. Email notification sent." });

  } catch (error) {
    console.error("Cancel order error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// USER — REORDER (Add all items from previous order to cart)
exports.reorder = async (request, reply) => {
  try {
    const orderId = request.params.id;
    const userId = request.user.userId;

    // Get the order with items
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: true
          }
        }
      }
    });

    if (!order) {
      return reply.status(404).send({ success: false, message: "Order not found" });
    }

    if (order.userId !== userId) {
      return reply.status(403).send({ success: false, message: "Not authorized to reorder this order" });
    }

    if (order.items.length === 0) {
      return reply.status(400).send({ success: false, message: "Order has no items to reorder" });
    }

    // Get or create user's cart
    let cart = await prisma.cart.findUnique({
      where: { userId },
      include: {
        items: true
      }
    });

    console.log(`📋 Found existing cart for user ${userId}:`, cart ? `Cart ID: ${cart.id}, Items: ${cart.items.length}` : 'No cart found');

    if (!cart) {
      cart = await prisma.cart.create({
        data: { userId },
        include: {
          items: true
        }
      });
      console.log(`🆕 Created new cart for user ${userId}: Cart ID: ${cart.id}`);
    }

    const addedItems = [];
    const unavailableItems = [];
    
    // Process each item from the order
    for (const orderItem of order.items) {
      const product = orderItem.product;
      
      // Check if product still exists and is available
      if (!product) {
        unavailableItems.push({
          productId: orderItem.productId,
          reason: "Product no longer exists"
        });
        continue;
      }

      // Check stock availability
      if (product.stock < orderItem.quantity) {
        unavailableItems.push({
          productId: product.id,
          title: product.title,
          requestedQuantity: orderItem.quantity,
          availableStock: product.stock,
          reason: "Insufficient stock"
        });
        continue;
      }

      // Check if item already exists in cart
      const existingCartItem = await prisma.cartItem.findUnique({
        where: {
          cartId_productId: {
            cartId: cart.id,
            productId: product.id
          }
        }
      });

      console.log(`🔍 Checking product ${product.id} (${product.title}) in cart:`, existingCartItem ? `Found existing item with quantity ${existingCartItem.quantity}` : 'Not in cart');

      if (existingCartItem) {
        // Update existing cart item quantity
        const newQuantity = existingCartItem.quantity + orderItem.quantity;
        
        // Check if new quantity exceeds stock
        if (newQuantity > product.stock) {
          unavailableItems.push({
            productId: product.id,
            title: product.title,
            requestedQuantity: orderItem.quantity,
            currentCartQuantity: existingCartItem.quantity,
            availableStock: product.stock,
            reason: "Adding this quantity would exceed available stock"
          });
          continue;
        }

        const updatedItem = await prisma.cartItem.update({
          where: {
            cartId_productId: {
              cartId: cart.id,
              productId: product.id
            }
          },
          data: {
            quantity: newQuantity
          }
        });

        console.log(`📝 Updated cart item: Product ${product.id}, New quantity: ${updatedItem.quantity}`);

        addedItems.push({
          productId: product.id,
          title: product.title,
          quantity: orderItem.quantity,
          newTotalQuantity: newQuantity,
          action: "updated"
        });
      } else {
        // Create new cart item
        const newCartItem = await prisma.cartItem.create({
          data: {
            cartId: cart.id,
            productId: product.id,
            quantity: orderItem.quantity
          }
        });

        console.log(`➕ Created new cart item: Product ${product.id} (${product.title}), Quantity: ${newCartItem.quantity}, Cart Item ID: ${newCartItem.id}`);

        addedItems.push({
          productId: product.id,
          title: product.title,
          quantity: orderItem.quantity,
          action: "added"
        });
      }
    }

    console.log(`✅ Reorder processed for order ${orderId} - Added: ${addedItems.length}, Unavailable: ${unavailableItems.length}`);

    // Verify final cart state
    const finalCart = await prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                title: true
              }
            }
          }
        }
      }
    });

    console.log(`🛒 Final cart verification for user ${userId}:`, finalCart ? 
      `Cart ID: ${finalCart.id}, Total items: ${finalCart.items.length}` : 'Cart not found');
    
    if (finalCart && finalCart.items.length > 0) {
      console.log('📦 Cart contents:', finalCart.items.map(item => 
        `${item.product.title} (ID: ${item.productId}) - Qty: ${item.quantity}`
      ));
    }

    return reply.status(200).send({
      success: true,
      message: addedItems.length > 0 
        ? `Successfully added ${addedItems.length} items to cart for reorder`
        : "No items could be added to cart",
      data: {
        orderId,
        addedItems,
        unavailableItems,
        summary: {
          totalOrderItems: order.items.length,
          successfullyAdded: addedItems.length,
          unavailable: unavailableItems.length
        },
        debug: {
          cartId: finalCart?.id,
          finalCartItemCount: finalCart?.items.length || 0
        }
      }
    });

  } catch (error) {
    console.error("Reorder error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GUEST CHECKOUT — Create order without authentication
exports.createGuestOrder = async (request, reply) => {
  try {
    const { 
      items, // Array of { productId, quantity }
      customerName, 
      customerEmail, 
      customerPhone,
      shippingAddress,
      paymentMethod,
      state,
      country
    } = request.body;

    // Validation
    if (!items || items.length === 0) {
      return reply.status(400).send({ success: false, message: "Order items are required" });
    }

    if (!customerName || !customerEmail || !customerPhone) {
      return reply.status(400).send({ success: false, message: "Customer name, email, and phone are required" });
    }

    if (!shippingAddress || !paymentMethod) {
      return reply.status(400).send({ success: false, message: "Shipping address and payment method are required" });
    }

    // state and country are optional for now (will be required after migration)

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail)) {
      return reply.status(400).send({ success: false, message: "Invalid email address" });
    }

    let totalAmount = 0;
    let sellerNotifications = new Map();
    const orderItems = [];

    // Process each item in the order
    for (const item of items) {
      const { productId, quantity } = item;

      if (!productId || !quantity || quantity < 1) {
        return reply.status(400).send({ success: false, message: "Invalid item in order" });
      }

      // Fetch product
      const product = await prisma.product.findUnique({
        where: { id: productId }
      });

      if (!product) {
        return reply.status(404).send({ success: false, message: `Product ${productId} not found` });
      }

      // Check stock
      if (product.stock < quantity) {
        return reply.status(400).send({
          success: false,
          message: `Insufficient stock for product: ${product.title}`
        });
      }

      const itemPrice = Number(product.price);
      const itemTotal = itemPrice * quantity;
      totalAmount += itemTotal;

      orderItems.push({
        productId: product.id,
        quantity,
        price: itemPrice
      });

      // Track seller products for notification
      if (!sellerNotifications.has(product.sellerId)) {
        sellerNotifications.set(product.sellerId, {
          productCount: 0,
          totalAmount: 0,
          products: []
        });
      }
      const sellerData = sellerNotifications.get(product.sellerId);
      sellerData.productCount += quantity;
      sellerData.totalAmount += itemTotal;
      sellerData.products.push({
        productId: product.id,
        title: product.title,
        quantity,
        price: itemPrice
      });
    }

    // Create order using transaction
    const order = await prisma.$transaction(async (tx) => {
      // Deduct stock
      for (const item of orderItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: { decrement: item.quantity }
          }
        });
      }

      // Create order without userId (guest order) - use unchecked create to bypass relation requirement
      const newOrder = await tx.order.create({
        data: {
          totalAmount,
          shippingAddress,
          paymentMethod,
          status: "PENDING",
          customerName,
          customerEmail,
          customerPhone,
          items: {
            create: orderItems
          }
        },
        include: {
          items: {
            include: {
              product: true
            }
          }
        }
      });

      return newOrder;
    });

    console.log(`✅ Guest order created: ${order.id}`);

    // Get seller information for notifications
    let sellerNames = [];
    for (const [sellerId, _] of sellerNotifications) {
      try {
        const seller = await prisma.user.findUnique({
          where: { id: sellerId },
          select: { name: true }
        });
        if (seller) {
          sellerNames.push(seller.name);
        }
      } catch (error) {
        console.error(`Error fetching seller ${sellerId}:`, error);
      }
    }

    // Create notifications
    const orderNotificationData = {
      customerName,
      sellerName: sellerNames.length > 0 ? sellerNames.join(', ') : 'Unknown',
      totalAmount: totalAmount.toFixed(2),
      itemCount: order.items.length,
      orderId: order.id
    };

    // Notify admins about new guest order
    notifyAdminNewOrder(order.id, orderNotificationData).catch(error => {
      console.error("Admin notification error (non-blocking):", error.message);
    });

    // Send email to guest customer (non-blocking)
    console.log(`📧 Sending order confirmation email to guest customer: ${customerEmail}`);
    sendOrderConfirmationEmail(customerEmail, customerName, {
      orderId: order.id,
      totalAmount,
      itemCount: order.items.length,
      products: order.items.map(item => ({
        title: item.product.title,
        quantity: item.quantity,
        price: item.price
      })),
      shippingAddress,
      paymentMethod,
      customerPhone,
      isGuest: true
    }).catch(error => {
      console.error("Email error (non-blocking):", error.message);
    });

    // Send email to each seller (non-blocking)
    for (const [sellerId, sellerData] of sellerNotifications) {
      try {
        const seller = await prisma.user.findUnique({
          where: { id: sellerId },
          include: { sellerProfile: true }
        });

        if (seller && seller.email && seller.sellerProfile) {
          const sellerName = seller.sellerProfile.storeName || seller.sellerProfile.businessName || 'Seller';
          console.log(`📧 Sending order notification email to seller: ${seller.email}`);

          // Create order notification with SLA tracking
          createOrderNotification(
            order.id,
            sellerId,
            'ORDER_PROCESSING',
            'HIGH',
            {
              message: `New guest order received from ${customerName}`,
              notes: `${sellerData.productCount} item(s), Total: $${sellerData.totalAmount.toFixed(2)}`
            }
          ).catch(error => {
            console.error("Order notification creation error (non-blocking):", error.message);
          });
          
          // Send email notification
          sendSellerOrderNotificationEmail(seller.email, sellerName, {
            orderId: order.id,
            productCount: sellerData.productCount,
            totalAmount: sellerData.totalAmount,
            products: sellerData.products,
            shippingAddress,
            paymentMethod,
            customerName,
            customerEmail,
            customerPhone,
            isGuest: true
          }).catch(error => {
            console.error("Seller email error (non-blocking):", error.message);
          });

          // Create notification for seller
          notifySellerNewOrder(sellerId, order.id, {
            customerName,
            totalAmount: sellerData.totalAmount.toFixed(2),
            itemCount: sellerData.productCount,
            sellerName: sellerName
          }).catch(error => {
            console.error("Seller notification error (non-blocking):", error.message);
          });
        }
      } catch (error) {
        console.error(`Error notifying seller ${sellerId}:`, error.message);
      }
    }

    return reply.status(200).send({
      success: true,
      message: "Guest order placed successfully! Confirmation email sent.",
      orderId: order.id,
      totalAmount,
      customerEmail
    });

  } catch (error) {
    console.error("Create guest order error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GUEST — TRACK ORDER by Order ID and Email
exports.trackGuestOrder = async (request, reply) => {
  try {
    const { orderId, customerEmail } = request.query;

    if (!orderId || !customerEmail) {
      return reply.status(400).send({ success: false, message: "Order ID and customer email are required" });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                images: true,
                price: true
              }
            }
          }
        }
      }
    });

    if (!order) {
      return reply.status(404).send({ success: false, message: "Order not found" });
    }

    // Verify customer email matches
    if (order.customerEmail !== customerEmail) {
      return reply.status(403).send({ success: false, message: "Email does not match order" });
    }

    return reply.status(200).send({ 
      success: true, 
      order: {
        id: order.id,
        status: order.status,
        totalAmount: order.totalAmount,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        shippingAddress: order.shippingAddress,
        state: order.state,
        country: order.country,
        trackingNumber: order.trackingNumber,
        estimatedDelivery: order.estimatedDelivery,
        items: order.items,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      }
    });

  } catch (error) {
    console.error("Track guest order error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};


