const prisma = require("../config/prisma");
const crypto = require("crypto");
const { checkInventory } = require("../utils/checkInventory");

// ─── Short Display ID Generator ───────────────────────────────────────────────
const DISPLAY_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

async function generateDisplayId() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const bytes = crypto.randomBytes(6);
    let id = '';
    for (let i = 0; i < 6; i++) {
      id += DISPLAY_ID_CHARS[bytes[i] % DISPLAY_ID_CHARS.length];
    }
    const existing = await prisma.order.findUnique({ where: { displayId: id } });
    if (!existing) return id;
  }
  throw new Error('Failed to generate a unique display ID after 10 attempts');
}
// ─────────────────────────────────────────────────────────────────────────────
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

    // Only Stripe is accepted — COD is not supported
    const ALLOWED_PAYMENT_METHODS = ['STRIPE'];
    if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod.toUpperCase())) {
      return reply.status(400).send({
        success: false,
        message: `Payment method '${paymentMethod}' is not supported. Accepted methods: Stripe`
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

    // Generate short alphanumeric display ID for the customer
    const displayId = await generateDisplayId();

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

      // Check if this is a single seller or multi-seller order
      const isMultiSeller = sellerNotifications.size > 1;
      
      if (isMultiSeller) {
        // MULTI-SELLER ORDER: Create parent order + sub-orders
        const parentOrder = await tx.order.create({
          data: {
            displayId,
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
          subOrders: createdSubOrders,
          isMultiSeller: true
        };
      } else {
        // SINGLE SELLER ORDER: Create simple order (no sub-orders needed)
        const [sellerId] = sellerNotifications.keys();
        const singleOrder = await tx.order.create({
          data: {
            displayId,
            userId,
            sellerId, // Link directly to seller
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
            status: "CONFIRMED", // Set individual status for single order
            customerName: user.name,
            customerEmail: user.email,
            customerPhone: mobileNumber || user.phone || ''
          }
        });

        // Create order items directly on the main order
        await tx.orderItem.createMany({
          data: orderItems.map(item => ({
            orderId: singleOrder.id, // Link to main order, not sub-order
            productId: item.productId,
            quantity: item.quantity,
            price: item.price
          }))
        });

        // Clear cart
        await tx.cartItem.deleteMany({
          where: { cartId: cart.id }
        });

        return {
          singleOrder,
          subOrders: [], // Empty for single seller
          isMultiSeller: false
        };
      }
    });

    const mainOrder = order.isMultiSeller ? order.parentOrder : order.singleOrder;
    const orderId = mainOrder.id;
    
    if (order.isMultiSeller) {
      console.log(`✅ Multi-seller Order created: Parent ${orderId} with ${order.subOrders.length} sub-orders`);
    } else {
      console.log(`✅ Single-seller Order created: ${orderId} (direct order, no sub-orders)`);
    }
    
    // Stock broadcasts are handled automatically by the Prisma middleware
    // in config/prisma.js — no manual broadcast needed here.

    // Check for low stock on all ordered products and deactivate + alert if <= 2
    handleLowStockAlerts(cart.items.map(i => i.productId));

    // ── Commission Earned — record 10 % platform fee per seller (non-blocking) ─
    for (const [sellerId, sellerData] of sellerNotifications) {
      let commissionOrderId;
      
      if (order.isMultiSeller) {
        // Use sub-order ID for commission tracking
        const sellerSubOrder = order.subOrders.find(sub => sub.sellerId === sellerId);
        commissionOrderId = sellerSubOrder?.id;
      } else {
        // Use main order ID for single seller
        commissionOrderId = orderId;
      }
      
      createCommissionEarned({
        orderId: commissionOrderId,
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

    // Create notifications for the main order (parent or single)
    const orderNotificationData = {
      customerName: user.name,
      sellerName: sellerNameList.length > 0 ? sellerNameList.join(', ') : 'Unknown',
      totalAmount: totalAmount.toFixed(2),
      itemCount: cart.items.length,
      productNames: allProductTitles,
      orderId: orderId // Use the main order ID
    };

    // Notify admins about new order
    notifyAdminNewOrder(orderId, orderNotificationData).catch(error => {
      console.error("Admin notification error (non-blocking):", error.message);
    });

    // Notify each seller about the new order (fired before reply — guaranteed delivery)
    for (const [sellerId, sellerData] of sellerNotifications) {
      // For multi-seller, use sub-order ID; for single seller, use main order ID
      const sellerOrderId = order.isMultiSeller 
        ? order.subOrders.find(sub => sub.sellerId === sellerId)?.id || orderId
        : orderId;
        
      notifySellerNewOrder(sellerId, sellerOrderId, {
        customerName: user.name,
        totalAmount: sellerData.totalAmount.toFixed(2),
        itemCount: sellerData.productCount,
        productNames: sellerData.products.map(p => p.title).filter(Boolean)
      }).catch(error => {
        console.error(`Seller order notification error (sellerId=${sellerId}):`, error.message);
      });
    }

    // Notify customer about their placed order (fired before reply — guaranteed delivery)
    notifyCustomerOrderStatusChange(userId, orderId, 'confirmed', {
      totalAmount: totalAmount.toFixed(2),
      itemCount: cart.items.length,
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
              orderId: orderId,
              totalAmount,
              itemCount: cart.items.length,
              products: cart.items.map(item => ({
                title: item.product.title,
                quantity: item.quantity,
                price: Number(item.product.price)
              })),
              shippingAddress,
              customerPhone: mobileNumber || user.phone || '',
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
              // For SLA notification, use the appropriate order ID
              const sellerOrderId = order.isMultiSeller 
                ? order.subOrders.find(sub => sub.sellerId === sellerId)?.id || orderId
                : orderId;
                
              createOrderNotification(sellerOrderId, sellerId, 'ORDER_PROCESSING', 'HIGH', {
                message: `New order received from ${user.name}`,
                notes: `${sellerData.productCount} item(s), Total: $${sellerData.totalAmount.toFixed(2)}`
              }).catch(e => console.error("SLA notification error:", e.message));
              // In-app notification already fired before reply — only SLA + email needed here
            }
            if (seller && seller.email) {
              const sellerName = seller.sellerProfile?.storeName || seller.sellerProfile?.businessName || seller.name || 'Seller';
              console.log(`📧 Sending order notification email to seller: ${seller.email}`);
              try {
                const sellerOrderId = order.isMultiSeller 
                  ? order.subOrders.find(sub => sub.sellerId === sellerId)?.id || orderId
                  : orderId;
                  
                const sellerEmailResult = await sendSellerOrderNotificationEmail(seller.email, sellerName, {
                  orderId: sellerOrderId,
                  productCount: sellerData.productCount,
                  totalAmount: sellerData.totalAmount,
                  products: sellerData.products,
                  shippingAddress,
                  paymentMethod,
                  customerName: user.name,
                  customerEmail: user.email,
                  customerPhone: mobileNumber || user.phone || ''
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
          const allItems = cart.items.map(item => ({
            title: item.product?.title || item.productId,
            quantity: item.quantity,
            price: Number(item.product.price)
          }));
          for (const admin of admins) {
            if (admin.email) {
              try {
                const adminEmailResult = await sendAdminNewOrderEmail(admin.email, admin.name || 'Admin', {
                  orderId: orderId,
                  customerName: user.name,
                  customerEmail: user.email,
                  customerPhone: mobileNumber || user.phone || '',
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
      orderId: orderId,
      displayId: mainOrder.displayId,
      isMultiSeller: order.isMultiSeller,
      ...(order.isMultiSeller ? {
        subOrders: order.subOrders.map(sub => ({
          id: sub.id,
          sellerId: sub.sellerId, 
          subtotal: sub.subtotal,
          status: sub.status
        }))
      } : {
        sellerId: mainOrder.sellerId,
        status: mainOrder.status
      }),
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
        items: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                images: true,
                price: true,
                sellerId: true,
                seller: {
                  select: { id: true, name: true }
                }
              }
            }
          }
        },
        seller: {
          select: {
            id: true,
            name: true
          }
        },
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
                    sellerId: true,
                    seller: {
                      select: { id: true, name: true }
                    }
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

    // Transform to handle both direct orders and multi-seller orders
    const transformedOrders = orders.map(order => {
      const isDirectOrder = !!order.sellerId; // Order has sellerId means it's a direct order
      const isMultiSellerOrder = order.subOrders && order.subOrders.length > 0;

      let allItems = [];
      let computedStatus = '';
      let subOrdersData = [];

      if (isDirectOrder) {
        // DIRECT ORDER (single seller)
        allItems = order.items.map(item => ({
          ...item,
          subOrderId: null, // No sub-order
          subOrderStatus: null,
          sellerId: order.sellerId,
          sellerName: order.seller?.name || 'Unknown Seller',
          trackingNumber: order.trackingNumber,
          estimatedDelivery: order.estimatedDelivery
        }));
        
        // Use the order's direct status
        computedStatus = order.status || order.overallStatus || 'CONFIRMED';
        
        // No sub-orders for direct orders
        subOrdersData = [];
        
      } else if (isMultiSellerOrder) {
        // MULTI-SELLER ORDER (has sub-orders)
        allItems = order.subOrders.flatMap(subOrder => 
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

        // Compute overall status from sub-orders
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

        // Sub-orders data for multi-seller orders
        subOrdersData = order.subOrders.map(sub => ({
          id: sub.id,
          sellerId: sub.sellerId,
          sellerName: sub.sellerProfile?.businessName || sub.sellerProfile?.storeName || sub.seller?.name || 'Unknown Seller',
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
        }));
        
      } else {
        // OLD ORDER (no sellerId, no sub-orders) - determine if DIRECT based on seller count
        const uniqueSellerIds = new Set(order.items.map(item => item.product?.sellerId).filter(Boolean));
        
        if (uniqueSellerIds.size === 1) {
          // Only one seller involved - treat as DIRECT order
          const sellerId = Array.from(uniqueSellerIds)[0];
          
          allItems = order.items.map(item => ({
            ...item,
            subOrderId: null,
            subOrderStatus: null,
            sellerId: sellerId,
            sellerName: item.product?.seller?.name || 'Unknown Seller',
            trackingNumber: order.trackingNumber,
            estimatedDelivery: order.estimatedDelivery
          }));

          computedStatus = order.overallStatus || order.status || 'CONFIRMED';
          subOrdersData = [];
          
        } else if (uniqueSellerIds.size > 1) {
          // Legacy multi-seller order with no sub-orders — group items by seller
          const sellerItemsMap = new Map();
          for (const item of order.items) {
            const sid = item.product?.sellerId;
            if (!sid) continue;
            if (!sellerItemsMap.has(sid)) sellerItemsMap.set(sid, []);
            sellerItemsMap.get(sid).push(item);
          }

          allItems = order.items.map(item => ({
            ...item,
            subOrderId: null,
            subOrderStatus: null,
            sellerId: item.product?.sellerId || null,
            sellerName: item.product?.seller?.name || 'Unknown Seller',
            trackingNumber: order.trackingNumber,
            estimatedDelivery: order.estimatedDelivery
          }));

          computedStatus = order.overallStatus || order.status || 'CONFIRMED';

          // Build synthetic per-seller groupings so the frontend can show per-seller info
          subOrdersData = [...sellerItemsMap.entries()].map(([sid, items]) => ({
            id: null, // No real sub-order record exists
            sellerId: sid,
            sellerName: items[0]?.product?.seller?.name || 'Unknown Seller',
            status: computedStatus,
            trackingNumber: order.trackingNumber,
            estimatedDelivery: order.estimatedDelivery,
            subtotal: items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0),
            itemCount: items.length,
            items: items.map(item => ({
              id: item.id,
              productId: item.productId,
              productTitle: item.product?.title || 'Product',
              productImages: item.product?.images || [],
              quantity: item.quantity,
              price: item.price
            }))
          }));
        } else {
          // No items have sellerId at all — skip
          console.warn(`⚠️ Order ${order.id} has no recognisable sellers — skipping`);
          return null;
        }
      }

      // Calculate seller count properly for all order types
      let sellerCount = 0;
      if (isDirectOrder) {
        sellerCount = 1; // Direct order has exactly one seller
      } else if (isMultiSellerOrder) {
        sellerCount = subOrdersData.length; // Number of sub-orders = number of sellers
      } else {
        // Old order - count unique sellers from items
        const uniqueSellerIds = new Set(allItems.map(item => item.sellerId).filter(Boolean));
        sellerCount = uniqueSellerIds.size;
      }

      return {
        id: order.id,
        displayId: order.displayId,
        userId: order.userId,
        type: isDirectOrder ? 'DIRECT' : (isMultiSellerOrder ? 'MULTI_SELLER' : (sellerCount > 1 ? 'MULTI_SELLER' : 'DIRECT')),
        totalAmount: order.totalAmount,
        status: computedStatus,
        trackingNumber: order.trackingNumber,
        estimatedDelivery: order.estimatedDelivery,
        statusReason: order.statusReason,
        paymentMethod: order.paymentMethod,
        stripePaymentIntentId: order.stripePaymentIntentId,
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
        subOrders: subOrdersData,
        // Summary info
        sellerCount: sellerCount, // Use calculated seller count
        itemCount: allItems.length
      };
    });

    // Filter out any null orders (invalid structure)
    const validOrders = transformedOrders.filter(order => order !== null);

    return reply.status(200).send({ 
      success: true, 
      orders: validOrders,
      summary: {
        totalOrders: validOrders.length,
        directOrders: validOrders.filter(o => o.type === 'DIRECT').length,
        multiSellerOrders: validOrders.filter(o => o.type === 'MULTI_SELLER').length
      }
    });
  } catch (error) {
    console.error("Get my orders error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// USER — CANCEL ORDER (with SMS notification)
exports.cancelOrder = async (request, reply) => {
  try {
    const displayId = request.params.id;
    const userId = request.user.userId;
    const { reason, statusReason } = request.body || {};

    const order = await prisma.order.findUnique({
      where: { displayId },
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

    const orderId = order.id; // resolve to internal CUID for all remaining operations

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
    const displayId = request.params.id;
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
      where: { displayId },
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

    if (!order) return reply.status(404).send({ success: false, message: 'Order not found' });

    const orderId = order.id; // resolve to internal CUID for all remaining operations

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
    const { orderId: displayId, customerEmail, requestType, reason, statusReason } = request.body || {};

    if (!displayId || !customerEmail) {
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
      where: { displayId },
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

    const orderId = order.id; // resolve to internal CUID for ticket creation and notifications

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
    const { orderId: displayId, customerEmail } = request.query;

    if (!displayId || !customerEmail) {
      return reply.status(400).send({
        success: false,
        message: 'orderId and customerEmail are required'
      });
    }

    const normalizedEmail = customerEmail.trim().toLowerCase();
    const order = await prisma.order.findUnique({ where: { displayId } });

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

    const orderId = order.id; // resolve to internal CUID

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
    const { orderId: displayId, customerEmail } = request.query;

    if (!displayId || !customerEmail) {
      return reply.status(400).send({
        success: false,
        message: 'orderId and customerEmail are required'
      });
    }

    const normalizedEmail = customerEmail.trim().toLowerCase();
    const order = await prisma.order.findUnique({ where: { displayId } });

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

    const orderId = order.id; // resolve to internal CUID

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
    const displayId = request.params.id;
    const userId = request.user.userId;

    // Get the order with items
    const order = await prisma.order.findUnique({
      where: { displayId },
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

    const orderId = order.id; // resolve to internal CUID (used later for cart ops)
    void orderId; // suppress unused variable warning — orderId kept for any extensions

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

    // Generate short alphanumeric display ID for the customer
    const displayId = await generateDisplayId();

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
          displayId,
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
      displayId: order.displayId,
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
// Tracks any order by display ID + customer email — works for both guests and registered users.
exports.trackGuestOrder = async (request, reply) => {
  try {
    const { orderId: displayId, customerEmail } = request.query;

    if (!displayId || !customerEmail) {
      return reply.status(400).send({ success: false, message: "Order ID and customer email are required" });
    }

    const order = await prisma.order.findUnique({
      where: { displayId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                featuredImage: true,
                price: true
              }
            }
          }
        },
        subOrders: {
          include: {
            items: {
              include: {
                product: {
                  select: {
                    id: true,
                    title: true,
                    featuredImage: true,
                    price: true
                  }
                }
              }
            },
            seller: {
              select: { id: true, name: true }
            }
          }
        }
      }
    });

    if (!order) {
      return reply.status(404).send({ success: false, message: "Order not found" });
    }

    // Verify customer email matches — works for guests and registered users alike
    if (order.customerEmail?.toLowerCase() !== customerEmail?.toLowerCase()) {
      return reply.status(403).send({ success: false, message: "Email does not match order" });
    }

    const isMultiSeller = order.orderType === 'MULTI_SELLER' ||
      (Array.isArray(order.subOrders) && order.subOrders.length > 0);

    // Shape sub-orders into a clean structure the frontend can consume directly
    const shapedSubOrders = isMultiSeller
      ? order.subOrders.map(sub => ({
          id: sub.id,
          status: sub.status,
          trackingNumber: sub.trackingNumber || null,
          estimatedDelivery: sub.estimatedDelivery || null,
          subtotal: sub.subtotal,
          seller: {
            id: sub.seller?.id || null,
            name: sub.seller?.name || 'Unknown Seller'
          },
          items: sub.items.map(item => ({
            id: item.id,
            quantity: item.quantity,
            price: item.price,
            product: {
              id: item.product?.id || null,
              title: item.product?.title || 'Product',
              featuredImage: item.product?.featuredImage || null,
              price: item.product?.price || item.price
            }
          }))
        }))
      : undefined;

    // For MULTI_SELLER orders, items live on sub-orders — flatten for top-level items field
    const resolvedItems = isMultiSeller
      ? order.subOrders.flatMap(sub =>
          sub.items.map(item => ({
            id: item.id,
            quantity: item.quantity,
            price: item.price,
            sellerName: sub.seller?.name || 'Unknown Seller',
            product: {
              id: item.product?.id || null,
              title: item.product?.title || 'Product',
              featuredImage: item.product?.featuredImage || null,
              price: item.product?.price || item.price
            }
          }))
        )
      : order.items;

    // Extract orderSummary from the stored shippingAddress JSON blob (kept for legacy storage)
    const storedShipping = order.shippingAddress || {};
    const orderSummary = storedShipping.orderSummary || null;

    return reply.status(200).send({ 
      success: true, 
      order: {
        id: order.id,
        displayId: order.displayId,
        orderType: order.orderType,
        status: order.status || order.overallStatus,
        totalAmount: order.totalAmount,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        shippingAddress: {
          addressLine: order.shippingAddressLine,
          city: order.shippingCity,
          state: order.shippingState,
          zipCode: order.shippingZipCode,
          country: order.shippingCountry,
          phone: order.shippingPhone
        },
        orderSummary,
        // For MULTI_SELLER, tracking lives per sub-order; top-level is null
        trackingNumber: isMultiSeller ? null : (order.trackingNumber || null),
        estimatedDelivery: isMultiSeller ? null : (order.estimatedDelivery || null),
        items: resolvedItems,
        subOrders: shapedSubOrders,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      }
    });

  } catch (error) {
    console.error("Track order error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ─── Invoice PDF Helper ────────────────────────────────────────────
// Accepts a unified order shape. Handles MULTI_SELLER (order.subOrders[]),
// sub-order specific (order.sellerName set, flat order.items), and legacy/direct.
const generateInvoiceBuffer = (order) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Resolve status — MULTI_SELLER parents store it in overallStatus
    const resolvedStatus = order.status || order.overallStatus || 'CONFIRMED';
    const displayRef     = order.displayId != null ? `#${order.displayId}` : order.id;

    // ── Header ──
    doc.fontSize(20).text('ALPA MARKETPLACE', 50, 50)
       .fontSize(10).text('Your Cultural Marketplace', 50, 75).moveDown();

    // ── Invoice meta ──
    doc.fontSize(16).text('INVOICE', 50, 120)
       .fontSize(12)
       .text(`Invoice #: ${displayRef}`, 50, 145)
       .text(`Date: ${new Date(order.createdAt).toLocaleDateString('en-AU')}`, 50, 160)
       .text(`Status: ${resolvedStatus}`, 50, 175);
    if (order.sellerName) {
      doc.text(`Seller: ${order.sellerName}`, 50, 190);
    }

    // ── Bill To ──
    doc.fontSize(14).text('Bill To:', 50, 210)
       .fontSize(12)
       .text(order.customerName  || '', 50, 230)
       .text(order.customerEmail || '', 50, 245)
       .text(order.shippingPhone || order.customerPhone || '', 50, 260);

    // ── Ship To ──
    doc.fontSize(14).text('Ship To:', 300, 210).fontSize(12);
    if (order.shippingAddressLine || order.shippingCity) {
      doc.text(order.shippingAddressLine || '', 300, 230)
         .text(`${order.shippingCity || ''}, ${order.shippingState || ''}`, 300, 245)
         .text(order.shippingZipCode  || '', 300, 260)
         .text(order.shippingCountry  || '', 300, 275);
    }

    const hasSubOrders = Array.isArray(order.subOrders) && order.subOrders.length > 0;
    let yPos = 320;
    let grandSubtotal = 0;

    if (hasSubOrders) {
      // ── MULTI_SELLER: one section per seller sub-order ──
      for (const sub of order.subOrders) {
        const sellerLabel = sub.seller?.name || sub.sellerName || 'Unknown Seller';
        doc.fontSize(11)
           .text(`Seller: ${sellerLabel}`, 50, yPos)
           .text(`Sub-order Status: ${sub.status || resolvedStatus}`, 310, yPos);
        yPos += 18;

        doc.fontSize(10)
           .text('Item',       50, yPos)
           .text('Qty',       310, yPos)
           .text('Unit Price', 370, yPos)
           .text('Total',     470, yPos);
        doc.moveTo(50, yPos + 12).lineTo(550, yPos + 12).stroke();
        yPos += 22;

        let sellerSubtotal = 0;
        (sub.items || []).forEach(item => {
          const lineTotal = Number(item.price) * item.quantity;
          sellerSubtotal += lineTotal;
          doc.fontSize(10)
             .text(item.product?.title || 'Product', 50, yPos, { width: 250 })
             .text(String(item.quantity),             310, yPos)
             .text(`$${Number(item.price).toFixed(2)}`, 370, yPos)
             .text(`$${lineTotal.toFixed(2)}`,          470, yPos);
          yPos += 18;
        });
        doc.fontSize(10)
           .text(`Seller Subtotal:`, 370, yPos)
           .text(`$${Number(sub.subtotal ?? sellerSubtotal).toFixed(2)}`, 470, yPos);
        yPos += 8;
        doc.moveTo(50, yPos + 4).lineTo(550, yPos + 4).stroke();
        yPos += 18;
        grandSubtotal += sellerSubtotal;
      }
    } else {
      // ── Single-seller / sub-order: flat items table ──
      doc.fontSize(12)
         .text('Item',       50, yPos)
         .text('Quantity',  260, yPos)
         .text('Unit Price', 360, yPos)
         .text('Total',     460, yPos);
      doc.moveTo(50, yPos + 15).lineTo(550, yPos + 15).stroke();
      yPos += 28;

      (order.items || []).forEach(item => {
        const lineTotal = Number(item.price) * item.quantity;
        grandSubtotal += lineTotal;
        doc.text(item.product?.title || 'Product', 50, yPos, { width: 200 })
           .text(String(item.quantity),              260, yPos)
           .text(`$${Number(item.price).toFixed(2)}`, 360, yPos)
           .text(`$${lineTotal.toFixed(2)}`,           460, yPos);
        yPos += 20;
      });
      doc.moveTo(50, yPos + 5).lineTo(550, yPos + 5).stroke();
      yPos += 18;
    }

    // ── Coupon / discount ──
    if (order.discountAmount && parseFloat(order.discountAmount) > 0) {
      doc.fontSize(12)
         .text(`Coupon (${order.couponCode || ''}) Discount:`, 300, yPos)
         .text(`-$${parseFloat(order.discountAmount).toFixed(2)}`, 460, yPos);
      yPos += 20;
    }

    // ── Totals ──
    doc.fontSize(12).text('Subtotal:',     350, yPos).text(`$${grandSubtotal.toFixed(2)}`, 460, yPos);
    yPos += 20;
    doc.fontSize(14).text('Total Amount:', 350, yPos).text(`$${Number(order.totalAmount).toFixed(2)}`, 460, yPos);
    yPos += 40;
    doc.fontSize(12).text(`Payment Method: ${order.paymentMethod || 'N/A'}`, 50, yPos);

    // ── Footer ──
    yPos += 60;
    doc.fontSize(10)
       .text('Thank you for your business!', 50, yPos)
       .text('For questions about this invoice, contact support@alpa.com', 50, yPos + 15);

    doc.end();
  });
};

// ─── Helper: build a unified invoice shape from a SubOrder record ──────────
const buildSubOrderShape = (sub) => ({
  id:                 sub.id,
  createdAt:          sub.createdAt,
  status:             sub.status,
  sellerName:         sub.seller?.name || null,
  customerName:       sub.parentOrder.customerName,
  customerEmail:      sub.parentOrder.customerEmail,
  customerPhone:      sub.parentOrder.customerPhone,
  shippingPhone:      sub.parentOrder.shippingPhone,
  shippingAddressLine: sub.parentOrder.shippingAddressLine,
  shippingCity:       sub.parentOrder.shippingCity,
  shippingState:      sub.parentOrder.shippingState,
  shippingZipCode:    sub.parentOrder.shippingZipCode,
  shippingCountry:    sub.parentOrder.shippingCountry,
  totalAmount:        sub.subtotal,
  paymentMethod:      sub.parentOrder.paymentMethod,
  discountAmount:     null,
  couponCode:         null,
  items:              sub.items,
  subOrders:          null,
});

// Download Invoice as PDF (auth required)
exports.downloadInvoice = async (request, reply) => {
  try {
    const userId   = request.user.userId;
    const userRole = request.user.role;
    const { orderId } = request.params;

    const orderInclude = {
      items:     { include: { product: { select: { id: true, title: true, price: true, sellerId: true } } } },
      subOrders: { include: { seller: { select: { name: true } }, items: { include: { product: { select: { id: true, title: true, price: true } } } } } },
      user:      { select: { name: true, email: true, phone: true } },
    };

    // ── Try as a parent / direct / legacy order first ──
    let invoiceShape = null;
    const orderRecord = await prisma.order.findFirst({ where: { displayId: orderId }, include: orderInclude });

    if (orderRecord) {
      // Role-based access
      if (userRole === 'USER' && orderRecord.userId !== userId) {
        return reply.status(403).send({ success: false, message: "You don't have permission to access this order" });
      }
      if (userRole === 'SELLER') {
        const isSeller = orderRecord.sellerId === userId ||
          orderRecord.items.some(i => i.product?.sellerId === userId) ||
          orderRecord.subOrders?.some(s => s.sellerId === userId);
        if (!isSeller) return reply.status(403).send({ success: false, message: "You don't have permission to access this order" });
      }
      invoiceShape = {
        ...orderRecord,
        customerName:  orderRecord.user?.name  || orderRecord.customerName,
        customerEmail: orderRecord.user?.email || orderRecord.customerEmail,
        customerPhone: orderRecord.user?.phone || orderRecord.customerPhone,
      };
    } else {
      // ── Fall back: try as a SubOrder ID ──
      const subOrderInclude = {
        parentOrder: { include: { user: { select: { name: true, email: true, phone: true } } } },
        items:       { include: { product: { select: { id: true, title: true, price: true } } } },
        seller:      { select: { name: true, email: true } },
      };
      const subRecord = await prisma.subOrder.findUnique({ where: { id: orderId }, include: subOrderInclude });
      if (!subRecord) {
        return reply.status(404).send({ success: false, message: "Order not found or you don't have permission to access this order" });
      }
      // Role-based access for sub-orders
      if (userRole === 'USER' && subRecord.parentOrder.userId !== userId) {
        return reply.status(403).send({ success: false, message: "You don't have permission to access this order" });
      }
      if (userRole === 'SELLER' && subRecord.sellerId !== userId) {
        return reply.status(403).send({ success: false, message: "You don't have permission to access this order" });
      }
      invoiceShape = buildSubOrderShape(subRecord);
    }

    // Status guard
    const resolvedStatus = invoiceShape.status || invoiceShape.overallStatus || 'CONFIRMED';
    if (!['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'].includes(resolvedStatus)) {
      return reply.status(400).send({ success: false, message: `Invoice is not available for orders with status: ${resolvedStatus}` });
    }

    const pdfBuffer = await generateInvoiceBuffer(invoiceShape);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="invoice-${orderId}.pdf"`);
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
      return reply.status(400).send({ success: false, message: "Order ID and customer email are required" });
    }

    const orderInclude = {
      items:     { include: { product: { select: { id: true, title: true, price: true } } } },
      subOrders: { include: { seller: { select: { name: true } }, items: { include: { product: { select: { id: true, title: true, price: true } } } } } },
    };

    // Try as parent order (email verified)
    let invoiceShape = null;
    const orderRecord = await prisma.order.findFirst({
      where: { displayId: orderId, customerEmail },
      include: orderInclude,
    });

    if (orderRecord) {
      invoiceShape = orderRecord;
    } else {
      // Fall back to sub-order (verify email against parent)
      const subRecord = await prisma.subOrder.findUnique({
        where: { id: orderId },
        include: {
          parentOrder: true,
          items: { include: { product: { select: { id: true, title: true, price: true } } } },
          seller: { select: { name: true, email: true } },
        },
      });
      if (!subRecord || subRecord.parentOrder.customerEmail !== customerEmail) {
        return reply.status(404).send({ success: false, message: "Order not found or email doesn't match" });
      }
      invoiceShape = buildSubOrderShape(subRecord);
    }

    const resolvedStatus = invoiceShape.status || invoiceShape.overallStatus || 'CONFIRMED';
    if (!['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'].includes(resolvedStatus)) {
      return reply.status(400).send({ success: false, message: `Invoice is not available for orders with status: ${resolvedStatus}` });
    }

    const pdfBuffer = await generateInvoiceBuffer(invoiceShape);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="invoice-${orderId}.pdf"`);
    return reply.send(pdfBuffer);
  } catch (error) {
    console.error("Download guest invoice error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ─── DEAD CODE REMOVED ─── old inline PDF generation replaced by generateInvoiceBuffer above
// placeholder kept so line references don't shift unexpectedly
const _guestInvoiceLegacyPlaceholder = null; // eslint-disable-line

// Download Invoice as PDF — public endpoint for email links
// No auth required: orderId is an unguessable CUID.
// GET /api/orders/invoice/public/:orderId
exports.downloadPublicInvoice = async (request, reply) => {
  try {
    const { orderId } = request.params;

    const orderInclude = {
      items:     { include: { product: { select: { id: true, title: true, price: true } } } },
      subOrders: { include: { seller: { select: { name: true } }, items: { include: { product: { select: { id: true, title: true, price: true } } } } } },
      user:      { select: { name: true, email: true, phone: true } },
    };

    // Try parent / direct / legacy order first
    let invoiceShape = null;
    const orderRecord = await prisma.order.findFirst({ where: { id: orderId }, include: orderInclude });

    if (orderRecord) {
      invoiceShape = {
        ...orderRecord,
        customerName:  orderRecord.user?.name  || orderRecord.customerName,
        customerEmail: orderRecord.user?.email || orderRecord.customerEmail,
        customerPhone: orderRecord.user?.phone || orderRecord.customerPhone,
      };
    } else {
      // Fall back to sub-order
      const subRecord = await prisma.subOrder.findUnique({
        where: { id: orderId },
        include: {
          parentOrder: true,
          items:  { include: { product: { select: { id: true, title: true, price: true } } } },
          seller: { select: { name: true, email: true } },
        },
      });
      if (!subRecord) {
        return reply.status(404).send({ success: false, message: "Order not found" });
      }
      invoiceShape = buildSubOrderShape(subRecord);
    }

    const resolvedStatus = invoiceShape.status || invoiceShape.overallStatus || 'CONFIRMED';
    if (!['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'].includes(resolvedStatus)) {
      return reply.status(400).send({ success: false, message: `Invoice is not available for orders with status: ${resolvedStatus}` });
    }

    const pdfBuffer = await generateInvoiceBuffer(invoiceShape);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="invoice-${orderId}.pdf"`);
    return reply.send(pdfBuffer);
  } catch (error) {
    console.error("Download public invoice error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};


