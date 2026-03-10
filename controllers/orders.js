const prisma = require("../config/prisma");
const { checkInventory } = require("../utils/checkInventory");
const { 
  sendOrderConfirmationEmail, 
  sendOrderStatusEmail,
  sendSellerOrderNotificationEmail,
  sendAdminNewOrderEmail,
  sendSellerLowStockEmail,
  sendSellerOrderStatusEmail,
  sendAdminOrderStatusEmail
} = require("../utils/emailService");
const {
  notifyCustomerOrderStatusChange,
  notifySellerNewOrder,
  notifyAdminNewOrder,
  notifySellerLowStock,
  notifyAdminOrderStatusChange,
  notifySellerOrderStatusChange
} = require("./notification");
const { createOrderNotification } = require("./orderNotification");
const { calculateCartTotals } = require("./cart");
const { normalizeOrderStatus, validateStatusTransition } = require("../utils/orderStatusRules");
const { createCommissionEarned } = require("./commission");
const PDFDocument = require('pdfkit');

// ─── Low Stock Alert Helper ───────────────────────────────────────────────────
// Checks each ordered product's stock after decrement.
// If stock <= 2: deactivates the product and fires notification + email (non-blocking).
const LOW_STOCK_THRESHOLD = 2;

const handleLowStockAlerts = async (productIds) => {
  try {
    // Raw SQL — avoids Prisma client isActive field awareness issues
    // and safely handles the id list via a loop (no ANY() serialisation bug)
    for (const productId of productIds) {
      const rows = await prisma.$queryRaw`
        SELECT p.id, p.title, p.stock, p."sellerId",
               u.email AS "sellerEmail", u.name AS "sellerName"
        FROM "products" p
        JOIN "users" u ON u.id = p."sellerId"
        WHERE p.id = ${productId}
          AND p."isActive" = true
          AND p.stock <= ${LOW_STOCK_THRESHOLD}
      `;

      if (!rows || rows.length === 0) continue;
      const product = rows[0];

      // Deactivate
      await prisma.$executeRaw`
        UPDATE "products"
        SET "isActive" = false, status = 'INACTIVE'
        WHERE id = ${product.id}
      `;
      console.log(`⚠️  Product "${product.title}" deactivated — stock: ${product.stock}`);

      // In-app notification (non-blocking)
      notifySellerLowStock(
        product.sellerId,
        product.id,
        product.title,
        Number(product.stock)
      ).catch(err => console.error("Low stock notification error:", err.message));

      // Email alert (non-blocking)
      if (product.sellerEmail) {
        sendSellerLowStockEmail(
          product.sellerEmail,
          product.sellerName || "Seller",
          product.title,
          Number(product.stock),
          product.id
        ).then(result => {
          if (!result.success) console.warn(`⚠️  [Low Stock] Email not sent to ${product.sellerEmail}: ${result.error}`);
          else console.log(`✅ [Low Stock] Email sent to ${product.sellerEmail} for "${product.title}"`);
        }).catch(err => console.error("Low stock email error:", err.message));
      } else {
        console.warn(`⚠️  [Low Stock] No email address for seller ${product.sellerId} — email skipped`);
      }
    }
  } catch (err) {
    console.error("handleLowStockAlerts error (non-fatal):", err.message);
  }
};

// Export so the admin controller can reuse the same logic
module.exports.handleLowStockAlerts = handleLowStockAlerts;
// ─────────────────────────────────────────────────────────────────────────────

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

    // Only Stripe and PayPal are accepted — COD is not supported
    const ALLOWED_PAYMENT_METHODS = ['STRIPE', 'PAYPAL'];
    if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod.toUpperCase())) {
      return reply.status(400).send({
        success: false,
        message: `Payment method '${paymentMethod}' is not supported. Accepted methods: Stripe, PayPal`
      });
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
      if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
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
          products: [],
          sellerName: product.sellerName || null  // stored at product creation time
        });
      }
      const sellerData = sellerNotifications.get(product.sellerId);
      // Keep the most recent non-null sellerName we see
      if (product.sellerName && !sellerData.sellerName) sellerData.sellerName = product.sellerName;
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
      // Deduct stock — re-validate inside the transaction to prevent race conditions
      for (const item of cart.items) {
        // Atomic decrement only if sufficient stock exists
        const result = await tx.$executeRaw`
          UPDATE "products"
          SET stock = stock - ${item.quantity}
          WHERE id = ${item.productId} AND stock >= ${item.quantity}
        `;
        if (result === 0) {
          // Another concurrent request already consumed the stock
          const current = await tx.product.findUnique({
            where: { id: item.productId },
            select: { title: true, stock: true }
          });
          throw new Error(
            `Insufficient stock for "${current?.title ?? item.productId}". Available: ${current?.stock ?? 0}, Requested: ${item.quantity}`
          );
        }
      }

      // Increment coupon usageCount inside the transaction (atomic)
      if (appliedCoupon) {
        await tx.coupon.update({
          where: { id: appliedCoupon.id },
          data: { usageCount: { increment: 1 } }
        });
      }

      // Create parent order (customer's overall order)
      const parentOrder = await tx.order.create({
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
          overallStatus: "CONFIRMED",
          customerName: user.name,
          customerEmail: user.email,
          customerPhone: mobileNumber || user.phone || ''
        }
      });

      // Create sub-orders for each seller with their specific products
      const createdSubOrders = [];
      for (const [sellerId, sellerData] of sellerNotifications) {
        // Create sub-order for this seller
        const subOrder = await tx.subOrder.create({
          data: {
            parentOrderId: parentOrder.id,
            sellerId: sellerId,
            subtotal: sellerData.totalAmount,
            status: "CONFIRMED"
          }
        });

        // Create order items for this sub-order
        const sellerItemsToCreate = cart.items
          .filter(item => item.product.sellerId === sellerId)
          .map(item => ({
            subOrderId: subOrder.id,
            productId: item.productId,
            quantity: item.quantity,
            price: Number(item.product.price)
          }));

        await tx.orderItem.createMany({
          data: sellerItemsToCreate
        });

        createdSubOrders.push({
          ...subOrder,
          items: sellerItemsToCreate,
          sellerId: sellerId
        });
      }

      // Clear cart
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id }
      });

      return {
        parentOrder,
        subOrders: createdSubOrders
      };
    });

    console.log(`✅ Parent Order created: ${order.parentOrder.id} with ${order.subOrders.length} sub-orders`);
    // Stock broadcasts are handled automatically by the Prisma middleware
    // in config/prisma.js — no manual broadcast needed here.

    // Check for low stock on all ordered products and deactivate + alert if <= 2
    handleLowStockAlerts(cart.items.map(i => i.productId));

    // ── Commission Earned — record 10 % platform fee per seller (non-blocking) ─
    for (const [sellerId, sellerData] of sellerNotifications) {
      // Find the sub-order for this seller
      const sellerSubOrder = order.subOrders.find(sub => sub.sellerId === sellerId);
      createCommissionEarned({
        orderId: sellerSubOrder?.id, // Use sub-order ID for commission tracking
        sellerId,
        orderValue: sellerData.totalAmount,
        customerName: user.name,
        customerEmail: user.email,
        customerId: userId || null,
        sellerName: sellerData.sellerName || null
      }).catch(err => console.error(`Commission earned error (seller ${sellerId}):`, err.message));
    }
    // ──────────────────────────────────────────────────────────────────────────

    // Get seller names (DB lookup for accurate name) + product titles
    const sellerIdList = [...sellerNotifications.keys()];
    const sellerNameMap = new Map();
    await Promise.all(sellerIdList.map(async sid => {
      const s = await prisma.user.findUnique({
        where: { id: sid },
        select: { name: true, sellerProfile: { select: { storeName: true, businessName: true } } }
      });
      sellerNameMap.set(sid, s?.name || s?.sellerProfile?.storeName || s?.sellerProfile?.businessName || 'Unknown');
    }));
    const sellerNameList = [...sellerNameMap.values()];
    const allProductTitles = [];
    for (const [, sellerData] of sellerNotifications) {
      if (sellerData.products) {
        allProductTitles.push(...sellerData.products.map(p => p.title).filter(Boolean));
      }
    }

    // Create notifications for parent order
    const orderNotificationData = {
      customerName: user.name,
      sellerName: sellerNameList.length > 0 ? sellerNameList.join(', ') : 'Unknown',
      totalAmount: totalAmount.toFixed(2),
      itemCount: cart.items.length,
      productNames: allProductTitles,
      orderId: order.parentOrder.id
    };

    // Notify admins about new order
    notifyAdminNewOrder(order.parentOrder.id, orderNotificationData).catch(error => {
      console.error("Admin notification error (non-blocking):", error.message);
    });

    // Notify each seller about the new order (fired before reply — guaranteed delivery)
    for (const [sellerId, sellerData] of sellerNotifications) {
      notifySellerNewOrder(sellerId, order.id, {
        customerName: user.name,
        totalAmount: sellerData.totalAmount.toFixed(2),
        itemCount: sellerData.productCount,
        productNames: sellerData.products.map(p => p.title).filter(Boolean)
      }).catch(error => {
        console.error(`Seller order notification error (sellerId=${sellerId}):`, error.message);
      });
    }

    // Notify customer about their placed order (fired before reply — guaranteed delivery)
    notifyCustomerOrderStatusChange(userId, order.id, 'confirmed', {
      totalAmount: totalAmount.toFixed(2),
      itemCount: order.items.length,
      productNames: allProductTitles
    }).catch(error => {
      console.error('Customer order placed notification error:', error.message);
    });

    // ── Fire all emails & notifications in background (non-blocking) ────────
    // Reply is sent immediately below; PDF generation + all outbound calls
    // run in the background so they never delay the API response.
    ;(async () => {
      try {
        // 1. Customer confirmation email (invoice download link is in the email)
        if (user.email) {
          console.log(`📧 Sending order confirmation email to customer: ${user.email}`);
          try {
            const emailResult = await sendOrderConfirmationEmail(user.email, user.name, {
              orderId: order.id,
              totalAmount,
              itemCount: order.items.length,
              products: order.items.map(item => ({
                title: item.product.title,
                quantity: item.quantity,
                price: item.price
              })),
              shippingAddress,
              customerPhone: order.customerPhone || mobileNumber,
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
              }
            });
            if (emailResult?.success) {
              console.log(`✅ Order confirmation email sent to ${user.email}`);
            } else {
              console.error(`❌ Order confirmation email failed for ${user.email}:`, emailResult?.error);
            }
          } catch (emailErr) {
            console.error(`❌ Order confirmation email error for ${user.email}:`, emailErr.message);
          }
        }

        // 2. Seller emails + SLA notifications — all DB lookups in parallel
        await Promise.all([...sellerNotifications.entries()].map(async ([sellerId, sellerData]) => {
          try {
            const seller = await prisma.user.findUnique({
              where: { id: sellerId },
              include: { sellerProfile: true }
            });
            if (seller) {
              createOrderNotification(order.id, sellerId, 'ORDER_PROCESSING', 'HIGH', {
                message: `New order received from ${user.name}`,
                notes: `${sellerData.productCount} item(s), Total: $${sellerData.totalAmount.toFixed(2)}`
              }).catch(e => console.error("SLA notification error:", e.message));
              // In-app notification already fired before reply — only SLA + email needed here
            }
            if (seller && seller.email) {
              const sellerName = seller.sellerProfile?.storeName || seller.sellerProfile?.businessName || seller.name || 'Seller';
              console.log(`📧 Sending order notification email to seller: ${seller.email}`);
              try {
                const sellerEmailResult = await sendSellerOrderNotificationEmail(seller.email, sellerName, {
                  orderId: order.id,
                  productCount: sellerData.productCount,
                  totalAmount: sellerData.totalAmount,
                  products: sellerData.products,
                  shippingAddress,
                  paymentMethod,
                  customerName: user.name,
                  customerEmail: user.email,
                  customerPhone: user.phone
                });
                if (sellerEmailResult?.success) {
                  console.log(`✅ Seller order email sent to ${seller.email}`);
                } else {
                  console.error(`❌ Seller order email failed for ${seller.email}:`, sellerEmailResult?.error);
                }
              } catch (emailErr) {
                console.error(`❌ Seller order email error for ${seller.email}:`, emailErr.message);
              }
            } else {
              console.warn(`⚠️  No email for seller ${sellerId} — order email skipped`);
            }
          } catch (err) {
            console.error(`Error notifying seller ${sellerId}:`, err.message);
          }
        }));

        // 3. Admin order emails — notify SUPER_ADMIN only
        try {
          const admins = await prisma.user.findMany({
            where: { role: 'SUPER_ADMIN' },
            select: { email: true, name: true }
          });
          const allItems = order.items.map(item => ({
            title: item.product?.title || item.productId,
            quantity: item.quantity,
            price: item.price
          }));
          for (const admin of admins) {
            if (admin.email) {
              try {
                const adminEmailResult = await sendAdminNewOrderEmail(admin.email, admin.name || 'Admin', {
                  orderId: order.id,
                  customerName: user.name,
                  customerEmail: user.email,
                  customerPhone: user.phone,
                  sellerNames: sellerNameList.join(', ') || 'Unknown',
                  totalAmount,
                  paymentMethod,
                  items: allItems
                });
                if (adminEmailResult?.success) {
                  console.log(`✅ Admin order email sent to ${admin.email}`);
                } else {
                  console.error(`❌ Admin order email failed for ${admin.email}:`, adminEmailResult?.error);
                }
              } catch (adminEmailErr) {
                console.error(`❌ Admin order email error for ${admin.email}:`, adminEmailErr.message);
              }
            }
          }
        } catch (adminEmailListErr) {
          console.error('Error fetching admins for order email:', adminEmailListErr.message);
        }
      } catch (bgErr) {
        console.error('Background notification error:', bgErr.message);
      }
    })();

    return reply.status(200).send({
      success: true,
      message: "Order placed successfully! Confirmation email sent.",
      orderId: order.parentOrder.id,
      subOrders: order.subOrders.map(sub => ({
        id: sub.id,
        sellerId: sub.sellerId, 
        subtotal: sub.subtotal,
        status: sub.status
      })),
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
    // Insufficient stock is a client error (400), not a server error
    if (error.message && error.message.startsWith("Insufficient stock")) {
      return reply.status(400).send({ success: false, message: error.message });
    }
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
        subOrders: {
          include: {
            seller: {
              select: {
                id: true,
                name: true
              }
            },
            sellerProfile: {
              select: {
                businessName: true,
                storeName: true
              }
            },
            items: {
              include: {
                product: {
                  select: {
                    id: true,
                    title: true,
                    images: true,
                    price: true,
                    sellerId: true
                  }
                }
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Transform to maintain backward compatibility while showing sub-order details
    const transformedOrders = orders.map(order => {
      // Aggregate all items from sub-orders
      const allItems = order.subOrders.flatMap(subOrder => 
        subOrder.items.map(item => ({
          ...item,
          subOrderId: subOrder.id,
          subOrderStatus: subOrder.status,
          sellerId: subOrder.sellerId,
          sellerName: subOrder.sellerProfile?.businessName || subOrder.sellerProfile?.storeName || subOrder.seller?.name || 'Unknown Seller',
          trackingNumber: subOrder.trackingNumber,
          estimatedDelivery: subOrder.estimatedDelivery
        }))
      );

      // Determine overall status based on sub-orders
      let computedStatus;
      
      if (order.subOrders.length === 0) {
        // No sub-orders yet (legacy orders) - use the overallStatus or status field
        computedStatus = order.overallStatus || order.status || 'CONFIRMED';
      } else {
        // Has sub-orders - compute status from sub-orders
        const subOrderStatuses = order.subOrders.map(sub => sub.status);
        
        if (subOrderStatuses.every(status => status === 'DELIVERED')) {
          computedStatus = 'DELIVERED';
        } else if (subOrderStatuses.every(status => status === 'CANCELLED')) {
          computedStatus = 'CANCELLED';
        } else if (subOrderStatuses.some(status => status === 'SHIPPED')) {
          computedStatus = 'SHIPPED';  
        } else if (subOrderStatuses.some(status => status === 'PROCESSING')) {
          computedStatus = 'PROCESSING';
        } else {
          computedStatus = subOrderStatuses[0] || 'CONFIRMED';
        }
      }

      return {
        id: order.id,
        userId: order.userId,
        totalAmount: order.totalAmount,
        status: computedStatus, // Use computed overall status, not database status
        trackingNumber: order.trackingNumber,
        estimatedDelivery: order.estimatedDelivery,
        statusReason: order.statusReason,
        paymentMethod: order.paymentMethod,
        stripePaymentIntentId: order.stripePaymentIntentId,
        paypalOrderId: order.paypalOrderId,
        paymentStatus: order.paymentStatus,
        couponCode: order.couponCode,
        discountAmount: order.discountAmount,
        originalTotal: order.originalTotal,
        shippingAddress: order.shippingAddress,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        shippingAddressLine: order.shippingAddressLine,
        shippingCity: order.shippingCity,
        shippingState: order.shippingState,
        shippingZipCode: order.shippingZipCode,
        shippingCountry: order.shippingCountry,
        shippingPhone: order.shippingPhone,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        items: allItems,
        subOrders: order.subOrders.map(sub => ({
          id: sub.id,
          sellerId: sub.sellerId,
          sellerName: sub.seller?.businessName || sub.seller?.name || 'Unknown Seller',
          status: sub.status,
          trackingNumber: sub.trackingNumber,
          estimatedDelivery: sub.estimatedDelivery,
          subtotal: sub.subtotal,
          itemCount: sub.items.length,
          items: sub.items.map(item => ({
            id: item.id,
            productId: item.productId,
            productTitle: item.product?.title || 'Product',
            productImages: item.product?.images || [],
            quantity: item.quantity,
            price: item.price
          }))
        }))
      };
    });

    return reply.status(200).send({ success: true, orders: transformedOrders });
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
    const { reason, statusReason } = request.body || {};

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: { select: { id: true, title: true, price: true, sellerId: true } }
          }
        }
      }
    });

    if (!order) return reply.status(404).send({ success: false, message: "Order not found" });

    if (order.userId !== userId) return reply.status(403).send({ success: false, message: "Not authorized" });

    if (!['PENDING', 'CONFIRMED'].includes(order.status)) {
      return reply.status(400).send({ success: false, message: "Order cannot be cancelled" });
    }

    const finalReason = (statusReason || reason || '').trim();

    if (!finalReason) {
      return reply.status(400).send({
        success: false,
        message: "Reason is required for order cancellation request"
      });
    }

    const transitionValidation = validateStatusTransition({
      currentStatus: order.status === 'PENDING' ? 'CONFIRMED' : order.status,
      nextStatus: 'CANCELLED',
      reason: finalReason
    });

    if (!transitionValidation.isValid) {
      return reply.status(400).send({
        success: false,
        message: transitionValidation.message
      });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "CANCELLED",
        statusReason: finalReason
      }
    });

    // Send email notification about cancellation
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    // ── In-app notifications — always fire regardless of email ─────────────
    // Notify the customer
    notifyCustomerOrderStatusChange(userId, orderId, "cancelled", {
      totalAmount: order.totalAmount.toString(),
      itemCount: order.items?.length || 0,
      reason: finalReason
    }).catch(error => {
      console.error("Customer cancel notification error (non-blocking):", error.message);
    });

    // Notify all sellers whose products are in this cancelled order (in-app + email)
    // Also collect seller names so the admin notification can include them.
    const cancelledSellerIds = [...new Set(
      order.items.map(item => item.product?.sellerId).filter(Boolean)
    )];
    const readableOrderId = orderId.slice(-8).toUpperCase();
    const cancelledSellerNames = [];
    await Promise.all(cancelledSellerIds.map(async (sellerId) => {
      const sellerProducts = order.items
        .filter(item => item.product?.sellerId === sellerId)
        .map(item => item.product?.title || 'Product');

      // Fetch seller once — used for both the name and email
      const sellerUser = await prisma.user.findUnique({
        where: { id: sellerId },
        select: { email: true, name: true, sellerProfile: { select: { storeName: true, businessName: true } } }
      }).catch(() => null);

      const resolvedSellerName = sellerUser?.sellerProfile?.storeName
        || sellerUser?.sellerProfile?.businessName
        || sellerUser?.name
        || 'Unknown';
      cancelledSellerNames.push(resolvedSellerName);

      prisma.notification.create({
        data: {
          userId: sellerId,
          title: 'Order Cancelled by Customer',
          message: `Customer ${order.customerName || 'Customer'} cancelled order #${readableOrderId}. Items: ${sellerProducts.join(', ')}. Reason: ${finalReason}`,
          type: 'ORDER_CANCELLED',
          relatedId: orderId,
          relatedType: 'order',
          metadata: {
            orderId,
            reason: finalReason,
            customerName: order.customerName,
            cancelledProducts: sellerProducts
          }
        }
      }).catch(err => console.error(`Seller cancel notification error (sellerId=${sellerId}):`, err.message));

      if (sellerUser?.email) {
        sendSellerOrderStatusEmail(sellerUser.email, resolvedSellerName, {
          orderId, status: 'cancelled', updatedBy: 'Customer',
          customerName: order.customerName || 'Customer',
          totalAmount: order.totalAmount, reason: finalReason
        }).catch(err => console.error(`Seller cancel email error (sellerId=${sellerId}):`, err.message));
      }
    }));

    const cancelledSellerNameStr = cancelledSellerNames.join(', ') || 'Unknown';

    // Notify all admins (in-app + email) — now includes seller name(s)
    notifyAdminOrderStatusChange(orderId, 'cancelled', {
      customerName: order.customerName || 'Customer',
      sellerName: cancelledSellerNameStr,
      totalAmount: order.totalAmount.toString(),
      itemCount: order.items?.length || 0,
      reason: finalReason,
      updatedBy: 'Customer'
    }).catch(err => console.error("Admin cancel in-app notification error (non-blocking):", err.message));
    prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { email: true, name: true } })
      .then(admins => {
        for (const admin of admins) {
          if (admin.email) {
            sendAdminOrderStatusEmail(admin.email, admin.name, {
              orderId, status: 'cancelled', updatedBy: 'Customer',
              customerName: order.customerName || 'Customer',
              sellerName: cancelledSellerNameStr,
              totalAmount: order.totalAmount, reason: finalReason
            }).catch(err => console.error("Admin cancel email error (non-blocking):", err.message));
          }
        }
      }).catch(err => console.error("Admin lookup error for cancel email (non-blocking):", err.message));
    // ─────────────────────────────────────────────────────────────────────────

    // ── Email (only when email address is available) ──────────────────────
    if (user && user.email) {
      console.log(`📧 Sending cancellation email to customer: ${user.email}`);

      sendOrderStatusEmail(user.email, user.name, {
        orderId,
        status: "cancelled",
        reason: finalReason,
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
        isGuest: false,
        products: order.items?.map(item => ({
          title: item.product?.title || 'Product',
          quantity: item.quantity,
          price: parseFloat(item.price)
        }))
      }).catch(error => {
        console.error("Email error (non-blocking):", error.message);
      });
    }

    return reply.status(200).send({ success: true, message: "Order cancelled successfully. Email notification sent." });

  } catch (error) {
    console.error("Cancel order error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

const formatRefundRequestFromTicket = (ticket) => {
  const message = ticket.message || '';
  const orderIdMatch = message.match(/Order ID:\s*(.+)/i);
  const requestTypeMatch = message.match(/Request Type:\s*(.+)/i);
  const reasonMatch = message.match(/Reason:\s*([\s\S]+)/i);

  return {
    id: ticket.id,
    requestId: ticket.id,
    orderId: ticket.orderId || orderIdMatch?.[1]?.trim() || null,
    requestType: ticket.requestType || requestTypeMatch?.[1]?.trim() || null,
    reason: reasonMatch?.[1]?.trim() || null,
    guestEmail: ticket.guestEmail || null,
    status: ticket.status,
    priority: ticket.priority,
    adminResponse: ticket.response,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt
  };
};

// USER — REQUEST REFUND / PARTIAL REFUND
exports.requestRefund = async (request, reply) => {
  try {
    const orderId = request.params.id;
    const userId = request.user.userId;
    const { requestType, reason, statusReason } = request.body || {};

    const normalizedRequestType = normalizeOrderStatus(requestType);
    if (!['REFUND', 'PARTIAL_REFUND'].includes(normalizedRequestType)) {
      return reply.status(400).send({
        success: false,
        message: "Invalid requestType. Use: refund or partial_refund"
      });
    }

    const finalReason = (statusReason || reason || '').trim();
    if (!finalReason) {
      return reply.status(400).send({
        success: false,
        message: `Reason is required for ${normalizedRequestType} request`
      });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                sellerId: true,
                title: true
              }
            }
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!order) {
      return reply.status(404).send({ success: false, message: "Order not found" });
    }

    if (order.userId !== userId) {
      return reply.status(403).send({ success: false, message: "Not authorized" });
    }

    if (['CANCELLED', 'REFUND', 'PARTIAL_REFUND'].includes(order.status)) {
      return reply.status(400).send({
        success: false,
        message: `Refund request cannot be initiated for order in ${order.status} status`
      });
    }

    const transitionValidation = validateStatusTransition({
      currentStatus: order.status,
      nextStatus: normalizedRequestType,
      reason: finalReason
    });

    if (!transitionValidation.isValid) {
      return reply.status(400).send({
        success: false,
        message: transitionValidation.message
      });
    }

    const ticketTitle = normalizedRequestType === 'REFUND' ? 'Refund Request' : 'Partial Refund Request';
    const readableOrderId = orderId.slice(-8).toUpperCase();
    const supportTicket = await prisma.supportTicket.create({
      data: {
        userId,
        orderId,
        requestType: normalizedRequestType,
        subject: `${ticketTitle} for Order #${readableOrderId}`,
        message: `Order ID: ${orderId}\nRequest Type: ${normalizedRequestType}\nReason: ${finalReason}`,
        category: 'REFUND_REQUEST',
        priority: 'MEDIUM'
      }
    });

    const sellerIds = [...new Set(order.items.map(item => item.product?.sellerId).filter(Boolean))];
    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      select: { id: true }
    });

    const notificationTitle = `${ticketTitle} Submitted`;
    const notificationMessage = `Customer ${order.customerName || order.user?.name || 'Customer'} requested ${normalizedRequestType} for order #${readableOrderId}.`;
    const metadata = {
      orderId,
      requestType: normalizedRequestType,
      reason: finalReason,
      supportTicketId: supportTicket.id,
      totalAmount: order.totalAmount?.toString()
    };

    // Notify admins
    for (const admin of admins) {
      await prisma.notification.create({
        data: {
          userId: admin.id,
          title: notificationTitle,
          message: notificationMessage,
          type: 'GENERAL',
          relatedId: orderId,
          relatedType: 'order',
          metadata
        }
      });
    }

    // Notify sellers involved in this order
    for (const sellerId of sellerIds) {
      await prisma.notification.create({
        data: {
          userId: sellerId,
          title: notificationTitle,
          message: notificationMessage,
          type: 'GENERAL',
          relatedId: orderId,
          relatedType: 'order',
          metadata
        }
      });
    }

    // Acknowledge customer request
    await prisma.notification.create({
      data: {
        userId,
        title: `${ticketTitle} Received`,
        message: `Your ${normalizedRequestType.toLowerCase()} request for order #${readableOrderId} has been submitted and is under review.`,
        type: 'GENERAL',
        relatedId: orderId,
        relatedType: 'order',
        metadata
      }
    });

    return reply.status(200).send({
      success: true,
      message: `${ticketTitle} submitted successfully`,
      request: {
        id: supportTicket.id,
        orderId,
        requestType: normalizedRequestType,
        reason: finalReason,
        supportTicketId: supportTicket.id,
        status: supportTicket.status,
        createdAt: supportTicket.createdAt
      }
    });
  } catch (error) {
    console.error("Refund request error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// USER — TRACK MY REFUND / PARTIAL REFUND REQUESTS
exports.getMyRefundRequests = async (request, reply) => {
  try {
    const userId = request.user.userId;

    const requests = await prisma.supportTicket.findMany({
      where: {
        userId,
        category: 'REFUND_REQUEST'
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderId: true,
        guestEmail: true,
        requestType: true,
        subject: true,
        message: true,
        status: true,
        priority: true,
        response: true,
        createdAt: true,
        updatedAt: true
      }
    });

    const formattedRequests = requests.map(formatRefundRequestFromTicket);

    return reply.status(200).send({
      success: true,
      requests: formattedRequests,
      count: formattedRequests.length
    });
  } catch (error) {
    console.error('Get refund requests error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// USER — TRACK SINGLE REFUND REQUEST DETAILS
exports.getRefundRequestById = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { requestId } = request.params;

    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id: requestId,
        userId,
        category: 'REFUND_REQUEST'
      },
      select: {
        id: true,
        orderId: true,
        guestEmail: true,
        requestType: true,
        subject: true,
        message: true,
        status: true,
        priority: true,
        response: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!ticket) {
      return reply.status(404).send({
        success: false,
        message: 'Refund request not found'
      });
    }

    return reply.status(200).send({
      success: true,
      request: formatRefundRequestFromTicket(ticket)
    });
  } catch (error) {
    console.error('Get refund request by id error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GUEST — REQUEST REFUND / PARTIAL REFUND
exports.requestGuestRefund = async (request, reply) => {
  try {
    const { orderId, customerEmail, requestType, reason, statusReason } = request.body || {};

    if (!orderId || !customerEmail) {
      return reply.status(400).send({
        success: false,
        message: 'orderId and customerEmail are required'
      });
    }

    const normalizedRequestType = normalizeOrderStatus(requestType);
    if (!['REFUND', 'PARTIAL_REFUND'].includes(normalizedRequestType)) {
      return reply.status(400).send({
        success: false,
        message: 'Invalid requestType. Use: refund or partial_refund'
      });
    }

    const finalReason = (statusReason || reason || '').trim();
    if (!finalReason) {
      return reply.status(400).send({
        success: false,
        message: `Reason is required for ${normalizedRequestType} request`
      });
    }

    const normalizedEmail = customerEmail.trim().toLowerCase();
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                sellerId: true,
                title: true
              }
            }
          }
        }
      }
    });

    if (!order) {
      return reply.status(404).send({ success: false, message: 'Order not found' });
    }

    if (order.userId) {
      return reply.status(400).send({
        success: false,
        message: 'This endpoint is for guest orders only'
      });
    }

    if ((order.customerEmail || '').trim().toLowerCase() !== normalizedEmail) {
      return reply.status(403).send({ success: false, message: 'Email does not match order' });
    }

    if (['CANCELLED', 'REFUND', 'PARTIAL_REFUND'].includes(order.status)) {
      return reply.status(400).send({
        success: false,
        message: `Refund request cannot be initiated for order in ${order.status} status`
      });
    }

    const transitionValidation = validateStatusTransition({
      currentStatus: order.status,
      nextStatus: normalizedRequestType,
      reason: finalReason
    });

    if (!transitionValidation.isValid) {
      return reply.status(400).send({
        success: false,
        message: transitionValidation.message
      });
    }

    const ticketTitle = normalizedRequestType === 'REFUND' ? 'Refund Request' : 'Partial Refund Request';
    const readableOrderId = orderId.slice(-8).toUpperCase();

    const supportTicket = await prisma.supportTicket.create({
      data: {
        userId: null,
        orderId,
        guestEmail: normalizedEmail,
        requestType: normalizedRequestType,
        subject: `${ticketTitle} for Order #${readableOrderId}`,
        message: `Order ID: ${orderId}\nRequest Type: ${normalizedRequestType}\nReason: ${finalReason}`,
        category: 'REFUND_REQUEST',
        priority: 'MEDIUM'
      }
    });

    const sellerIds = [...new Set(order.items.map(item => item.product?.sellerId).filter(Boolean))];
    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      select: { id: true }
    });

    const notificationTitle = `${ticketTitle} Submitted`;
    const notificationMessage = `Guest customer ${order.customerName || 'Customer'} requested ${normalizedRequestType} for order #${readableOrderId}.`;
    const metadata = {
      orderId,
      requestType: normalizedRequestType,
      reason: finalReason,
      supportTicketId: supportTicket.id,
      guestEmail: normalizedEmail,
      totalAmount: order.totalAmount?.toString()
    };

    for (const admin of admins) {
      await prisma.notification.create({
        data: {
          userId: admin.id,
          title: notificationTitle,
          message: notificationMessage,
          type: 'GENERAL',
          relatedId: orderId,
          relatedType: 'order',
          metadata
        }
      });
    }

    for (const sellerId of sellerIds) {
      await prisma.notification.create({
        data: {
          userId: sellerId,
          title: notificationTitle,
          message: notificationMessage,
          type: 'GENERAL',
          relatedId: orderId,
          relatedType: 'order',
          metadata
        }
      });
    }

    return reply.status(200).send({
      success: true,
      message: `${ticketTitle} submitted successfully`,
      request: {
        id: supportTicket.id,
        requestId: supportTicket.id,
        orderId,
        requestType: normalizedRequestType,
        reason: finalReason,
        guestEmail: normalizedEmail,
        status: supportTicket.status,
        createdAt: supportTicket.createdAt
      }
    });
  } catch (error) {
    console.error('Guest refund request error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GUEST — TRACK REFUND REQUESTS BY ORDER + EMAIL
exports.getGuestRefundRequests = async (request, reply) => {
  try {
    const { orderId, customerEmail } = request.query;

    if (!orderId || !customerEmail) {
      return reply.status(400).send({
        success: false,
        message: 'orderId and customerEmail are required'
      });
    }

    const normalizedEmail = customerEmail.trim().toLowerCase();
    const order = await prisma.order.findUnique({ where: { id: orderId } });

    if (!order) {
      return reply.status(404).send({ success: false, message: 'Order not found' });
    }

    if (order.userId) {
      return reply.status(400).send({
        success: false,
        message: 'This endpoint is for guest orders only'
      });
    }

    if ((order.customerEmail || '').trim().toLowerCase() !== normalizedEmail) {
      return reply.status(403).send({ success: false, message: 'Email does not match order' });
    }

    const requests = await prisma.supportTicket.findMany({
      where: {
        category: 'REFUND_REQUEST',
        orderId,
        guestEmail: normalizedEmail
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderId: true,
        guestEmail: true,
        requestType: true,
        subject: true,
        message: true,
        status: true,
        priority: true,
        response: true,
        createdAt: true,
        updatedAt: true
      }
    });

    const formattedRequests = requests.map(formatRefundRequestFromTicket);

    return reply.status(200).send({
      success: true,
      requests: formattedRequests,
      count: formattedRequests.length
    });
  } catch (error) {
    console.error('Get guest refund requests error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GUEST — TRACK SINGLE REFUND REQUEST BY REQUEST ID + ORDER + EMAIL
exports.getGuestRefundRequestById = async (request, reply) => {
  try {
    const { requestId } = request.params;
    const { orderId, customerEmail } = request.query;

    if (!orderId || !customerEmail) {
      return reply.status(400).send({
        success: false,
        message: 'orderId and customerEmail are required'
      });
    }

    const normalizedEmail = customerEmail.trim().toLowerCase();
    const order = await prisma.order.findUnique({ where: { id: orderId } });

    if (!order) {
      return reply.status(404).send({ success: false, message: 'Order not found' });
    }

    if (order.userId) {
      return reply.status(400).send({
        success: false,
        message: 'This endpoint is for guest orders only'
      });
    }

    if ((order.customerEmail || '').trim().toLowerCase() !== normalizedEmail) {
      return reply.status(403).send({ success: false, message: 'Email does not match order' });
    }

    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id: requestId,
        category: 'REFUND_REQUEST',
        orderId,
        guestEmail: normalizedEmail
      },
      select: {
        id: true,
        orderId: true,
        guestEmail: true,
        requestType: true,
        subject: true,
        message: true,
        status: true,
        priority: true,
        response: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!ticket) {
      return reply.status(404).send({
        success: false,
        message: 'Refund request not found'
      });
    }

    return reply.status(200).send({
      success: true,
      request: formatRefundRequestFromTicket(ticket)
    });
  } catch (error) {
    console.error('Get guest refund request by id error:', error);
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

// GUEST CHECKOUT — route removed. No COD. Guests use Stripe via POST /api/payments/guest/create-intent.
// This function is intentionally unreachable via any route.
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
      mobileNumber,
      couponCode        // Optional coupon code
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
          products: [],
          sellerName: product.sellerName || null  // stored at product creation time
        });
      }
      const sellerData = sellerNotifications.get(product.sellerId);
      // Keep the most recent non-null sellerName we see
      if (product.sellerName && !sellerData.sellerName) sellerData.sellerName = product.sellerName;
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
      if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
        return reply.status(400).send({ success: false, message: 'Coupon usage limit has been reached' });
      }
      if (coupon.minCartValue !== null && originalTotal < coupon.minCartValue) {
        return reply.status(400).send({
          success: false,
          message: `Minimum cart value of $${coupon.minCartValue.toFixed(2)} required for this coupon`
        });
      }

      if (coupon.discountType === 'percentage') {
        discountAmount = parseFloat(((originalTotal * coupon.discountValue) / 100).toFixed(2));
        if (coupon.maxDiscount !== null) {
          discountAmount = Math.min(discountAmount, coupon.maxDiscount);
        }
      } else {
        discountAmount = Math.min(coupon.discountValue, originalTotal);
      }

      appliedCoupon = coupon;
    }

    const totalAmount = parseFloat((originalTotal - discountAmount).toFixed(2));
    // ─────────────────────────────────────────────────────────────────────────

    // Create order using transaction
    const order = await prisma.$transaction(async (tx) => {
      // Deduct stock — re-validate inside the transaction to prevent race conditions
      for (const item of orderItems) {
        // Atomic decrement only if sufficient stock exists
        const result = await tx.$executeRaw`
          UPDATE "products"
          SET stock = stock - ${item.quantity}
          WHERE id = ${item.productId} AND stock >= ${item.quantity}
        `;
        if (result === 0) {
          const current = await tx.product.findUnique({
            where: { id: item.productId },
            select: { title: true, stock: true }
          });
          throw new Error(
            `Insufficient stock for "${current?.title ?? item.productId}". Available: ${current?.stock ?? 0}, Requested: ${item.quantity}`
          );
        }
      }

      // Increment coupon usageCount inside the transaction (atomic)
      if (appliedCoupon) {
        await tx.coupon.update({
          where: { id: appliedCoupon.id },
          data: { usageCount: { increment: 1 } }
        });
      }

      // Create order without userId (guest order) with shipping/GST details
      const newOrder = await tx.order.create({
        data: {
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

    // Check for low stock on all ordered products and deactivate + alert if <= 2
    handleLowStockAlerts(orderItems.map(i => i.productId));

    // Get seller names (DB lookup for accurate name) + product titles
    const guestSellerIdList = [...sellerNotifications.keys()];
    const guestSellerNameMap = new Map();
    await Promise.all(guestSellerIdList.map(async sid => {
      const s = await prisma.user.findUnique({
        where: { id: sid },
        select: { name: true, sellerProfile: { select: { storeName: true, businessName: true } } }
      });
      guestSellerNameMap.set(sid, s?.name || s?.sellerProfile?.storeName || s?.sellerProfile?.businessName || 'Unknown');
    }));
    const guestSellerNameList = [...guestSellerNameMap.values()];
    const guestAllProductTitles = [];
    for (const [, sellerData] of sellerNotifications) {
      if (sellerData.products) {
        guestAllProductTitles.push(...sellerData.products.map(p => p.title).filter(Boolean));
      }
    }

    // Create notifications
    const orderNotificationData = {
      customerName,
      sellerName: guestSellerNameList.length > 0 ? guestSellerNameList.join(', ') : 'Unknown',
      totalAmount: totalAmount.toFixed(2),
      itemCount: order.items.length,
      productNames: guestAllProductTitles,
      orderId: order.id
    };

    // Notify admins about new guest order
    notifyAdminNewOrder(order.id, orderNotificationData).catch(error => {
      console.error("Admin notification error (non-blocking):", error.message);
    });

    // Notify each seller about the new guest order (fired before reply — guaranteed delivery)
    for (const [sellerId, sellerData] of sellerNotifications) {
      notifySellerNewOrder(sellerId, order.id, {
        customerName,
        totalAmount: sellerData.totalAmount.toFixed(2),
        itemCount: sellerData.productCount,
        productNames: sellerData.products.map(p => p.title).filter(Boolean)
      }).catch(error => {
        console.error(`Seller order notification error (sellerId=${sellerId}):`, error.message);
      });
    }
    // Guest orders: no in-app customer notification (guest has no user account / userId)
    // Guest receives email confirmation instead.

    // ── Fire all emails & notifications in background (non-blocking) ────────
    ;(async () => {
      try {
        // 1. Guest customer confirmation email (invoice download button is in the email)
        console.log(`📧 Sending order confirmation email to guest customer: ${customerEmail}`);
        try {
          const guestEmailResult = await sendOrderConfirmationEmail(customerEmail, customerName, {
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
            isGuest: true,
            orderSummary: {
              subtotal: cartCalculations.subtotal,
              subtotalExGST: cartCalculations.subtotalExGST,
              shippingCost: cartCalculations.shippingCost,
              gstPercentage: cartCalculations.gstPercentage,
              gstAmount: cartCalculations.gstAmount,
              grandTotal: cartCalculations.grandTotal,
              couponCode: appliedCoupon ? appliedCoupon.code : null,
              discountAmount: discountAmount > 0 ? discountAmount : null,
              shippingMethod: {
                name: shippingMethod.name,
                cost: shippingMethod.cost,
                estimatedDays: shippingMethod.estimatedDays
              }
            }
          });
          if (guestEmailResult?.success) {
            console.log(`✅ Guest order confirmation email sent to ${customerEmail}`);
          } else {
            console.error(`❌ Guest order confirmation email failed for ${customerEmail}:`, guestEmailResult?.error);
          }
        } catch (emailErr) {
          console.error(`❌ Guest order confirmation email error for ${customerEmail}:`, emailErr.message);
        }

        // 2. Seller emails + SLA notifications — all DB lookups in parallel
        await Promise.all([...sellerNotifications.entries()].map(async ([sellerId, sellerData]) => {
          try {
            const seller = await prisma.user.findUnique({
              where: { id: sellerId },
              include: { sellerProfile: true }
            });
            if (seller) {
              createOrderNotification(order.id, sellerId, 'ORDER_PROCESSING', 'HIGH', {
                message: `New guest order received from ${customerName}`,
                notes: `${sellerData.productCount} item(s), Total: $${sellerData.totalAmount.toFixed(2)}`
              }).catch(e => console.error("SLA notification error:", e.message));
            }
            if (seller && seller.email) {
              const sellerName = seller.sellerProfile?.storeName || seller.sellerProfile?.businessName || seller.name || 'Seller';
              console.log(`📧 Sending order notification email to seller: ${seller.email}`);
              try {
                const sellerEmailResult = await sendSellerOrderNotificationEmail(seller.email, sellerName, {
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
                });
                if (sellerEmailResult?.success) {
                  console.log(`✅ Guest seller order email sent to ${seller.email}`);
                } else {
                  console.error(`❌ Guest seller order email failed for ${seller.email}:`, sellerEmailResult?.error);
                }
              } catch (emailErr) {
                console.error(`❌ Guest seller order email error for ${seller.email}:`, emailErr.message);
              }
            } else {
              console.warn(`⚠️  No email for seller ${sellerId} — guest order email skipped`);
            }
          } catch (err) {
            console.error(`Error notifying seller ${sellerId}:`, err.message);
          }
        }));

        // 3. Admin order emails for guest orders
        try {
          const admins = await prisma.user.findMany({
            where: { role: 'SUPER_ADMIN' },
            select: { email: true, name: true }
          });
          const guestSellerNames = [...sellerNotifications.keys()]
            .map(sid => guestSellerNameMap?.get(sid) || 'Unknown')
            .filter(Boolean)
            .join(', ');
          const allItems = order.items.map(item => ({
            title: item.product?.title || item.productId,
            quantity: item.quantity,
            price: item.price
          }));
          for (const admin of admins) {
            if (admin.email) {
              try {
                const adminEmailResult = await sendAdminNewOrderEmail(admin.email, admin.name || 'Admin', {
                  orderId: order.id,
                  customerName,
                  customerEmail,
                  customerPhone,
                  sellerNames: guestSellerNames || 'Unknown',
                  totalAmount,
                  paymentMethod,
                  items: allItems
                });
                if (adminEmailResult?.success) {
                  console.log(`✅ Admin guest order email sent to ${admin.email}`);
                } else {
                  console.error(`❌ Admin guest order email failed for ${admin.email}:`, adminEmailResult?.error);
                }
              } catch (adminEmailErr) {
                console.error(`❌ Admin guest order email error for ${admin.email}:`, adminEmailErr.message);
              }
            }
          }
        } catch (adminEmailListErr) {
          console.error('Error fetching admins for guest order email:', adminEmailListErr.message);
        }
      } catch (bgErr) {
        console.error('Background notification error (guest):', bgErr.message);
      }
    })();

    return reply.status(200).send({
      success: true,
      message: "Guest order placed successfully! Confirmation email sent.",
      orderId: order.id,
      orderSummary: {
        subtotal: cartCalculations.subtotal,
        subtotalExGST: cartCalculations.subtotalExGST,
        shippingCost: cartCalculations.shippingCost,
        gstPercentage: cartCalculations.gstPercentage,
        gstAmount: cartCalculations.gstAmount,
        originalTotal: originalTotal.toFixed(2),
        couponCode: appliedCoupon ? appliedCoupon.code : null,
        discountAmount: discountAmount > 0 ? discountAmount.toFixed(2) : null,
        totalAmount: totalAmount.toFixed(2),
        shippingMethod: {
          name: shippingMethod.name,
          estimatedDays: shippingMethod.estimatedDays
        }
      },
      customerEmail
    });

  } catch (error) {
    console.error("Create guest order error:", error);
    if (error.message && error.message.startsWith("Insufficient stock")) {
      return reply.status(400).send({ success: false, message: error.message });
    }
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

    // Allow invoice download for all active order statuses (not cancelled/refunded)
    if (!['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'].includes(order.status)) {
      return reply.status(400).send({ 
        success: false, 
        message: `Invoice is not available for orders with status: ${order.status}` 
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

// Download Invoice as PDF — public endpoint for email links
// No auth required: orderId is an unguessable CUID.
// GET /api/orders/invoice/public/:orderId
exports.downloadPublicInvoice = async (request, reply) => {
  try {
    const { orderId } = request.params;

    const order = await prisma.order.findFirst({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, title: true, price: true, category: true }
            }
          }
        },
        user: {
          select: { name: true, email: true, phone: true }
        }
      }
    });

    if (!order) {
      return reply.status(404).send({ success: false, message: "Order not found" });
    }

    if (!['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'].includes(order.status)) {
      return reply.status(400).send({
        success: false,
        message: `Invoice is not available for orders with status: ${order.status}`
      });
    }

    const pdfBuffer = await generateInvoiceBuffer(order);

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="invoice-${order.id}.pdf"`);
    return reply.send(pdfBuffer);
  } catch (error) {
    console.error("Download public invoice error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};


