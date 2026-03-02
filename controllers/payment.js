const Stripe = require("stripe");
const prisma = require("../config/prisma");
const { calculateCartTotals } = require("./cart");
const {
  sendOrderConfirmationEmail,
} = require("../utils/emailService");
const {
  notifyAdminNewOrder,
} = require("./notification");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Create Stripe PaymentIntent + Pending Order
// POST /api/payments/create-intent
// Body: { shippingAddress, shippingMethodId, gstId, country, city, zipCode, state, mobileNumber }
// ─────────────────────────────────────────────────────────────────────────────
exports.createPaymentIntent = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const {
      shippingAddress,
      shippingMethodId,
      gstId,
      country,
      city,
      zipCode,
      state,
      mobileNumber,
    } = request.body;

    if (!shippingAddress || !shippingMethodId) {
      return reply.status(400).send({
        success: false,
        message: "shippingAddress and shippingMethodId are required",
      });
    }

    // Get user
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.status(404).send({ success: false, message: "User not found" });
    }

    // Get cart
    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: { items: { include: { product: true } } },
    });

    if (!cart || cart.items.length === 0) {
      return reply.status(400).send({ success: false, message: "Cart is empty" });
    }

    // Validate shipping method
    const shippingMethod = await prisma.shippingMethod.findUnique({
      where: { id: shippingMethodId, isActive: true },
    });
    if (!shippingMethod) {
      return reply.status(400).send({
        success: false,
        message: "Invalid or inactive shipping method",
      });
    }

    // Stock check
    for (const item of cart.items) {
      if (item.product.stock < item.quantity) {
        return reply.status(400).send({
          success: false,
          message: `Insufficient stock for: ${item.product.title}`,
        });
      }
    }

    // Calculate totals
    const cartCalculations = await calculateCartTotals(
      cart.items,
      shippingMethodId,
      gstId
    );
    const totalAmount = parseFloat(cartCalculations.grandTotal);

    // Stripe expects amount in smallest currency unit (cents for AUD)
    const amountInCents = Math.round(totalAmount * 100);

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "aud",
      metadata: {
        userId,
        cartId: cart.id,
      },
      automatic_payment_methods: { enabled: true },
    });

    // Prepare order items
    const orderItems = cart.items.map((item) => ({
      productId: item.product.id,
      quantity: item.quantity,
      price: Number(item.product.price),
    }));

    // Build shippingAddress JSON with order summary
    const shippingAddressData =
      typeof shippingAddress === "string"
        ? { address: shippingAddress }
        : {
            ...shippingAddress,
            orderSummary: {
              subtotal: cartCalculations.subtotal,
              subtotalExGST: cartCalculations.subtotalExGST,
              shippingCost: cartCalculations.shippingCost,
              gstPercentage: cartCalculations.gstPercentage,
              gstAmount: cartCalculations.gstAmount,
              grandTotal: cartCalculations.grandTotal,
              gstInclusive: true,
              shippingMethod: {
                id: shippingMethod.id,
                name: shippingMethod.name,
                cost: shippingMethod.cost,
                estimatedDays: shippingMethod.estimatedDays,
              },
              gstDetails: cartCalculations.gstDetails,
            },
          };

    // Create PENDING order (no stock deduction yet — happens on payment success)
    const order = await prisma.order.create({
      data: {
        userId,
        totalAmount,
        shippingAddress: shippingAddressData,
        shippingAddressLine:
          typeof shippingAddress === "string"
            ? shippingAddress
            : shippingAddress?.addressLine,
        shippingCity: city,
        shippingState: state,
        shippingZipCode: zipCode,
        shippingCountry: country,
        shippingPhone: mobileNumber,
        paymentMethod: "STRIPE",
        status: "CONFIRMED",
        paymentStatus: "PENDING",
        stripePaymentIntentId: paymentIntent.id,
        customerName: user.name,
        customerEmail: user.email,
        customerPhone: mobileNumber || user.phone || "",
        items: { create: orderItems },
      },
      include: { items: { include: { product: true } } },
    });

    return reply.status(200).send({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      orderId: order.id,
      amount: amountInCents,        // in cents (Stripe standard) — e.g. 9500 for $95.00 AUD
      displayAmount: totalAmount,   // in dollars, for UI display only — e.g. 95.00
      currency: "aud",
      orderSummary: {
        subtotal: cartCalculations.subtotal,
        subtotalExGST: cartCalculations.subtotalExGST,
        shippingCost: cartCalculations.shippingCost,
        gstAmount: cartCalculations.gstAmount,
        gstPercentage: cartCalculations.gstPercentage,
        gstInclusive: true,
        grandTotal: cartCalculations.grandTotal,
      },
    });
  } catch (error) {
    console.error("❌ createPaymentIntent error:", error);
    return reply.status(500).send({
      success: false,
      message: "Failed to create payment intent",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Confirm payment after Stripe processes it on the frontend
// POST /api/payments/confirm
// Body: { paymentIntentId }
// ─────────────────────────────────────────────────────────────────────────────
exports.confirmPayment = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { paymentIntentId } = request.body;

    if (!paymentIntentId) {
      return reply.status(400).send({
        success: false,
        message: "paymentIntentId is required",
      });
    }

    // Verify payment with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== "succeeded") {
      return reply.status(400).send({
        success: false,
        message: `Payment not successful. Stripe status: ${paymentIntent.status}`,
      });
    }

    // Find the associated order
    const order = await prisma.order.findFirst({
      where: { stripePaymentIntentId: paymentIntentId, userId },
      include: { items: { include: { product: true } } },
    });

    if (!order) {
      return reply.status(404).send({
        success: false,
        message: "Order not found for this payment",
      });
    }

    // Idempotency — if already confirmed, just return success
    if (order.paymentStatus === "PAID") {
      return reply.status(200).send({
        success: true,
        message: "Payment already confirmed",
        orderId: order.id,
      });
    }

    // Deduct stock, clear cart, mark PAID, send confirmation email, notify admins.
    // handlePaymentSucceeded is the single source of truth — works for webhook,
    // logged-in confirm, and guest confirm paths without duplication.
    await handlePaymentSucceeded(paymentIntentId);

    return reply.status(200).send({
      success: true,
      message: "Payment confirmed and order placed successfully",
      orderId: order.id,
      status: "CONFIRMED",
      paymentStatus: "PAID",
    });
  } catch (error) {
    console.error("❌ confirmPayment error:", error);
    return reply.status(500).send({
      success: false,
      message: "Failed to confirm payment",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 (Optional / Server-side safety net) — Stripe Webhook
// POST /api/payments/webhook
// Raw body required — registered with a buffer content-type parser in routes
// ─────────────────────────────────────────────────────────────────────────────
exports.stripeWebhook = async (request, reply) => {
  const sig = request.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    // request.rawBody is the raw Buffer set by the scoped content-type parser
    event = stripe.webhooks.constructEvent(request.rawBody, sig, webhookSecret);
  } catch (err) {
    console.error("❌ Stripe webhook signature verification failed:", err.message);
    return reply.status(400).send({ error: `Webhook Error: ${err.message}` });
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object;
        await handlePaymentSucceeded(pi.id);
        break;
      }
      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        await prisma.order.updateMany({
          where: { stripePaymentIntentId: pi.id },
          data: { paymentStatus: "FAILED" },
        });
        console.log(`⚠️ Payment failed for PaymentIntent: ${pi.id}`);
        break;
      }
      default:
        console.log(`Unhandled Stripe event: ${event.type}`);
    }

    return reply.status(200).send({ received: true });
  } catch (error) {
    console.error("❌ Webhook handler error:", error);
    return reply.status(500).send({ error: "Webhook processing failed" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/status/:orderId — Check payment + order status
// ─────────────────────────────────────────────────────────────────────────────
exports.getPaymentStatus = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { orderId } = request.params;

    const order = await prisma.order.findFirst({
      where: { id: orderId, userId },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        stripePaymentIntentId: true,
        totalAmount: true,
        createdAt: true,
      },
    });

    if (!order) {
      return reply.status(404).send({ success: false, message: "Order not found" });
    }

    return reply.status(200).send({ success: true, order });
  } catch (error) {
    console.error("❌ getPaymentStatus error:", error);
    return reply.status(500).send({
      success: false,
      message: "Failed to get payment status",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — shared between /confirm endpoint and webhook
// ─────────────────────────────────────────────────────────────────────────────
async function handlePaymentSucceeded(paymentIntentId) {
  const order = await prisma.order.findFirst({
    where: {
      stripePaymentIntentId: paymentIntentId,
      paymentStatus: { not: "PAID" }, // skip if already processed
    },
    include: { items: { include: { product: true } } },
  });

  if (!order) return false; // already handled or not found

  const cart = order.userId
    ? await prisma.cart.findUnique({ where: { userId: order.userId } })
    : null;

  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      });
    }

    if (cart) {
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    }

    // Increment coupon usageCount if a coupon was applied
    if (order.couponCode) {
      await tx.coupon.updateMany({
        where: { code: order.couponCode },
        data: { usageCount: { increment: 1 } },
      });
    }

    await tx.order.update({
      where: { id: order.id },
      data: { status: "CONFIRMED", paymentStatus: "PAID" },
    });
  });

  console.log(`✅ Order ${order.id} confirmed (paymentIntentId: ${paymentIntentId})`);

  // ── Send confirmation email ─────────────────────────────────────────────
  // Uses order.customerEmail which is always stored at order-creation time for
  // both guest and logged-in orders, so this works for every payment path
  // (webhook, /confirm, /guest/confirm) without any extra lookup.
  const toEmail = order.customerEmail;
  const toName  = order.customerName || 'Customer';

  if (toEmail) {
    const storedSummary =
      typeof order.shippingAddress === 'object' ? order.shippingAddress?.orderSummary : null;

    sendOrderConfirmationEmail(toEmail, toName, {
      orderId:       order.id,
      totalAmount:   Number(order.totalAmount),
      itemCount:     order.items.length,
      products:      order.items.map((item) => ({
        title:    item.product.title,
        quantity: item.quantity,
        price:    Number(item.price),
      })),
      // Pass structured address so the email template can render city/state/zip
      shippingAddress: {
        addressLine: order.shippingAddressLine,
        city:        order.shippingCity,
        state:       order.shippingState,
        zipCode:     order.shippingZipCode,
        country:     order.shippingCountry,
      },
      paymentMethod:   order.paymentMethod || 'Stripe',
      customerPhone:   order.customerPhone || '',
      orderSummary:    storedSummary || undefined,
      isGuest:         !order.userId, // guest orders use /guest/track-order?orderId=...&email=...
    }).catch((e) => console.error('Email error (non-blocking):', e.message));
  } else {
    console.warn(`⚠️  No customerEmail on order ${order.id} — confirmation email skipped`);
  }

  // ── Notify admins ───────────────────────────────────────────────────────
  notifyAdminNewOrder(order.id, {
    customerName: toName,
    totalAmount:  Number(order.totalAmount).toFixed(2),
    itemCount:    order.items.length,
    orderId:      order.id,
  }).catch((e) => console.error('Admin notification error (non-blocking):', e.message));

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUEST — Create Stripe PaymentIntent + Pending Order (no auth required)
// POST /api/payments/guest/create-intent
// Body: { items, customerName, customerEmail, customerPhone, shippingAddress,
//         shippingMethodId, gstId, country, city, zipCode, state, mobileNumber, couponCode }
// ─────────────────────────────────────────────────────────────────────────────
exports.createGuestPaymentIntent = async (request, reply) => {
  try {
    const {
      items,
      customerName,
      customerEmail,
      customerPhone,
      shippingAddress,
      shippingMethodId,
      gstId,
      country,
      city,
      zipCode,
      state,
      mobileNumber,
      couponCode,
    } = request.body;

    // Basic validation
    if (!items || items.length === 0) {
      return reply.status(400).send({ success: false, message: "Order items are required" });
    }
    if (!customerName || !customerEmail || !customerPhone) {
      return reply.status(400).send({ success: false, message: "Customer name, email, and phone are required" });
    }
    if (!shippingAddress || !shippingMethodId) {
      return reply.status(400).send({ success: false, message: "shippingAddress and shippingMethodId are required" });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail)) {
      return reply.status(400).send({ success: false, message: "Invalid email address" });
    }

    // Validate shipping method
    const shippingMethod = await prisma.shippingMethod.findUnique({
      where: { id: shippingMethodId, isActive: true },
    });
    if (!shippingMethod) {
      return reply.status(400).send({ success: false, message: "Invalid or inactive shipping method" });
    }

    // Fetch and validate products + build cart-like structure
    const cartItems = [];
    const orderItems = [];

    for (const item of items) {
      const { productId, quantity } = item;
      if (!productId || !quantity || quantity < 1) {
        return reply.status(400).send({ success: false, message: "Invalid item in order" });
      }

      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (!product) {
        return reply.status(404).send({ success: false, message: `Product ${productId} not found` });
      }
      if (product.stock < quantity) {
        return reply.status(400).send({
          success: false,
          message: `Insufficient stock for: ${product.title}`,
        });
      }

      cartItems.push({ product, quantity });
      orderItems.push({ productId: product.id, quantity, price: Number(product.price) });
    }

    // Calculate totals
    const cartCalculations = await calculateCartTotals(cartItems, shippingMethodId, gstId);
    const originalTotal = parseFloat(cartCalculations.grandTotal);

    // ── Coupon validation ──────────────────────────────────────────────────
    let appliedCoupon = null;
    let discountAmount = 0;

    if (couponCode) {
      const coupon = await prisma.coupon.findUnique({
        where: { code: couponCode.toUpperCase() },
      });
      if (!coupon) return reply.status(400).send({ success: false, message: "Invalid coupon code" });
      if (!coupon.isActive) return reply.status(400).send({ success: false, message: "Coupon is no longer active" });
      if (new Date() > coupon.expiresAt) return reply.status(400).send({ success: false, message: "Coupon has expired" });
      if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit)
        return reply.status(400).send({ success: false, message: "Coupon usage limit reached" });
      if (coupon.minCartValue !== null && originalTotal < coupon.minCartValue)
        return reply.status(400).send({
          success: false,
          message: `Minimum cart value of $${coupon.minCartValue.toFixed(2)} required`,
        });

      if (coupon.discountType === "percentage") {
        discountAmount = parseFloat(((originalTotal * coupon.discountValue) / 100).toFixed(2));
        if (coupon.maxDiscount !== null) discountAmount = Math.min(discountAmount, coupon.maxDiscount);
      } else {
        discountAmount = Math.min(coupon.discountValue, originalTotal);
      }
      appliedCoupon = coupon;
    }

    const totalAmount = parseFloat((originalTotal - discountAmount).toFixed(2));
    const amountInCents = Math.round(totalAmount * 100);
    // ──────────────────────────────────────────────────────────────────────

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "aud",
      metadata: { isGuest: "true", customerEmail },
      automatic_payment_methods: { enabled: true },
    });

    // Build shippingAddress JSON with order summary
    const shippingAddressData =
      typeof shippingAddress === "string"
        ? { address: shippingAddress }
        : {
            ...shippingAddress,
            orderSummary: {
              subtotal: cartCalculations.subtotal,
              subtotalExGST: cartCalculations.subtotalExGST,
              shippingCost: cartCalculations.shippingCost,
              gstPercentage: cartCalculations.gstPercentage,
              gstAmount: cartCalculations.gstAmount,
              grandTotal: cartCalculations.grandTotal,
              couponCode: appliedCoupon ? appliedCoupon.code : null,
              discountAmount,
              finalTotal: totalAmount,
              gstInclusive: true,
              shippingMethod: {
                id: shippingMethod.id,
                name: shippingMethod.name,
                cost: shippingMethod.cost,
                estimatedDays: shippingMethod.estimatedDays,
              },
              gstDetails: cartCalculations.gstDetails,
            },
          };

    // Create PENDING guest order (stock deducted on payment success via webhook / confirm)
    const order = await prisma.order.create({
      data: {
        // userId intentionally omitted — guest order
        totalAmount,
        originalTotal,
        couponCode: appliedCoupon ? appliedCoupon.code : null,
        discountAmount: discountAmount > 0 ? discountAmount : null,
        shippingAddress: shippingAddressData,
        shippingAddressLine:
          typeof shippingAddress === "string" ? shippingAddress : shippingAddress?.addressLine,
        shippingCity: city,
        shippingState: state,
        shippingZipCode: zipCode,
        shippingCountry: country,
        shippingPhone: mobileNumber || customerPhone,
        paymentMethod: "STRIPE",
        status: "CONFIRMED",
        paymentStatus: "PENDING",
        stripePaymentIntentId: paymentIntent.id,
        customerName,
        customerEmail,
        customerPhone: mobileNumber || customerPhone || "",
        items: { create: orderItems },
      },
    });

    console.log(`✅ Guest Stripe PaymentIntent created: ${paymentIntent.id}, order: ${order.id}`);

    return reply.status(200).send({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      orderId: order.id,
      amount: amountInCents,
      displayAmount: totalAmount,
      currency: "aud",
      orderSummary: {
        subtotal: cartCalculations.subtotal,
        subtotalExGST: cartCalculations.subtotalExGST,
        shippingCost: cartCalculations.shippingCost,
        gstAmount: cartCalculations.gstAmount,
        gstPercentage: cartCalculations.gstPercentage,
        gstInclusive: true,
        originalTotal: originalTotal.toFixed(2),
        couponCode: appliedCoupon ? appliedCoupon.code : null,
        discountAmount: discountAmount > 0 ? discountAmount.toFixed(2) : null,
        grandTotal: totalAmount.toFixed(2),
      },
    });
  } catch (error) {
    console.error("❌ createGuestPaymentIntent error:", error);
    return reply.status(500).send({
      success: false,
      message: "Failed to create guest payment intent",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GUEST — Confirm Stripe Payment (no auth required)
// POST /api/payments/guest/confirm
// Body: { paymentIntentId, customerEmail }
// ─────────────────────────────────────────────────────────────────────────────
exports.confirmGuestPayment = async (request, reply) => {
  try {
    const { paymentIntentId, customerEmail } = request.body;

    if (!paymentIntentId || !customerEmail) {
      return reply.status(400).send({
        success: false,
        message: "paymentIntentId and customerEmail are required",
      });
    }

    // Verify payment with Stripe
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (stripeErr) {
      console.error("❌ Stripe retrieve error:", stripeErr.message);
      return reply.status(400).send({
        success: false,
        message: "Failed to verify payment with Stripe",
      });
    }

    // If Stripe says it already succeeded, honour that and proceed to confirmation
    // (handles redirect-based methods like Klarna/Zip that can trigger double-confirm)
    if (paymentIntent.status !== "succeeded") {
      return reply.status(400).send({
        success: false,
        message: `Payment not successful. Stripe status: ${paymentIntent.status}`,
      });
    }

    // Find the guest order — matched by paymentIntentId + customerEmail (no userId)
    const order = await prisma.order.findFirst({
      where: {
        stripePaymentIntentId: paymentIntentId,
        customerEmail,
        userId: null, // guest orders only
      },
      include: { items: { include: { product: true } } },
    });

    if (!order) {
      return reply.status(404).send({
        success: false,
        message: "Guest order not found for this payment",
      });
    }

    // Idempotency guard
    if (order.paymentStatus === "PAID") {
      return reply.status(200).send({
        success: true,
        message: "Payment already confirmed",
        orderId: order.id,
      });
    }

    // Deduct stock, clear cart, mark PAID, send confirmation email, notify admins.
    // handlePaymentSucceeded is the single source of truth — works for webhook,
    // logged-in confirm, and guest confirm paths without duplication.
    await handlePaymentSucceeded(paymentIntentId);

    console.log(`✅ Guest Stripe payment confirmed for order: ${order.id}`);

    return reply.status(200).send({
      success: true,
      message: "Guest payment confirmed and order placed successfully",
      orderId: order.id,
      status: "CONFIRMED",
      paymentStatus: "PAID",
    });
  } catch (error) {
    console.error("❌ confirmGuestPayment error:", error);
    // Stripe API errors (e.g. payment_intent_unexpected_state) are user-facing
    if (error.type === "StripeInvalidRequestError") {
      return reply.status(400).send({
        success: false,
        message: error.message,
        stripeCode: error.code,
      });
    }
    return reply.status(500).send({
      success: false,
      message: "Failed to confirm guest payment",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GUEST — Check payment + order status (no auth - verified by email)
// GET /api/payments/guest/status?orderId=xxx&customerEmail=xxx
// ─────────────────────────────────────────────────────────────────────────────
exports.getGuestPaymentStatus = async (request, reply) => {
  try {
    const { orderId, customerEmail } = request.query;

    if (!orderId || !customerEmail) {
      return reply.status(400).send({
        success: false,
        message: "orderId and customerEmail are required",
      });
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, customerEmail, userId: null },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        totalAmount: true,
        createdAt: true,
      },
    });

    if (!order) {
      return reply.status(404).send({ success: false, message: "Order not found" });
    }

    return reply.status(200).send({ success: true, order });
  } catch (error) {
    console.error("❌ getGuestPaymentStatus error:", error);
    return reply.status(500).send({
      success: false,
      message: "Failed to get guest payment status",
    });
  }
};
