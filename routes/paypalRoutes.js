const { authenticateUser } = require("../middlewares/authMiddleware");
const paypalController = require("../controllers/paypal");

async function paypalRoutes(fastify, options) {
  // ─── Webhook — must receive raw JSON body for signature verification.
  //     Register in its own scoped sub-plugin with a buffer content-type parser.
  fastify.register(async function webhookScope(fastify) {
    fastify.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      function (req, body, done) {
        req.rawBody = body;
        try {
          done(null, JSON.parse(body.toString()));
        } catch (err) {
          done(err);
        }
      }
    );

    /**
     * POST /api/payments/paypal/webhook
     *
     * PayPal sends events here (PAYMENT.CAPTURE.COMPLETED, etc.)
     * No auth — verified by PayPal-Transmission-* headers.
     *
     * Register this URL in PayPal Developer Dashboard:
     *   https://developer.paypal.com/dashboard/webhooks/sandbox
     *
     * Recommended subscribed events:
     *   - CHECKOUT.ORDER.APPROVED
     *   - PAYMENT.CAPTURE.COMPLETED
     *   - PAYMENT.CAPTURE.DENIED
     *
     * For local testing use a tunnel (e.g. ngrok):
     *   ngrok http 5000
     *   → set https://<ngrok-id>.ngrok.io/api/payments/paypal/webhook as webhook URL
     */
    fastify.post("/webhook", paypalController.webhook);
  });

  // ─── Authenticated PayPal routes ──────────────────────────────────────────

  /**
   * POST /api/payments/paypal/create-order
   *
   * Call when the customer clicks "Pay with PayPal".
   *
   * Request body:
   * {
   *   "shippingAddress"  : { "addressLine": "123 Main St", ... },
   *   "shippingMethodId" : "<id>",
   *   "gstId"            : "<id>",       // optional
   *   "country"          : "Australia",
   *   "city"             : "Sydney",
   *   "zipCode"          : "2000",
   *   "state"            : "NSW",
   *   "mobileNumber"     : "0400000000"
   * }
   *
   * Response:
   * {
   *   "success"       : true,
   *   "paypalOrderId" : "5O190127TN364715T",   ← pass to PayPal JS SDK
   *   "approveUrl"    : "https://www.sandbox.paypal.com/checkoutnow?token=...",
   *   "orderId"       : "clxxx...",             ← your DB order id
   *   "amount"        : 150.00,
   *   "currency"      : "AUD",
   *   "orderSummary"  : { subtotal, shippingCost, gstAmount, grandTotal }
   * }
   *
   * Frontend flow (PayPal JS SDK):
   *   createOrder: () => paypalOrderId          ← return from this endpoint
   *   onApprove:   ({ orderID }) =>             ← call capture-order below
   *     POST /api/payments/paypal/capture-order { paypalOrderId: orderID }
   */
  fastify.post(
    "/create-order",
    { preHandler: authenticateUser },
    paypalController.createOrder
  );

  /**
   * POST /api/payments/paypal/capture-order
   *
   * Call AFTER the user has approved the payment on PayPal.
   *
   * Request body:
   * { "paypalOrderId": "5O190127TN364715T" }
   *
   * Response:
   * {
   *   "success"       : true,
   *   "orderId"       : "clxxx...",
   *   "status"        : "CONFIRMED",
   *   "paymentStatus" : "PAID",
   *   "paypalOrderId" : "5O190127TN364715T"
   * }
   */
  fastify.post(
    "/capture-order",
    { preHandler: authenticateUser },
    paypalController.captureOrder
  );
}

module.exports = paypalRoutes;
