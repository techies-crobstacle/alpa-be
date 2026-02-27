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
const { calculateCartTotals } = require("./cart");
const PDFDocument = require('pdfkit');

// Stock Management and Inventory Alert with SMS Notification
exports.createOrder = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { 
      shippingAddress, 
      paymentMethod, 
      shippingMethodId, 
      gstId,
      country,
      city,
      zipCode,
      state,
      mobileNumber,
      couponCode
    } = request.body;

    if (!shippingAddress || !paymentMethod || !shippingMethodId) {
      return reply.status(400).send({ success: false, message: "All fields including shipping method are required" });
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

    // Calculate proper cart totals including shipping and GST
    const cartCalculations = await calculateCartTotals(cart.items, shippingMethodId, gstId);
    
    // Get shipping method details
    const shippingMethod = await prisma.shippingMethod.findUnique({
      where: { id: shippingMethodId, isActive: true }
    });

    if (!shippingMethod) {
      return reply.status(400).send({ success: false, message: "Invalid or inactive shipping method" });
    }

    // Use grand total from cart calculations
    const originalTotal = parseFloat(cartCalculations.grandTotal);

    // ── Coupon validation (server-side) ──────────────────────────────────────
    let appliedCoupon = null;
    let discountAmount = 0;

    if (couponCode) {
      const coupon = await prisma.coupon.findUnique({
        where: { code: couponCode.toUpperCase() }
      });

      if (!coupon) {
        return reply.status(400).send({ success: false, message: 'Invalid coupon code' });
      }
      if (!coupon.isActive) {
        return reply.status(400).send({ success: false, message: 'This coupon is no longer active' });
      }
      if (new Date() > coupon.expiresAt) {
        return reply.status(400).send({ success: false, message: 'Coupon has expired' });
      }
      if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
        return reply.status(400).send({ success: false, message: 'Coupon usage limit has been reached' });
      }
      if (coupon.minCartValue !== null && originalTotal < coupon.minCartValue) {
        return reply.status(400).send({
          success: false,
          message: `Minimum cart value of $${coupon.minCartValue.toFixed(2)} required for this coupon`
        });
      }

      // Calculate discount
      if (coupon.discountType === 'percentage') {
        discountAmount = parseFloat(((originalTotal * coupon.discountValue) / 100).toFixed(2));
        if (coupon.maxDiscount !== null) {
          discountAmount = Math.min(discountAmount, coupon.maxDiscount);
        }
      } else {
        // fixed
        discountAmount = Math.min(coupon.discountValue, originalTotal);
      }

      appliedCoupon = coupon;
    }

    const totalAmount = parseFloat((originalTotal - discountAmount).toFixed(2));
    // ─────────────────────────────────────────────────────────────────────────

    let sellerNotifications = new Map();
    const orderItems = [];

    // Stock validation + prepare order items
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

      // Increment coupon usedCount inside the transaction (atomic)
      if (appliedCoupon) {
        await tx.coupon.update({
          where: { id: appliedCoupon.id },
          data: { usedCount: { increment: 1 } }
        });
      }

      // Create order with items and shipping/GST details
      const newOrder = await tx.order.create({
        data: {
          userId,
          totalAmount,
          originalTotal,
          couponCode: appliedCoupon ? appliedCoupon.code : null,
          discountAmount: discountAmount > 0 ? discountAmount : null,
          shippingAddress: typeof shippingAddress === 'string' ? { address: shippingAddress } : {
            ...shippingAddress,
            // Include order breakdown for invoice purposes
            orderSummary: {
              subtotal: cartCalculations.subtotal,
              shippingCost: cartCalculations.shippingCost,
              gstPercentage: cartCalculations.gstPercentage,
              gstAmount: cartCalculations.gstAmount,
              grandTotal: cartCalculations.grandTotal,
              couponCode: appliedCoupon ? appliedCoupon.code : null,
              discountAmount,
              finalTotal: totalAmount,
              shippingMethod: {
                id: shippingMethod.id,
                name: shippingMethod.name,
                cost: shippingMethod.cost,
                estimatedDays: shippingMethod.estimatedDays
              },
              gstDetails: cartCalculations.gstDetails
            }
          },
          shippingAddressLine: typeof shippingAddress === 'string' ? shippingAddress : shippingAddress?.addressLine,
          shippingCity: city,
          shippingState: state,
          shippingZipCode: zipCode,
          shippingCountry: country,
          shippingPhone: mobileNumber,
          paymentMethod,
          status: "CONFIRMED",
          customerName: user.name,
          customerEmail: user.email,
          customerPhone: mobileNumber || user.phone || '',
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

      // Increment coupon usageCount if applied
      if (appliedCoupon) {
        await tx.coupon.update({
          where: { id: appliedCoupon.id },
          data: { usageCount: { increment: 1 } }
        });
      }

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

      // Generate invoice PDF to attach
      const invoiceOrderForPDF = {
        id: order.id,
        createdAt: order.createdAt,
        status: order.status,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        shippingAddressLine: order.shippingAddressLine,
        shippingCity: city,
        shippingState: state,
        shippingZipCode: zipCode,
        shippingCountry: country,
        shippingPhone: mobileNumber,
        totalAmount: order.totalAmount,
        discountAmount: order.discountAmount,
        couponCode: order.couponCode,
        paymentMethod,
        items: order.items
      };
      let invoicePDFBuffer = null;
      try {
        invoicePDFBuffer = await generateInvoiceBuffer(invoiceOrderForPDF);
      } catch (pdfErr) {
        console.error('Invoice PDF generation error (non-fatal):', pdfErr.message);
      }

      sendOrderConfirmationEmail(user.email, user.name, {
        orderId: order.id,
        totalAmount,
        itemCount: order.items.length,
        products: order.items.map(item => ({
          title: item.product.title,
          quantity: item.quantity,
          price: item.price
        })),
        shippingAddress: shippingAddress,
        orderSummary: {
          subtotal: cartCalculations.subtotal,
          subtotalExGST: cartCalculations.subtotalExGST,
          shippingCost: cartCalculations.shippingCost,
          gstPercentage: cartCalculations.gstPercentage,
          gstAmount: cartCalculations.gstAmount,
          grandTotal: cartCalculations.grandTotal,
          gstInclusive: true,
          shippingMethod: {
            name: shippingMethod.name,
            cost: shippingMethod.cost,
            estimatedDays: shippingMethod.estimatedDays
          }
        },
        invoicePDFBuffer
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
      orderSummary: {
        subtotal: cartCalculations.subtotal,
        subtotalExGST: cartCalculations.subtotalExGST,
        shippingCost: cartCalculations.shippingCost,
        gstPercentage: cartCalculations.gstPercentage,
        gstAmount: cartCalculations.gstAmount,
        originalTotal,
        discountAmount: appliedCoupon ? discountAmount : null,
        coupon: appliedCoupon ? {
          code:          appliedCoupon.code,
          discountType:  appliedCoupon.discountType,
          discountValue: appliedCoupon.discountValue,
          maxDiscount:   appliedCoupon.maxDiscount,
          discountAmount
        } : null,
        totalAmount,
        gstInclusive: true,
        shippingMethod: {
          name: shippingMethod.name,
          estimatedDays: shippingMethod.estimatedDays
        }
      }
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

    // Normalise legacy PENDING status → CONFIRMED
    const normalised = orders.map(o => ({
      ...o,
      status: o.status === 'PENDING' ? 'CONFIRMED' : o.status
    }));

    return reply.status(200).send({ success: true, orders: normalised });
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
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: { select: { id: true, title: true, price: true } }
          }
        }
      }
    });

    if (!order) return reply.status(404).send({ success: false, message: "Order not found" });

    if (order.userId !== userId) return reply.status(403).send({ success: false, message: "Not authorized" });

    if (!['PENDING', 'CONFIRMED'].includes(order.status)) {
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

      // Generate invoice PDF for cancellation email
      let cancelInvoicePDF = null;
      try {
        cancelInvoicePDF = await generateInvoiceBuffer({
          id: orderId,
          createdAt: order.createdAt,
          status: 'CANCELLED',
          customerName: order.customerName,
          customerEmail: user.email,
          customerPhone: order.customerPhone,
          shippingAddressLine: order.shippingAddressLine,
          shippingCity: order.shippingCity,
          shippingState: order.shippingState,
          shippingZipCode: order.shippingZipCode,
          shippingCountry: order.shippingCountry,
          shippingPhone: order.shippingPhone,
          totalAmount: order.totalAmount,
          discountAmount: order.discountAmount,
          couponCode: order.couponCode,
          paymentMethod: order.paymentMethod,
          items: order.items
        });
      } catch (pdfErr) {
        console.error('Invoice PDF generation error (non-fatal):', pdfErr.message);
      }

      sendOrderStatusEmail(user.email, user.name, {
        orderId,
        status: "cancelled",
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        orderDate: order.createdAt,
        shippingName: order.customerName,
        shippingAddress: order.shippingAddressLine,
        shippingCity: order.shippingCity,
        shippingState: order.shippingState,
        shippingZipCode: order.shippingZipCode,
        shippingCountry: order.shippingCountry,
        shippingPhone: order.shippingPhone,
        products: order.items?.map(item => ({
          title: item.product?.title || 'Product',
          quantity: item.quantity,
          price: parseFloat(item.price)
        })),
        invoicePDFBuffer: cancelInvoicePDF
      }).catch(error => {
        console.error("Email error (non-blocking):", error.message);
      });

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
      shippingMethodId, // Add shipping method ID
      gstId, // Add GST ID
      country,
      city,
      zipCode,
      state,
      mobileNumber
    } = request.body;

    // Validation
    if (!items || items.length === 0) {
      return reply.status(400).send({ success: false, message: "Order items are required" });
    }

    if (!customerName || !customerEmail || !customerPhone) {
      return reply.status(400).send({ success: false, message: "Customer name, email, and phone are required" });
    }

    if (!shippingAddress || !paymentMethod || !shippingMethodId) {
      return reply.status(400).send({ success: false, message: "Shipping address, payment method, and shipping method are required" });
    }

    // state and country are optional for now (will be required after migration)

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail)) {
      return reply.status(400).send({ success: false, message: "Invalid email address" });
    }

    let sellerNotifications = new Map();
    const orderItems = [];
    const cartItems = []; // Build cart-like structure for calculations

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

      orderItems.push({
        productId: product.id,
        quantity,
        price: itemPrice
      });

      // Build cart-like structure for total calculations
      cartItems.push({
        product: product,
        quantity: quantity
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
      sellerData.totalAmount += itemPrice * quantity;
      sellerData.products.push({
        productId: product.id,
        title: product.title,
        quantity,
        price: itemPrice
      });
    }

    // Calculate proper totals including shipping and GST
    const cartCalculations = await calculateCartTotals(cartItems, shippingMethodId, gstId);
    
    // Get shipping method details
    const shippingMethod = await prisma.shippingMethod.findUnique({
      where: { id: shippingMethodId, isActive: true }
    });

    if (!shippingMethod) {
      return reply.status(400).send({ success: false, message: "Invalid or inactive shipping method" });
    }

    const totalAmount = parseFloat(cartCalculations.grandTotal);

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

      // Create order without userId (guest order) with shipping/GST details
      const newOrder = await tx.order.create({
        data: {
          totalAmount,
          shippingAddress: typeof shippingAddress === 'string' ? { address: shippingAddress } : {
            ...shippingAddress,
            // Include order breakdown for invoice purposes
            orderSummary: {
              subtotal: cartCalculations.subtotal,
              shippingCost: cartCalculations.shippingCost,
              gstPercentage: cartCalculations.gstPercentage,
              gstAmount: cartCalculations.gstAmount,
              grandTotal: cartCalculations.grandTotal,
              shippingMethod: {
                id: shippingMethod.id,
                name: shippingMethod.name,
                cost: shippingMethod.cost,
                estimatedDays: shippingMethod.estimatedDays
              },
              gstDetails: cartCalculations.gstDetails
            }
          },
          shippingAddressLine: typeof shippingAddress === 'string' ? shippingAddress : shippingAddress?.addressLine,
          shippingCity: city,
          shippingState: state,
          shippingZipCode: zipCode,
          shippingCountry: country,
          shippingPhone: mobileNumber || customerPhone,
          paymentMethod,
          status: "CONFIRMED",
          customerName,
          customerEmail,
          customerPhone: mobileNumber || customerPhone || '',
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
      shippingAddress: shippingAddress, // Original shipping address without order summary
      paymentMethod,
      customerPhone,
      isGuest: true,
      // Include order breakdown for invoice
      orderSummary: {
        subtotal: cartCalculations.subtotal,
        shippingCost: cartCalculations.shippingCost,
        gstPercentage: cartCalculations.gstPercentage,
        gstAmount: cartCalculations.gstAmount,
        grandTotal: cartCalculations.grandTotal,
        shippingMethod: {
          name: shippingMethod.name,
          cost: shippingMethod.cost,
          estimatedDays: shippingMethod.estimatedDays
        }
      }
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
      orderSummary: {
        subtotal: cartCalculations.subtotal,
        shippingCost: cartCalculations.shippingCost,
        gstPercentage: cartCalculations.gstPercentage,
        gstAmount: cartCalculations.gstAmount,
        totalAmount: cartCalculations.grandTotal,
        shippingMethod: {
          name: shippingMethod.name,
          estimatedDays: shippingMethod.estimatedDays
        }
      },
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
        shippingAddressLine: order.shippingAddressLine,
        shippingCity: order.shippingCity,
        shippingState: order.shippingState,
        shippingZipCode: order.shippingZipCode,
        shippingCountry: order.shippingCountry,
        shippingPhone: order.shippingPhone,
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

// ─── Invoice PDF Helper ────────────────────────────────────────────
// Generates an invoice PDF buffer for any order (no status restriction)
const generateInvoiceBuffer = (order) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(20).text('ALPA MARKETPLACE', 50, 50)
       .fontSize(10).text('Your Cultural Marketplace', 50, 75).moveDown();

    // Invoice title
    doc.fontSize(16).text('INVOICE', 50, 120)
       .fontSize(12)
       .text(`Invoice #: ${order.id}`, 50, 145)
       .text(`Date: ${new Date(order.createdAt).toLocaleDateString()}`, 50, 160)
       .text(`Status: ${order.status}`, 50, 175);

    // Customer details
    doc.fontSize(14).text('Bill To:', 50, 210)
       .fontSize(12)
       .text(order.customerName || '', 50, 230)
       .text(order.customerEmail || '', 50, 245)
       .text(order.shippingPhone || order.customerPhone || '', 50, 260);

    // Shipping address
    doc.fontSize(14).text('Ship To:', 300, 210).fontSize(12);
    if (order.shippingAddressLine || order.shippingCity) {
      doc.text(order.shippingAddressLine || '', 300, 230)
         .text(`${order.shippingCity || ''}, ${order.shippingState || ''}`, 300, 245)
         .text(order.shippingZipCode || '', 300, 260)
         .text(order.shippingCountry || '', 300, 275);
    }

    // Items table
    const tableTop = 320;
    doc.fontSize(12)
       .text('Item', 50, tableTop).text('Quantity', 250, tableTop)
       .text('Unit Price', 350, tableTop).text('Total', 450, tableTop);
    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

    let yPos = tableTop + 30;
    let subtotal = 0;
    (order.items || []).forEach(item => {
      const lineTotal = Number(item.price) * item.quantity;
      subtotal += lineTotal;
      doc.text(item.product?.title || 'Product', 50, yPos)
         .text(item.quantity.toString(), 250, yPos)
         .text(`$${Number(item.price).toFixed(2)}`, 350, yPos)
         .text(`$${lineTotal.toFixed(2)}`, 450, yPos);
      yPos += 20;
    });

    yPos += 10;
    doc.moveTo(50, yPos).lineTo(550, yPos).stroke();
    yPos += 15;

    // Coupon / discount line
    if (order.discountAmount && parseFloat(order.discountAmount) > 0) {
      doc.fontSize(12)
         .text(`Coupon (${order.couponCode || ''}) Discount:`, 300, yPos)
         .text(`-$${parseFloat(order.discountAmount).toFixed(2)}`, 450, yPos);
      yPos += 20;
    }

    doc.fontSize(12).text('Subtotal:', 350, yPos).text(`$${subtotal.toFixed(2)}`, 450, yPos);
    yPos += 20;
    doc.fontSize(14).text('Total Amount:', 350, yPos).text(`$${Number(order.totalAmount).toFixed(2)}`, 450, yPos);

    yPos += 40;
    doc.fontSize(12).text(`Payment Method: ${order.paymentMethod || 'N/A'}`, 50, yPos);
    yPos += 60;
    doc.fontSize(10)
       .text('Thank you for your business!', 50, yPos)
       .text('For questions about this invoice, contact support@alpa.com', 50, yPos + 15);

    doc.end();
  });
};

// Download Invoice as PDF
exports.downloadInvoice = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const userRole = request.user.role;
    const { orderId } = request.params;

    // Build query based on user role
    let orderQuery = {
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                price: true,
                category: true,
                sellerId: true  // Include sellerId for authorization
              }
            }
          }
        },
        user: {
          select: {
            name: true,
            email: true,
            phone: true
          }
        }
      }
    };

    // Apply role-based access control
    if (userRole === 'USER') {
      // Customers can only access their own orders
      orderQuery.where.userId = userId;
    } else if (userRole === 'SELLER') {
      // Sellers can access orders containing their products
      orderQuery.where.items = {
        some: {
          product: {
            sellerId: userId
          }
        }
      };
    }
    // Admins can access all orders (no additional where clause)

    // Get order with all necessary details
    const order = await prisma.order.findFirst(orderQuery);

    if (!order) {
      return reply.status(404).send({ 
        success: false, 
        message: "Order not found or you don't have permission to access this order" 
      });
    }

    // Check if order status is DELIVERED
    if (!['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'].includes(order.status)) {
      return reply.status(400).send({ 
        success: false, 
        message: `Invoice is not available for orders with status: ${order.status}` 
      });
    }

    // Generate PDF
    const pdfBuffer = await generateInvoiceBuffer(order);

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="invoice-${order.id}.pdf"`);
    return reply.send(pdfBuffer);
  } catch (error) {
    console.error("Download invoice error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// Download Guest Order Invoice as PDF
exports.downloadGuestInvoice = async (request, reply) => {
  try {
    const { orderId, customerEmail } = request.query;

    if (!orderId || !customerEmail) {
      return reply.status(400).send({ 
        success: false, 
        message: "Order ID and customer email are required" 
      });
    }

    // Get order with verification using email
    const order = await prisma.order.findFirst({
      where: { 
        id: orderId,
        customerEmail: customerEmail // Verify with guest email
      },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                price: true,
                category: true
              }
            }
          }
        }
      }
    });

    if (!order) {
      return reply.status(404).send({ 
        success: false, 
        message: "Order not found or email doesn't match" 
      });
    }

    // Check if order status is DELIVERED
    if (order.status !== 'DELIVERED') {
      return reply.status(400).send({ 
        success: false, 
        message: `Invoice can only be downloaded when order status is DELIVERED. Current status: ${order.status}` 
      });
    }

    // Create PDF document
    const doc = new PDFDocument({ margin: 50 });
    
    // Set response headers for PDF download
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="invoice-${order.id}.pdf"`);
    
    // Create buffer to collect PDF data
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    
    // Return the PDF when it's finished
    const pdfPromise = new Promise((resolve, reject) => {
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        reply.send(pdfBuffer);
        resolve();
      });
      
      doc.on('error', reject);
    });

    // Add company header
    doc.fontSize(20)
       .text('ALPA MARKETPLACE', 50, 50)
       .fontSize(10)
       .text('Your Cultural Marketplace', 50, 75)
       .moveDown();

    // Add invoice title and details
    doc.fontSize(16)
       .text('INVOICE', 50, 120)
       .fontSize(12)
       .text(`Invoice #: ${order.id}`, 50, 145)
       .text(`Date: ${new Date(order.createdAt).toLocaleDateString()}`, 50, 160)
       .text(`Status: ${order.status}`, 50, 175);

    // Customer details
    doc.fontSize(14)
       .text('Bill To:', 50, 210)
       .fontSize(12)
       .text(`${order.customerName}`, 50, 230)
       .text(`${order.customerEmail}`, 50, 245)
       .text(`${order.shippingPhone || order.customerPhone}`, 50, 260);

    // Shipping address - Use new specific fields if available
    doc.fontSize(14)
       .text('Ship To:', 300, 210)
       .fontSize(12);

    if (order.shippingAddressLine || order.shippingCity || order.shippingState) {
       doc.text(`${order.shippingAddressLine || ''}`, 300, 230)
          .text(`${order.shippingCity || ''}, ${order.shippingState || ''}`, 300, 245)
          .text(`${order.shippingZipCode || ''}`, 300, 260)
          .text(`${order.shippingCountry || ''}`, 300, 275);
    } else if (order.shippingAddress) {
      let address;
      try {
        address = typeof order.shippingAddress === 'string' 
          ? JSON.parse(order.shippingAddress) 
          : order.shippingAddress;
      } catch (error) {
        console.warn('Failed to parse shipping address as JSON, using as string:', order.shippingAddress);
        address = { street: order.shippingAddress.toString() };
      }
      
      doc.text(`${address.street || address.address || address.addressLine || address.toString() || ''}`, 300, 230)
         .text(`${address.city || ''}, ${address.state || ''}`, 300, 245)
         .text(`${address.zipCode || address.zip || address.pincode || ''}`, 300, 260)
         .text(`${address.country || ''}`, 300, 275);
    }

    // Items table header
    const tableTop = 320;
    doc.fontSize(12)
       .text('Item', 50, tableTop)
       .text('Quantity', 250, tableTop)
       .text('Unit Price', 350, tableTop)
       .text('Total', 450, tableTop);

    // Draw line under header
    doc.moveTo(50, tableTop + 15)
       .lineTo(550, tableTop + 15)
       .stroke();

    let yPosition = tableTop + 30;
    let subtotal = 0;

    // Add items
    order.items.forEach((item) => {
      const itemTotal = Number(item.price) * item.quantity;
      subtotal += itemTotal;

      doc.text(item.product.title, 50, yPosition)
         .text(item.quantity.toString(), 250, yPosition)
         .text(`$${Number(item.price).toFixed(2)}`, 350, yPosition)
         .text(`$${itemTotal.toFixed(2)}`, 450, yPosition);
      
      yPosition += 20;
    });

    // Add totals
    yPosition += 20;
    doc.moveTo(50, yPosition)
       .lineTo(550, yPosition)
       .stroke();

    yPosition += 20;
    doc.fontSize(12)
       .text('Subtotal:', 350, yPosition)
       .text(`$${subtotal.toFixed(2)}`, 450, yPosition);

    yPosition += 20;
    doc.fontSize(14)
       .text('Total Amount:', 350, yPosition)
       .text(`$${Number(order.totalAmount).toFixed(2)}`, 450, yPosition);

    // Payment method
    yPosition += 40;
    doc.fontSize(12)
       .text(`Payment Method: ${order.paymentMethod || 'N/A'}`, 50, yPosition);

    // Footer
    yPosition += 60;
    doc.fontSize(10)
       .text('Thank you for your business!', 50, yPosition)
       .text('For questions about this invoice, contact support@alpa.com', 50, yPosition + 15);

      // Finalize PDF
      doc.end();
      return pdfPromise;
  } catch (error) {
    console.error("Download guest invoice error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};


