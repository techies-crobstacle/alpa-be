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

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const cart = await prisma.cart.findUnique({ where: { userId } });

    // Transactionally: deduct stock + clear cart + update order
    await prisma.$transaction(async (tx) => {
      // Deduct stock
      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      // Clear cart
      if (cart) {
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      }

      // Update order to CONFIRMED + PAID
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "CONFIRMED",
          paymentStatus: "PAID",
        },
      });
    });

    console.log(`✅ Stripe payment confirmed for order: ${order.id}`);

    // Send confirmation email (non-blocking)
    if (user?.email) {
      // orderSummary is embedded in the shippingAddress JSON field
      const storedSummary = typeof order.shippingAddress === 'object'
        ? order.shippingAddress?.orderSummary
        : null;

      sendOrderConfirmationEmail(user.email, user.name, {
        orderId: order.id,
        totalAmount: Number(order.totalAmount),
        itemCount: order.items.length,
        products: order.items.map((item) => ({
          title: item.product.title,
          quantity: item.quantity,
          price: Number(item.price),
        })),
        shippingAddress: order.shippingAddressLine,
        paymentMethod: "Stripe",
        customerPhone: user.phone || "",
        orderSummary: storedSummary || undefined,
      }).catch((e) =>
        console.error("Email error (non-blocking):", e.message)
      );
    }

    // Notify admins (non-blocking)
    notifyAdminNewOrder(order.id, {
      customerName: user?.name,
      totalAmount: Number(order.totalAmount).toFixed(2),
      itemCount: order.items.length,
      orderId: order.id,
    }).catch((e) =>
      console.error("Admin notification error (non-blocking):", e.message)
    );

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

  if (!order) return; // already handled or not found

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

    await tx.order.update({
      where: { id: order.id },
      data: { status: "CONFIRMED", paymentStatus: "PAID" },
    });
  });

  console.log(`✅ [Webhook] Order ${order.id} confirmed via payment_intent.succeeded`);
}
