/**
 * PayPal Payment Controller
 * Uses PayPal REST API v2 directly (no deprecated SDK).
 *
 * Flow:
 *  1. Frontend → POST /api/payments/paypal/create-order
 *        Backend creates a PayPal order + PENDING DB order
 *        Returns { paypalOrderId, approveUrl, orderId }
 *
 *  2. Frontend shows PayPal button / redirects user to approveUrl
 *     User approves on PayPal (handled fully by PayPal JS SDK on frontend
 *     or the redirect URL).
 *
 *  3. Frontend → POST /api/payments/paypal/capture-order { paypalOrderId }
 *        Backend captures the payment, deducts stock, confirms order.
 *        Returns { success, orderId, status, paymentStatus }
 *
 *  4. PayPal → POST /api/payments/paypal/webhook  (server-side safety net)
 *        Handles CHECKOUT.ORDER.APPROVED / PAYMENT.CAPTURE.COMPLETED events.
 */

const axios = require("axios");
const prisma = require("../config/prisma");
const { calculateCartTotals } = require("./cart");
const { sendOrderConfirmationEmail } = require("../utils/emailService");
const { notifyAdminNewOrder } = require("./notification");

// ─────────────────────────────────────────────────────────────────────────────
// PayPal API helpers
// ─────────────────────────────────────────────────────────────────────────────
const PAYPAL_BASE = process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com";

/**
 * Exchange client credentials for a short-lived Bearer token.
 * PayPal tokens last 9 hours but we fetch fresh ones per request (stateless).
 */
async function getPayPalAccessToken() {
  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await axios.post(
    `${PAYPAL_BASE}/v1/oauth2/token`,
    "grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  return response.data.access_token;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Create PayPal Order + Pending DB Order
// POST /api/payments/paypal/create-order
// Body: { shippingAddress, shippingMethodId, gstId, country, city, zipCode, state, mobileNumber }
// ─────────────────────────────────────────────────────────────────────────────
exports.createOrder = async (request, reply) => {
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

    // ── Create PayPal Order via REST API ──────────────────────────────────────
    const accessToken = await getPayPalAccessToken();

    const paypalOrderPayload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "AUD",
            value: totalAmount.toFixed(2),
            breakdown: {
              item_total: {
                currency_code: "AUD",
                value: parseFloat(cartCalculations.subtotal).toFixed(2),
              },
              shipping: {
                currency_code: "AUD",
                value: parseFloat(cartCalculations.shippingCost).toFixed(2),
              },
              tax_total: {
                currency_code: "AUD",
                value: parseFloat(cartCalculations.gstAmount).toFixed(2),
              },
            },
          },
          items: cart.items.map((item) => ({
            name: item.product.title.substring(0, 127), // PayPal max 127 chars
            quantity: String(item.quantity),
            unit_amount: {
              currency_code: "AUD",
              value: parseFloat(item.product.price).toFixed(2),
            },
          })),
          description: `Order from Aboriginal Art Marketplace`,
          custom_id: userId, // carry userId so webhook can look up the order
          // ── Pre-fill shipping address so PayPal does NOT show its own
          //    address form inside the popup (shipping_preference below)
          shipping: {
            type: "SHIPPING",
            name: {
              full_name: (user.name || "Customer").substring(0, 300),
            },
            address: {
              address_line_1:
                (typeof shippingAddress === "string"
                  ? shippingAddress
                  : shippingAddress?.addressLine) || "",
              admin_area_2: city    || "Sydney",
              admin_area_1: state   || "NSW",
              postal_code : zipCode || "2000",
              country_code: "AU",
            },
          },
        },
      ],
      application_context: {
        brand_name: "Alpa Marketplace",
        locale: "en-AU",
        landing_page: "LOGIN",
        user_action: "PAY_NOW",
        // SET_PROVIDED_ADDRESS → PayPal uses the shipping object above and
        // skips its own address collection screen inside the popup entirely.
        shipping_preference: "SET_PROVIDED_ADDRESS",
        // These URLs are for redirect-based flow; if using PayPal JS SDK popup
        // they are effectively ignored but still required by the API.
        return_url: `${process.env.FRONTEND_URL}checkout/paypal/success`,
        cancel_url: `${process.env.FRONTEND_URL}checkout/paypal/cancel`,
      },
    };

    const ppResponse = await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders`,
      paypalOrderPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
      }
    );

    const paypalOrder = ppResponse.data;
    const paypalOrderId = paypalOrder.id;

    // Extract the approval URL (for redirect-based flow)
    const approveLink = paypalOrder.links?.find((l) => l.rel === "approve");
    const approveUrl = approveLink?.href || null;

    // ── Create PENDING DB Order ───────────────────────────────────────────────
    const orderItems = cart.items.map((item) => ({
      productId: item.product.id,
      quantity: item.quantity,
      price: Number(item.product.price),
    }));

    const shippingAddressData =
      typeof shippingAddress === "string"
        ? { address: shippingAddress }
        : {
            ...shippingAddress,
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
                estimatedDays: shippingMethod.estimatedDays,
              },
              gstDetails: cartCalculations.gstDetails,
            },
          };

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
        paymentMethod: "PAYPAL",
        status: "CONFIRMED",
        paymentStatus: "PENDING",
        paypalOrderId, // store PayPal order ID
        customerName: user.name,
        customerEmail: user.email,
        customerPhone: mobileNumber || user.phone || "",
        items: { create: orderItems },
      },
    });

    return reply.status(200).send({
      success: true,
      paypalOrderId,
      approveUrl,      // ← Use this for redirect flow
      orderId: order.id,
      amount: totalAmount,
      currency: "AUD",
      orderSummary: {
        subtotal: cartCalculations.subtotal,
        shippingCost: cartCalculations.shippingCost,
        gstAmount: cartCalculations.gstAmount,
        grandTotal: cartCalculations.grandTotal,
      },
      // Instructions for the frontend:
      // 1. Popup/JS SDK flow: pass `paypalOrderId` to PayPal JS SDK → onApprove callback
      //    then call POST /api/payments/paypal/capture-order { paypalOrderId }
      // 2. Redirect flow: redirect user to `approveUrl`, after approval PayPal
      //    redirects to return_url with ?token=paypalOrderId, then call capture.
    });
  } catch (error) {
    console.error("❌ PayPal createOrder error:", error?.response?.data || error.message);
    return reply.status(500).send({
      success: false,
      message: "Failed to create PayPal order",
      error: error?.response?.data?.message || error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Capture PayPal Payment + Confirm DB Order
// POST /api/payments/paypal/capture-order
// Body: { paypalOrderId }
// ─────────────────────────────────────────────────────────────────────────────
exports.captureOrder = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { paypalOrderId } = request.body;

    if (!paypalOrderId) {
      return reply.status(400).send({
        success: false,
        message: "paypalOrderId is required",
      });
    }

    // ── Capture with PayPal ───────────────────────────────────────────────────
    const accessToken = await getPayPalAccessToken();

    const captureResponse = await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders/${paypalOrderId}/capture`,
      {},
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
      }
    );

    const captureData = captureResponse.data;
    const captureStatus = captureData.status; // "COMPLETED" on success

    if (captureStatus !== "COMPLETED") {
      return reply.status(400).send({
        success: false,
        message: `PayPal capture not completed. Status: ${captureStatus}`,
        paypalStatus: captureStatus,
      });
    }

    // ── Find the DB Order ─────────────────────────────────────────────────────
    const order = await prisma.order.findFirst({
      where: { paypalOrderId, userId },
      include: { items: { include: { product: true } } },
    });

    if (!order) {
      return reply.status(404).send({
        success: false,
        message: "Order not found for this PayPal order",
      });
    }

    // Idempotency guard
    if (order.paymentStatus === "PAID") {
      return reply.status(200).send({
        success: true,
        message: "Payment already confirmed",
        orderId: order.id,
        status: order.status,
        paymentStatus: order.paymentStatus,
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const cart = await prisma.cart.findUnique({ where: { userId } });

    // ── Transactionally: deduct stock + clear cart + confirm order ─────────────
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

    console.log(`✅ PayPal payment captured for order: ${order.id} (PayPal: ${paypalOrderId})`);

    // Send confirmation email (non-blocking)
    if (user?.email) {
      sendOrderConfirmationEmail(user.email, user.name, {
        orderId: order.id,
        totalAmount: Number(order.totalAmount),
        itemCount: order.items.length,
        products: order.items.map((item) => ({
          title: item.product.title,
          quantity: item.quantity,
          price: item.price,
        })),
        shippingAddress: order.shippingAddressLine,
        paymentMethod: "PayPal",
      }).catch((e) => console.error("Email error (non-blocking):", e.message));
    }

    // Notify admins (non-blocking)
    notifyAdminNewOrder(order.id, {
      customerName: user?.name,
      totalAmount: Number(order.totalAmount).toFixed(2),
      itemCount: order.items.length,
      orderId: order.id,
    }).catch((e) => console.error("Admin notification error (non-blocking):", e.message));

    return reply.status(200).send({
      success: true,
      message: "PayPal payment captured and order confirmed successfully",
      orderId: order.id,
      status: "CONFIRMED",
      paymentStatus: "PAID",
      paypalOrderId,
    });
  } catch (error) {
    // Handle 422 "ORDER_ALREADY_CAPTURED" gracefully
    const paypalError = error?.response?.data;
    if (paypalError?.name === "ORDER_ALREADY_CAPTURED") {
      return reply.status(200).send({
        success: true,
        message: "Order was already captured by PayPal",
        paypalOrderId: request.body.paypalOrderId,
      });
    }

    console.error("❌ PayPal captureOrder error:", paypalError || error.message);
    return reply.status(500).send({
      success: false,
      message: "Failed to capture PayPal order",
      error: paypalError?.message || error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 (Safety net) — PayPal Webhook
// POST /api/payments/paypal/webhook
// No auth — verified by PayPal-Auth-Algo + PayPal-Transmission-* headers
// Register this URL in: https://developer.paypal.com/dashboard/webhooks/sandbox
// Events to subscribe: CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED,
//                      PAYMENT.CAPTURE.DENIED
// ─────────────────────────────────────────────────────────────────────────────
exports.webhook = async (request, reply) => {
  try {
    // ── Verify PayPal webhook signature ───────────────────────────────────────
    const transmissionId  = request.headers["paypal-transmission-id"];
    const transmissionTime = request.headers["paypal-transmission-time"];
    const certUrl         = request.headers["paypal-cert-url"];
    const authAlgo        = request.headers["paypal-auth-algo"];
    const transmissionSig = request.headers["paypal-transmission-sig"];
    const webhookId       = process.env.PAYPAL_WEBHOOK_ID; // optional but recommended

    // Only verify if PAYPAL_WEBHOOK_ID is configured — skip in development
    if (webhookId && transmissionId) {
      const accessToken = await getPayPalAccessToken();
      const verifyPayload = {
        transmission_id:   transmissionId,
        transmission_time: transmissionTime,
        cert_url:          certUrl,
        auth_algo:         authAlgo,
        transmission_sig:  transmissionSig,
        webhook_id:        webhookId,
        webhook_event:     request.body,
      };

      const verifyResponse = await axios.post(
        `${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`,
        verifyPayload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (verifyResponse.data?.verification_status !== "SUCCESS") {
        console.warn("⚠️ PayPal webhook signature verification failed");
        return reply.status(400).send({ error: "Webhook signature verification failed" });
      }
    }

    const event = request.body;
    const eventType = event?.event_type;
    console.log(`📦 PayPal Webhook received: ${eventType}`);

    switch (eventType) {
      case "PAYMENT.CAPTURE.COMPLETED": {
        // This is the most reliable event — payment money has moved
        const resource = event.resource;
        const paypalOrderId = resource?.supplementary_data?.related_ids?.order_id
          || resource?.id;

        if (paypalOrderId) {
          await handlePayPalPaymentCompleted(paypalOrderId);
        }
        break;
      }

      case "CHECKOUT.ORDER.APPROVED": {
        // User approved but capture hasn't happened yet — log only
        const resource = event.resource;
        console.log(`ℹ️ PayPal order approved (not yet captured): ${resource?.id}`);
        break;
      }

      case "PAYMENT.CAPTURE.DENIED":
      case "PAYMENT.CAPTURE.DECLINED": {
        const resource = event.resource;
        const paypalOrderId = resource?.supplementary_data?.related_ids?.order_id;
        if (paypalOrderId) {
          await prisma.order.updateMany({
            where: { paypalOrderId },
            data: { paymentStatus: "FAILED" },
          });
          console.log(`⚠️ PayPal payment denied for order: ${paypalOrderId}`);
        }
        break;
      }

      default:
        console.log(`Unhandled PayPal event: ${eventType}`);
    }

    return reply.status(200).send({ received: true });
  } catch (error) {
    console.error("❌ PayPal webhook handler error:", error.message);
    return reply.status(500).send({ error: "Webhook processing failed" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — used by webhook handler
// ─────────────────────────────────────────────────────────────────────────────
async function handlePayPalPaymentCompleted(paypalOrderId) {
  const order = await prisma.order.findFirst({
    where: {
      paypalOrderId,
      paymentStatus: { not: "PAID" },
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

  console.log(`✅ [Webhook] PayPal order ${order.id} confirmed via PAYMENT.CAPTURE.COMPLETED`);
}
