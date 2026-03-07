const sgMail = require('@sendgrid/mail');

/**
 * SENDGRID EMAIL SERVICE (Works on Render.com!)
 * 
 * Setup Instructions:
 * 1. Sign up at https://sendgrid.com (FREE tier: 100 emails/day)
 * 2. Go to Settings > API Keys > Create API Key
 * 3. Add to your .env file:
 *    SENDGRID_API_KEY=your_api_key_here
 *    SENDER_EMAIL=verified@yourdomain.com
 * 4. Verify your sender email in SendGrid dashboard
 * 5. Install: npm install @sendgrid/mail
 */

// Initialize SendGrid
let emailConfigured = false;

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  emailConfigured = true;
  console.log("âœ… SendGrid email service initialized");
  console.log("SendGrid senderEmail:", process.env.SENDER_EMAIL);
  console.log("SendGrid API Key present:", !!process.env.SENDGRID_API_KEY);
} else {
  console.log("âš ï¸  SendGrid API key not configured. Emails will be logged to console.");
}

const isDevelopmentMode = !emailConfigured;
const senderEmail = process.env.SENDER_EMAIL || process.env.EMAIL_USER || 'noreply@yourapp.com';
const senderName = process.env.SENDER_NAME || 'MIA Marketplace';

/**
 * Enhances every outgoing SendGrid message with:
 *  - A plain-text body (required for spam-filter compliance)
 *  - Reply-To / List-Unsubscribe headers (deliverability signals)
 * Call this instead of sgMail.send(msg) directly.
 */
const buildMsg = (msg) => {
  // Strip HTML to produce a plain-text alternative
  const text = (msg.html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&#\d+;/g, '')
    .replace(/&[a-z]+;/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/(\s*\n\s*){3,}/g, '\n\n')
    .trim();

  const replyToEmail = process.env.REPLY_TO_EMAIL || senderEmail;
  const unsubscribeEmail = process.env.UNSUBSCRIBE_EMAIL || senderEmail;

  return {
    ...msg,
    text,
    // SendGrid requires replyTo as a dedicated field — NOT inside headers
    replyTo: { email: replyToEmail, name: senderName },
    headers: {
      // List-Unsubscribe is allowed as a custom header
      'List-Unsubscribe': `<mailto:${unsubscribeEmail}?subject=unsubscribe>`,
      ...(msg.headers || {}),
    },
  };
};

// Wrap sgMail.send so every outgoing message automatically gets
// plain-text body + Reply-To + List-Unsubscribe headers
const _sgMailSend = sgMail.send.bind(sgMail);
sgMail.send = (msg, ...args) => _sgMailSend(buildMsg(msg), ...args);

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP email
const sendOTPEmail = async (email, otp, name) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("ðŸ“§ DEVELOPMENT MODE - OTP Email");
    console.log("=".repeat(50));
    console.log(`To: ${email}`);
    console.log(`Name: ${name}`);
    console.log(`OTP: ${otp}`);
    console.log("=".repeat(50) + "\n");
    return { success: true };
  }

  const msg = {
    to: email,
    from: {
      email: senderEmail,
      name: senderName
    },
    subject: "Email Verification - OTP",
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
      <body style="margin:0;padding:0;background-color:#FDF5F3;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FDF5F3;padding:30px 0;">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(90,30,18,0.12);">
              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#5A1E12 0%,#7D2E1E 100%);padding:36px 40px;text-align:center;">
                  <p style="margin:0 0 8px 0;font-size:13px;color:#F9EDE9;letter-spacing:3px;text-transform:uppercase;">MIA Marketplace</p>
                  <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:1px;">Email Verification</h1>
                  <p style="margin:10px 0 0;color:#F0D0C8;font-size:14px;">Verify your identity to continue</p>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:40px 40px 30px;">
                  <p style="color:#3D1009;font-size:17px;margin:0 0 8px;">Hi <strong>${name}</strong>,</p>
                  <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 30px;">Thank you for registering! Use the One-Time Password below to verify your email address.</p>

                  <!-- OTP Box -->
                  <div style="background:linear-gradient(135deg,#F9EDE9 0%,#FDF5F3 100%);border:2px dashed #C4603A;border-radius:10px;padding:28px;text-align:center;margin:0 0 30px;">
                    <p style="margin:0 0 6px;color:#7D2E1E;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Your OTP Code</p>
                    <div style="font-size:40px;font-weight:800;letter-spacing:12px;color:#5A1E12;">${otp}</div>
                    <p style="margin:10px 0 0;color:#C4603A;font-size:13px;">â± Expires in 10 minutes</p>
                  </div>

                  <div style="background-color:#F9EDE9;border-left:4px solid #C4603A;border-radius:0 6px 6px 0;padding:14px 18px;">
                    <p style="margin:0;color:#7D2E1E;font-size:13px;line-height:1.6;">If you did not request this OTP, please ignore this email. Your account remains secure.</p>
                  </div>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color:#3D1009;padding:22px 40px;text-align:center;">
                  <p style="margin:0;color:#F0D0C8;font-size:12px;">This is an automated email â€” please do not reply.</p>
                  <p style="margin:6px 0 0;color:#8B5C54;font-size:11px;">&copy;© 2026 MIA Marketplace. All rights reserved.</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log("âœ… Email sent successfully to:", email);
    return { success: true };
  } catch (error) {
    console.error("âŒ SendGrid error:", error.response?.body || error.message);
    
    // Fallback for development
    if (process.env.NODE_ENV === 'development') {
      console.log("âš ï¸ Development mode: Returning success despite email error");
      console.log("ðŸ“ OTP for testing:", otp);
      return { success: true };
    }
    
    return { success: false, error: error.message };
  }
};

// Send Order Confirmation Email
const sendOrderConfirmationEmail = async (email, customerName, orderDetails) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("ðŸ“§ DEVELOPMENT MODE - Order Confirmation Email");
    console.log("=".repeat(50));
    console.log(`To: ${email}`);
    console.log(`Customer: ${customerName}`);
    console.log(`Order ID: ${orderDetails.orderId}`);
    console.log(`Total: $${orderDetails.totalAmount.toFixed(2)}`);
    console.log("=".repeat(50) + "\n");
    return { success: true, message: "Email logged to console (dev mode)" };
  }

  const productRows = orderDetails.products.map(product => `
    <tr style="border-bottom: 1px solid #ddd;">
      <td style="padding: 12px 8px;">${product.title || 'Product'}</td>
      <td style="padding: 12px 8px; text-align: center;">${product.quantity}</td>
      <td style="padding: 12px 8px; text-align: right;">$${(product.price || 0).toFixed(2)}</td>
      <td style="padding: 12px 8px; text-align: right; font-weight: bold;">$${((product.price || 0) * (product.quantity || 0)).toFixed(2)}</td>
    </tr>
  `).join('');

  // Normalise: shippingAddress may be a plain string (legacy) or an object
  const shippingAddrObj = typeof orderDetails.shippingAddress === 'string'
    ? { addressLine: orderDetails.shippingAddress }
    : (orderDetails.shippingAddress || {});

  const shippingLine  = shippingAddrObj.addressLine || shippingAddrObj.address || shippingAddrObj.street || '';
  const shippingCity  = shippingAddrObj.city  || '';
  const shippingState = shippingAddrObj.state || '';
  const shippingZip   = shippingAddrObj.pincode || shippingAddrObj.zipCode || shippingAddrObj.postalCode || '';
  const shippingName  = shippingAddrObj.name || customerName;
  const addressParts  = [shippingLine, shippingCity, shippingState, shippingZip].filter(Boolean).join(', ');

  // Build guest-aware tracking URL
  const baseUrl = process.env.FRONTEND_URL || 'https://apla-fe.vercel.app';
  const backendBaseUrl = process.env.BACKEND_URL || process.env.API_URL || 'https://alpa-back.onrender.com';
  const trackingUrl = orderDetails.isGuest
    ? `${baseUrl}/guest/track-order?orderId=${orderDetails.orderId}&email=${encodeURIComponent(email)}`
    : `${baseUrl}/orders/${orderDetails.orderId}`;
  const invoiceUrl = orderDetails.isGuest
    ? `${backendBaseUrl}/api/orders/guest/invoice?orderId=${orderDetails.orderId}&customerEmail=${encodeURIComponent(email)}`
    : `${baseUrl}/orders/${orderDetails.orderId}`;

  // Build message with optional PDF attachment
  const msg = {
    to: email,
    from: {
      email: senderEmail,
      name: senderName
    },
    subject: `Order Confirmation - Invoice #${orderDetails.orderId}`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
      <body style="margin:0;padding:0;background-color:#FDF5F3;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FDF5F3;padding:30px 0;">
          <tr><td align="center">
            <table width="650" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(90,30,18,0.12);">
              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#5A1E12 0%,#7D2E1E 100%);padding:36px 40px;text-align:center;">
                  <p style="margin:0 0 8px 0;font-size:13px;color:#F9EDE9;letter-spacing:3px;text-transform:uppercase;">MIA Marketplace</p>
                  <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">&#127912; Order Confirmed!</h1>
                  <p style="margin:10px 0 0;color:#F0D0C8;font-size:15px;">Thank you for your purchase, ${customerName}!</p>
                </td>
              </tr>
              <!-- Invoice Meta -->
              <tr>
                <td style="padding:0;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9EDE9;border-bottom:3px solid #C4603A;">
                    <tr>
                      <td style="padding:16px 40px;">
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Invoice #</strong></td>
                            <td style="padding:6px 0;color:#3D1009;font-size:14px;text-align:right;">${orderDetails.orderId}</td>
                          </tr>
                          <tr>
                            <td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Order Date</strong></td>
                            <td style="padding:6px 0;color:#3D1009;font-size:14px;text-align:right;">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
                          </tr>
                          <tr>
                            <td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Payment Method</strong></td>
                            <td style="padding:6px 0;color:#3D1009;font-size:14px;text-align:right;">${orderDetails.paymentMethod === 'STRIPE' || orderDetails.paymentMethod === 'Stripe' || !orderDetails.paymentMethod ? 'Debit/Credit Card' : orderDetails.paymentMethod}</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <!-- Shipping Info -->
              <tr>
                <td style="padding:28px 40px 10px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td width="48%" valign="top" style="padding-right:10px;">
                        <div style="background:#F9EDE9;border-radius:8px;padding:16px;border-top:3px solid #5A1E12;">
                          <p style="margin:0 0 10px;color:#5A1E12;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Your Details</p>
                          <p style="margin:4px 0;color:#333;font-size:14px;"><strong>${customerName}</strong></p>
                          <p style="margin:4px 0;color:#555;font-size:13px;">${email}</p>
                          ${orderDetails.customerPhone ? `<p style="margin:4px 0;color:#555;font-size:13px;">${orderDetails.customerPhone}</p>` : ''}
                        </div>
                      </td>
                      <td width="4%"></td>
                      <td width="48%" valign="top" style="padding-left:10px;">
                        <div style="background:#F9EDE9;border-radius:8px;padding:16px;border-top:3px solid #C4603A;">
                          <p style="margin:0 0 10px;color:#5A1E12;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Shipping Address</p>
                          <p style="margin:4px 0;color:#333;font-size:14px;"><strong>${shippingName}</strong></p>
                          <p style="margin:4px 0;color:#555;font-size:13px;line-height:1.6;">${addressParts || 'Address not provided'}</p>
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <!-- Items Table -->
              <tr>
                <td style="padding:10px 40px 28px;">
                  <p style="color:#5A1E12;font-size:16px;font-weight:700;margin:0 0 12px;">Order Items</p>
                  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(90,30,18,0.1);">
                    <thead>
                      <tr style="background-color:#5A1E12;">
                        <th style="padding:13px 12px;text-align:left;color:#fff;font-size:13px;">Product</th>
                        <th style="padding:13px 12px;text-align:center;color:#fff;font-size:13px;">Qty</th>
                        <th style="padding:13px 12px;text-align:right;color:#fff;font-size:13px;">Unit Price</th>
                        <th style="padding:13px 12px;text-align:right;color:#fff;font-size:13px;">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${productRows}
                    </tbody>
                    <tfoot>
                      <!-- Subtotal row -->
                      <tr style="background-color:#fdf5f3;">
                        <td colspan="3" style="padding:10px 12px;text-align:right;color:#555;font-size:14px;">Subtotal (inc. GST)</td>
                        <td style="padding:10px 12px;text-align:right;color:#333;font-size:14px;">$${
                          orderDetails.orderSummary
                            ? parseFloat(orderDetails.orderSummary.subtotal || 0).toFixed(2)
                            : orderDetails.totalAmount.toFixed(2)
                        }</td>
                      </tr>
                      <!-- Shipping row -->
                      <tr style="background-color:#fdf5f3;">
                        <td colspan="3" style="padding:6px 12px;text-align:right;color:#555;font-size:14px;">
                          Shipping${orderDetails.orderSummary?.shippingMethod?.name ? ` â€” ${orderDetails.orderSummary.shippingMethod.name}` : ''}${orderDetails.orderSummary?.shippingMethod?.estimatedDays ? ` (${orderDetails.orderSummary.shippingMethod.estimatedDays})` : ''}
                        </td>
                        <td style="padding:6px 12px;text-align:right;color:#333;font-size:14px;">${
                          orderDetails.orderSummary && parseFloat(orderDetails.orderSummary.shippingCost || 0) > 0
                            ? `$${parseFloat(orderDetails.orderSummary.shippingCost).toFixed(2)}`
                            : '<span style="color:#2e7d32;font-weight:600;">FREE</span>'
                        }</td>
                      </tr>
                      <!-- Coupon Discount row (only shown when a coupon was applied) -->
                      ${orderDetails.orderSummary?.discountAmount && parseFloat(orderDetails.orderSummary.discountAmount) > 0 ? `
                      <tr style="background-color:#fdf5f3;">
                        <td colspan="3" style="padding:6px 12px;text-align:right;color:#2e7d32;font-size:14px;">Coupon Discount${orderDetails.orderSummary.couponCode ? ` (${orderDetails.orderSummary.couponCode})` : ''}</td>
                        <td style="padding:6px 12px;text-align:right;color:#2e7d32;font-size:14px;font-weight:600;">-$${parseFloat(orderDetails.orderSummary.discountAmount).toFixed(2)}</td>
                      </tr>` : ''}
                      <!-- GST extracted row -->
                      <tr style="background-color:#fdf5f3;border-top:1px dashed #ddd;">
                        <td colspan="3" style="padding:6px 12px;text-align:right;font-size:13px;color:#555">
                          GST included${orderDetails.orderSummary?.gstPercentage ? ` (${parseFloat(orderDetails.orderSummary.gstPercentage).toFixed(0)}%)` : ''}
                        </td>
                        <td style="padding:6px 12px;text-align:right;color:#888;font-size:13px;font-style:italic;">$${
                          orderDetails.orderSummary
                            ? parseFloat(orderDetails.orderSummary.gstAmount || 0).toFixed(2)
                            : '0.00'
                        }</td>
                      </tr>
                      <!-- Net ex-GST row -->
                      <tr style="background-color:#fdf5f3;">
                        <td colspan="3" style="padding:6px 12px;text-align:right;font-size:13px;color:#555">Net amount (ex. GST)</td>
                        <td style="padding:6px 12px;text-align:right;color:#888;font-size:13px;font-style:italic;">$${
                          orderDetails.orderSummary
                            ? parseFloat(orderDetails.orderSummary.subtotalExGST || 0).toFixed(2)
                            : '0.00'
                        }</td>
                      </tr>
                      <!-- Grand Total row -->
                      <tr style="background-color:#F9EDE9;border-top:2px solid #C4603A;">
                        <td colspan="3" style="padding:16px 12px;text-align:right;color:#5A1E12;font-size:16px;font-weight:700;">Grand Total</td>
                        <td style="padding:16px 12px;text-align:right;color:#5A1E12;font-size:20px;font-weight:800;">$${orderDetails.totalAmount.toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </td>
              </tr>
              <!-- Next Steps -->
              <tr>
                <td style="padding:0 40px 28px;">
                  <div style="background:#F9EDE9;border-left:4px solid #C4603A;border-radius:0 8px 8px 0;padding:16px 20px;">
                    <p style="margin:0 0 8px;color:#5A1E12;font-weight:700;font-size:14px;">&#128230; What happens next?</p>
                    <p style="margin:4px 0;color:#7D2E1E;font-size:13px;">&#10003; Your order is being processed by our sellers</p>
                    <p style="margin:4px 0;color:#7D2E1E;font-size:13px;">&#10003; You'll receive a shipping confirmation when dispatched</p>
                    <p style="margin:4px 0;color:#7D2E1E;font-size:13px;">&#10003; Track your order anytime from your account</p>
                  </div>
                </td>
              </tr>
              <!-- CTA -->
              <tr>
                <td style="padding:0 40px 36px;text-align:center;">
                  <table width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td style="padding-right:8px;text-align:right;">
                      <a href="${trackingUrl}" style="display:inline-block;background-color:#5A1E12;color:#ffffff;padding:13px 28px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;letter-spacing:0.5px;">&#128230; Track Order</a>
                    </td>
                    <td style="padding-left:8px;text-align:left;">
                      <a href="${invoiceUrl}" style="display:inline-block;background-color:#C4603A;color:#ffffff;padding:13px 28px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;letter-spacing:0.5px;">&#128196; Download Invoice</a>
                    </td>
                  </tr></table>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color:#3D1009;padding:22px 40px;text-align:center;">
                  <p style="margin:0 0 4px;color:#F0D0C8;font-size:13px;">Thank you for supporting Aboriginal artists! &#127775;</p>
                  <p style="margin:0;color:#8B5C54;font-size:11px;">This is an automated email â€” please do not reply. &copy; 2026 MIA Marketplace.</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  };

  try {
    // Attach invoice PDF if provided
    if (orderDetails.invoicePDFBuffer) {
      msg.attachments = [{
        content: orderDetails.invoicePDFBuffer.toString('base64'),
        filename: `invoice-${orderDetails.orderId}.pdf`,
        type: 'application/pdf',
        disposition: 'attachment'
      }];
    }
    await sgMail.send(msg);
    console.log(`âœ… Order confirmation email sent to ${email}`);
    return { success: true, message: "Email sent successfully" };
  } catch (error) {
    console.error("âŒ Email sending error:", error.response?.body || error.message);
    return { success: false, error: error.message };
  }
};

// Send Order Status Update Email
const sendOrderStatusEmail = async (email, customerName, orderDetails) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("ðŸ“§ DEVELOPMENT MODE - Order Status Update");
    console.log("=".repeat(50));
    console.log(`To: ${email}`);
    console.log(`Status: ${orderDetails.status}`);
    console.log("=".repeat(50) + "\n");
    return { success: true };
  }

  let statusMessage = "";
  let statusColor = "#C4603A";      // default: terracotta (brand accent)
  let statusTextColor = "#ffffff";

  switch (orderDetails.status?.toLowerCase()) {
    case "confirmed":
      statusMessage = "Your order has been confirmed! We are now preparing it for you. &#9989;";
      statusColor = "#4CAF50";
      break;
    case "processing":
      statusMessage = "Your order is now being processed and prepared for shipping. &#128230;";
      statusColor = "#B05E2A";
      break;
    case "packed":
      statusMessage = "Your order has been packed and is ready for shipping! &#128230;";
      statusColor = "#B05E2A";
      break;
    case "shipped":
      statusMessage = "Great news! Your order has been shipped! &#128666;";
      statusColor = "#6B4C9A";
      break;
    case "delivered":
      statusMessage = "Your order has been delivered! &#127881;";
      statusColor = "#C4963A";      // warm amber/cream-gold â€” replaces green
      break;
    case "cancelled":
      statusMessage = "Your order has been cancelled. If you paid online, a refund will be processed within 3&#8211;5 business days.";
      statusColor = "#A03020";
      break;
    case "refund":
      statusMessage = "Your order has been fully refunded. The amount will reflect in your account as per your payment provider timeline.";
      statusColor = "#2E7D32";
      break;
    case "partial_refund":
      statusMessage = "A partial refund has been issued for your order. Please check your account for the credited amount.";
      statusColor = "#6B4C9A";
      break;
    default:
      statusMessage = `Your order status has been updated to: <strong>${orderDetails.status}</strong>`;
  }

  // Build products rows if available
  const productRows = (orderDetails.products || []).map(p => `
    <tr style="border-bottom:1px solid #EDD8CC;">
      <td style="padding:10px 12px;color:#333;font-size:14px;">${p.title || 'Product'}</td>
      <td style="padding:10px 12px;text-align:center;color:#555;font-size:14px;">${p.quantity}</td>
      <td style="padding:10px 12px;text-align:right;color:#555;font-size:14px;">$${(parseFloat(p.price) || 0).toFixed(2)}</td>
      <td style="padding:10px 12px;text-align:right;color:#5A1E12;font-size:14px;font-weight:700;">$${((parseFloat(p.price) || 0) * (p.quantity || 0)).toFixed(2)}</td>
    </tr>
  `).join('');

  // Build shipping address
  const shippingParts = [
    orderDetails.shippingAddress,
    orderDetails.shippingCity,
    orderDetails.shippingState,
    orderDetails.shippingZipCode,
    orderDetails.shippingCountry
  ].filter(Boolean).join(', ');

  // Build guest-aware tracking URL
  const baseUrl = process.env.FRONTEND_URL || 'https://apla-fe.vercel.app';
  const backendBaseUrl = process.env.BACKEND_URL || process.env.API_URL || 'https://alpa-back.onrender.com';
  const trackingUrl = orderDetails.isGuest
    ? `${baseUrl}/guest/track-order?orderId=${orderDetails.orderId}&email=${encodeURIComponent(email)}`
    : `${baseUrl}/orders/${orderDetails.orderId}`;
  const invoiceUrl = orderDetails.isGuest
    ? `${backendBaseUrl}/api/orders/guest/invoice?orderId=${orderDetails.orderId}&customerEmail=${encodeURIComponent(email)}`
    : `${baseUrl}/orders/${orderDetails.orderId}`;

  const msg = {
    to: email,
    from: {
      name: senderName,
      email: senderEmail
    },
        subject: `Order Update: #${orderDetails.orderId?.slice(-8)} — MIA Marketplace`,
    html: `
      <!DOCTYPE html>
      <html>
      <body style="margin:0;padding:0;background-color:#FDF5F3;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FDF5F3;padding:30px 0;">
          <tr><td align="center">
            <table width="620" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(90,30,18,0.12);">

              <!-- Brand Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#5A1E12 0%,#7D2E1E 100%);padding:30px 40px;text-align:center;">
                  <p style="margin:0 0 6px;font-size:12px;color:#F9EDE9;letter-spacing:3px;text-transform:uppercase;">MIA Marketplace</p>
                  <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">&#127912; Order Update</h1>
                </td>
              </tr>

              <!-- Status Banner -->
              <tr>
                <td style="background-color:${statusColor};padding:18px 40px;text-align:center;">
                  <p style="margin:0;color:#ffffff;font-size:16px;font-weight:600;line-height:1.5;">${statusMessage}</p>
                </td>
              </tr>

              <!-- Greeting -->
              <tr>
                <td style="padding:32px 40px 0;">
                  <p style="color:#3D1009;font-size:16px;margin:0 0 6px;">Hi <strong>${customerName}</strong>,</p>
                  <p style="color:#666;font-size:14px;line-height:1.7;margin:0 0 28px;">Here is a full summary of your order for your reference.</p>
                </td>
              </tr>

              <!-- Order Meta -->
              <tr>
                <td style="padding:0 40px 20px;">
                  <div style="background:#F9EDE9;border-radius:8px;padding:20px;border-top:3px solid #5A1E12;">
                    <p style="margin:0 0 14px;color:#5A1E12;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Order Details</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Order ID</strong></td>
                        <td style="padding:6px 0;color:#3D1009;font-size:14px;text-align:right;font-family:monospace;">#${orderDetails.orderId}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Order Date</strong></td>
                        <td style="padding:6px 0;color:#3D1009;font-size:14px;text-align:right;">${orderDetails.orderDate ? new Date(orderDetails.orderDate).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}) : new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</td>
                      </tr>
                      ${orderDetails.paymentMethod ? `<tr><td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Payment Method</strong></td><td style="padding:6px 0;color:#3D1009;font-size:14px;text-align:right;">${orderDetails.paymentMethod}</td></tr>` : ''}
                      <tr>
                        <td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Status</strong></td>
                        <td style="padding:6px 0;text-align:right;"><span style="background-color:${statusColor};color:#fff;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;">${(orderDetails.status || '').toUpperCase()}</span></td>
                      </tr>
                      ${orderDetails.trackingNumber ? `<tr><td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Your Tracking Number</strong></td><td style="padding:6px 0;color:#3D1009;font-size:14px;text-align:right;font-family:monospace;">${orderDetails.trackingNumber}</td></tr>` : ''}
                      ${orderDetails.estimatedDelivery ? `<tr><td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Your Est. Delivery</strong></td><td style="padding:6px 0;color:#3D1009;font-size:14px;text-align:right;">${new Date(orderDetails.estimatedDelivery).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</td></tr>` : ''}
                    </table>
                  </div>
                </td>
              </tr>

              <!-- Shipping Address -->
              ${shippingParts ? `
              <tr>
                <td style="padding:0 40px 20px;">
                  <div style="background:#F9EDE9;border-radius:8px;padding:20px;border-top:3px solid #C4603A;">
                    <p style="margin:0 0 10px;color:#5A1E12;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Shipping Address</p>
                    <p style="margin:0;color:#333;font-size:14px;line-height:1.8;">
                      <strong>${orderDetails.shippingName || customerName}</strong><br/>
                      ${shippingParts}
                      ${orderDetails.shippingPhone ? `<br/>${orderDetails.shippingPhone}` : ''}
                    </p>
                  </div>
                </td>
              </tr>` : ''}

              <!-- Products Table -->
              ${productRows ? `
              <tr>
                <td style="padding:0 40px 20px;">
                  <p style="color:#5A1E12;font-size:15px;font-weight:700;margin:0 0 10px;">Items Ordered</p>
                  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(90,30,18,0.08);">
                    <thead>
                      <tr style="background-color:#5A1E12;">
                        <th style="padding:11px 12px;text-align:left;color:#fff;font-size:13px;">Product</th>
                        <th style="padding:11px 12px;text-align:center;color:#fff;font-size:13px;">Qty</th>
                        <th style="padding:11px 12px;text-align:right;color:#fff;font-size:13px;">Unit Price</th>
                        <th style="padding:11px 12px;text-align:right;color:#fff;font-size:13px;">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>${productRows}</tbody>
                    ${orderDetails.totalAmount ? `
                    <tfoot>
                      <tr style="background:#F9EDE9;">
                        <td colspan="3" style="padding:12px;text-align:right;color:#5A1E12;font-size:15px;font-weight:700;">Total Paid:</td>
                        <td style="padding:12px;text-align:right;color:#5A1E12;font-size:18px;font-weight:800;">$${parseFloat(orderDetails.totalAmount).toFixed(2)}</td>
                      </tr>
                    </tfoot>` : ''}
                  </table>
                </td>
              </tr>` : ''}

              <!-- CTA -->
              <tr>
                <td style="padding:10px 40px 36px;text-align:center;">
                  <table width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td style="padding-right:8px;text-align:right;">
                      <a href="${trackingUrl}" style="display:inline-block;background-color:#5A1E12;color:#ffffff;padding:13px 28px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">&#128230; Track Order</a>
                    </td>
                    <td style="padding-left:8px;text-align:left;">
                      <a href="${invoiceUrl}" style="display:inline-block;background-color:#C4603A;color:#ffffff;padding:13px 28px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">&#128196; Download Invoice</a>
                    </td>
                  </tr></table>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background-color:#3D1009;padding:22px 40px;text-align:center;">
                  <p style="margin:0 0 4px;color:#F0D0C8;font-size:13px;">Thank you for shopping with us! &#127775;</p>
                  <p style="margin:0;color:#8B5C54;font-size:11px;">This is an automated email &#8212; please do not reply. &copy; 2026 MIA Marketplace.</p>
                </td>
              </tr>

            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  };

  try {
    // Attach invoice PDF if provided
    if (orderDetails.invoicePDFBuffer) {
      msg.attachments = [{
        content: orderDetails.invoicePDFBuffer.toString('base64'),
        filename: `invoice-${orderDetails.orderId}.pdf`,
        type: 'application/pdf',
        disposition: 'attachment'
      }];
    }
    await sgMail.send(msg);
    return { success: true };
  } catch (error) {
    console.error("âŒ Email error:", error.response?.body || error.message);
    return { success: false, error: error.message };
  }
};

// Send Seller Order Notification Email
const sendSellerOrderNotificationEmail = async (email, sellerName, orderDetails) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("ðŸ“§ DEVELOPMENT MODE - Seller Notification");
    console.log("=".repeat(50));
    console.log(`To: ${email}`);
    console.log(`Seller: ${sellerName}`);
    console.log(`Order: ${orderDetails.orderId}`);
    console.log("=".repeat(50) + "\n");
    return { success: true };
  }

  const productRows = orderDetails.products ? orderDetails.products.map(product => `
    <tr style="border-bottom: 1px solid #ddd;">
      <td style="padding: 12px 8px;">${product.title || 'Product'}</td>
      <td style="padding: 12px 8px; text-align: center;">${product.quantity}</td>
      <td style="padding: 12px 8px; text-align: right;">$${(product.price || 0).toFixed(2)}</td>
    </tr>
  `).join('') : '';

  const msg = {
    to: email,
    from: {
      email: senderEmail,
      name: senderName
    },
    subject: `New Order Received: #${orderDetails.orderId} — MIA Marketplace`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
      <body style="margin:0;padding:0;background-color:#FDF5F3;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FDF5F3;padding:30px 0;">
          <tr><td align="center">
            <table width="650" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(90,30,18,0.12);">
              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#5A1E12 0%,#7D2E1E 100%);padding:36px 40px;text-align:center;">
                  <p style="margin:0 0 8px;font-size:12px;color:#F9EDE9;letter-spacing:3px;text-transform:uppercase;">Seller Dashboard</p>
                  <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">&#127881; New Order Received!</h1>
                  <p style="margin:10px 0 0;color:#F0D0C8;font-size:14px;">You have a new order to process</p>
                </td>
              </tr>
              <!-- Alert banner -->
              <tr>
                <td style="background-color:#C4603A;padding:12px 40px;text-align:center;">
                  <p style="margin:0;color:#ffffff;font-size:14px;font-weight:600;">&#9888;&#65039; Action required â€” please process this order promptly</p>
                </td>
              </tr>
              <!-- Seller greeting -->
              <tr>
                <td style="padding:28px 40px 16px;">
                  <p style="color:#3D1009;font-size:17px;margin:0 0 6px;">Hi <strong>${sellerName}</strong>,</p>
                  <p style="color:#555;font-size:15px;line-height:1.7;margin:0;">Great news! A customer has placed an order for your product(s). Check the details below and update the status in your seller dashboard.</p>
                </td>
              </tr>
              <!-- Order summary -->
              <tr>
                <td style="padding:0 40px 20px;">
                  <div style="background:#F9EDE9;border-radius:8px;padding:20px;border-top:3px solid #5A1E12;">
                    <p style="margin:0 0 14px;color:#5A1E12;font-size:14px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Order Summary</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Order ID</strong></td>
                        <td style="padding:6px 0;color:#3D1009;font-size:14px;text-align:right;">#${orderDetails.orderId}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Order Date</strong></td>
                        <td style="padding:6px 0;color:#3D1009;font-size:14px;text-align:right;">${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Your Earnings</strong></td>
                        <td style="padding:6px 0;color:#5A1E12;font-size:18px;font-weight:800;text-align:right;">$${orderDetails.totalAmount.toFixed(2)}</td>
                      </tr>
                    </table>
                  </div>
                </td>
              </tr>
              <!-- Products -->
              ${productRows ? `
              <tr>
                <td style="padding:0 40px 20px;">
                  <p style="color:#5A1E12;font-size:15px;font-weight:700;margin:0 0 10px;">Products Ordered</p>
                  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;">
                    <thead><tr style="background-color:#5A1E12;"><th style="padding:11px 12px;text-align:left;color:#fff;font-size:13px;">Product</th><th style="padding:11px 12px;text-align:center;color:#fff;font-size:13px;">Qty</th><th style="padding:11px 12px;text-align:right;color:#fff;font-size:13px;">Price</th></tr></thead>
                    <tbody>${productRows}</tbody>
                  </table>
                </td>
              </tr>` : ''}
              <!-- Action required -->
              <tr>
                <td style="padding:0 40px 20px;">
                  <div style="background:#F9EDE9;border-left:4px solid #C4603A;border-radius:0 8px 8px 0;padding:16px 20px;">
                    <p style="margin:0 0 8px;color:#5A1E12;font-weight:700;font-size:14px;">Checklist</p>
                    <p style="margin:4px 0;color:#7D2E1E;font-size:13px;">&#10003; Log into your seller dashboard</p>
                    <p style="margin:4px 0;color:#7D2E1E;font-size:13px;">&#10003; Confirm the order and verify stock</p>
                    <p style="margin:4px 0;color:#7D2E1E;font-size:13px;">&#10003; Pack and ship within 2â€“3 business days</p>
                    <p style="margin:4px 0;color:#7D2E1E;font-size:13px;">&#10003; Add tracking information once dispatched</p>
                  </div>
                </td>
              </tr>
              <!-- CTA -->
              <tr>
                <td style="padding:0 40px 36px;text-align:center;">
                  <table width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td style="padding-right:8px;text-align:right;">
                      <a href="${process.env.FRONTEND_URL || 'https://apla-fe.vercel.app'}/seller/orders/${orderDetails.orderId}" style="display:inline-block;background-color:#5A1E12;color:#ffffff;padding:13px 28px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">&#128717; View in Dashboard</a>
                    </td>
                    <td style="padding-left:8px;text-align:left;">
                      <a href="${process.env.FRONTEND_URL || 'https://apla-fe.vercel.app'}/seller/orders/${orderDetails.orderId}" style="display:inline-block;background-color:#C4603A;color:#ffffff;padding:13px 28px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">&#128196; Download Invoice</a>
                    </td>
                  </tr></table>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color:#3D1009;padding:22px 40px;text-align:center;">
                  <p style="margin:0 0 4px;color:#F0D0C8;font-size:13px;">Thank you for being a valued MIA Marketplace seller! &#128188;</p>
                  <p style="margin:0;color:#8B5C54;font-size:11px;">This is an automated email â€” please do not reply. &copy; 2026 MIA Marketplace.</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  };

  try {
    await sgMail.send(msg);
    return { success: true };
  } catch (error) {
    console.error("âŒ Email error:", error.response?.body || error.message);
    return { success: false, error: error.message };
  }
};

// Send Contact Form Email
const sendContactFormEmail = async (email, name, subject, message) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("ðŸ“§ DEVELOPMENT MODE - Contact Form");
    console.log("=".repeat(50));
    console.log(`To: ${email}`);
    console.log(`Subject: ${subject}`);
    console.log("=".repeat(50) + "\n");
    return { success: true };
  }

  const msg = {
    to: email,
    from: {
      email: senderEmail,
      name: senderName
    },
    subject: `Contact Form Received - ${subject}`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
      <body style="margin:0;padding:0;background-color:#FDF5F3;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FDF5F3;padding:30px 0;">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(90,30,18,0.12);">
              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#5A1E12 0%,#7D2E1E 100%);padding:36px 40px;text-align:center;">
                  <p style="margin:0 0 8px;font-size:12px;color:#F9EDE9;letter-spacing:3px;text-transform:uppercase;">MIA Marketplace</p>
                  <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">&#128140; Message Received</h1>
                  <p style="margin:10px 0 0;color:#F0D0C8;font-size:14px;">We'll be in touch soon!</p>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:36px 40px 28px;">
                  <p style="color:#3D1009;font-size:17px;margin:0 0 10px;">Hi <strong>${name}</strong>,</p>
                  <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 28px;">Thank you for reaching out! We've received your message and our support team will review it shortly.</p>

                  <div style="background:#F9EDE9;border-radius:8px;padding:22px;border-top:3px solid #5A1E12;margin-bottom:22px;">
                    <p style="margin:0 0 14px;color:#5A1E12;font-size:14px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Your Message</p>
                    <p style="margin:0 0 8px;color:#7D2E1E;font-size:14px;"><strong>Subject:</strong> <span style="color:#3D1009;">${subject}</span></p>
                    <p style="margin:0 0 6px;color:#7D2E1E;font-size:14px;"><strong>Message:</strong></p>
                    <p style="margin:0;color:#555;font-size:14px;line-height:1.7;">${message}</p>
                  </div>

                  <div style="background:#F9EDE9;border-left:4px solid #C4603A;border-radius:0 8px 8px 0;padding:16px 20px;">
                    <p style="margin:0 0 6px;color:#5A1E12;font-weight:700;font-size:14px;">&#128338; Response Time</p>
                    <p style="margin:0;color:#7D2E1E;font-size:13px;line-height:1.6;">Our support team typically responds within 24â€“48 business hours. You'll receive a reply at this email address.</p>
                  </div>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color:#3D1009;padding:22px 40px;text-align:center;">
                  <p style="margin:0 0 4px;color:#F0D0C8;font-size:13px;">MIA Marketplace â€” Customer Support</p>
                  <p style="margin:0;color:#8B5C54;font-size:11px;">This is an automated confirmation â€” please do not reply. &copy; 2026 MIA Marketplace.</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  };

  try {
    await sgMail.send(msg);
    return { success: true };
  } catch (error) {
    console.error("âŒ Email error:", error.response?.body || error.message);
    return { success: false, error: error.message };
  }
};

// Send SLA Warning Email
const sendSLAWarningEmail = async (sellerId, orderId, notificationType, slaStatus) => {
  try {
    const prisma = require('../config/prisma');
    
    const seller = await prisma.user.findUnique({
      where: { id: sellerId },
      select: { email: true, name: true }
    });

    if (!seller?.email) {
      return { success: false, error: "Seller email not found" };
    }

    if (isDevelopmentMode) {
      console.log("\nâš ï¸  SLA WARNING:", seller.email, orderId, notificationType);
      return { success: true };
    }

    const urgencyColor = slaStatus.status === 'BREACHED' ? '#e74c3c' : '#f39c12';

    const msg = {
      to: seller.email,
      from: {
        email: senderEmail,
        name: senderName
      },
      subject: `Action Required: ${notificationType} — Order #${orderId?.slice(-8)} — MIA Marketplace`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
        <body style="margin:0;padding:0;background-color:#FDF5F3;font-family:Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FDF5F3;padding:30px 0;">
            <tr><td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(90,30,18,0.15);">
                <!-- Brand Header -->
                <tr>
                  <td style="background:linear-gradient(135deg,#5A1E12 0%,#7D2E1E 100%);padding:20px 40px;text-align:center;">
                    <p style="margin:0;font-size:12px;color:#F9EDE9;letter-spacing:3px;text-transform:uppercase;">MIA Marketplace</p>
                  </td>
                </tr>
                <!-- Urgency Banner -->
                <tr>
                  <td style="background-color:${urgencyColor};padding:28px 40px;text-align:center;">
                    <h1 style="margin:0 0 6px;color:#ffffff;font-size:26px;font-weight:800;">&#9888;&#65039; SLA ${slaStatus.status === 'BREACHED' ? 'BREACHED' : 'WARNING'}</h1>
                    <p style="margin:0;color:rgba(255,255,255,0.9);font-size:14px;">Immediate action required</p>
                  </td>
                </tr>
                <!-- Body -->
                <tr>
                  <td style="padding:32px 40px;">
                    <p style="color:#3D1009;font-size:16px;margin:0 0 24px;">
                      ${slaStatus.status === 'BREACHED' ? 'This order is <strong>OVERDUE</strong> and requires immediate attention.' : 'This order is approaching its SLA deadline and needs your attention soon.'}
                    </p>

                    <!-- Order Details -->
                    <div style="background:#F9EDE9;border-radius:8px;padding:20px;border-top:3px solid #5A1E12;margin-bottom:20px;">
                      <p style="margin:0 0 14px;color:#5A1E12;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Order Details</p>
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Order ID</strong></td>
                          <td style="padding:6px 0;color:#3D1009;font-size:14px;text-align:right;font-family:monospace;">#${orderId?.slice(-8) || 'N/A'}</td>
                        </tr>
                        <tr>
                          <td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Action Required</strong></td>
                          <td style="padding:6px 0;color:#3D1009;font-size:14px;text-align:right;">${notificationType.replace(/_/g, ' ')}</td>
                        </tr>
                        <tr>
                          <td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>SLA Status</strong></td>
                          <td style="padding:6px 0;text-align:right;"><span style="background-color:${urgencyColor};color:#fff;padding:3px 12px;border-radius:20px;font-size:13px;font-weight:600;">${slaStatus.status}</span></td>
                        </tr>
                        <tr>
                          <td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Time</strong></td>
                          <td style="padding:6px 0;color:${urgencyColor};font-size:14px;font-weight:700;text-align:right;">${slaStatus.isOverdue ? `OVERDUE by ${Math.abs(slaStatus.timeRemaining).toFixed(1)} hrs` : `${slaStatus.timeRemaining.toFixed(1)} hrs remaining`}</td>
                        </tr>
                      </table>
                    </div>

                    <!-- Steps -->
                    <div style="background:#F9EDE9;border-left:4px solid #C4603A;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:28px;">
                      <p style="margin:0 0 8px;color:#5A1E12;font-weight:700;font-size:14px;">Next Steps</p>
                      <p style="margin:4px 0;color:#7D2E1E;font-size:13px;">&#10003; Log into your seller dashboard immediately</p>
                      <p style="margin:4px 0;color:#7D2E1E;font-size:13px;">&#10003; Update the order status</p>
                      <p style="margin:4px 0;color:#7D2E1E;font-size:13px;">&#10003; Add tracking information if shipping</p>
                      <p style="margin:4px 0;color:#7D2E1E;font-size:13px;">&#10003; Contact the customer if required</p>
                    </div>

                    <!-- CTA -->
                    <div style="text-align:center;">
                      <a href="${process.env.FRONTEND_URL}/seller/orders/${orderId}" style="display:inline-block;background-color:${urgencyColor};color:#ffffff;padding:14px 40px;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;">&#128640; Take Action Now</a>
                    </div>
                  </td>
                </tr>
                <!-- Footer -->
                <tr>
                  <td style="background-color:#3D1009;padding:20px 40px;text-align:center;">
                    <p style="margin:0 0 4px;color:#F0D0C8;font-size:13px;">MIA Marketplace â€” Automated SLA Monitor</p>
                    <p style="margin:0;color:#8B5C54;font-size:11px;">Please do not reply to this email. &copy; 2026 MIA Marketplace.</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body>
        </html>
      `,
    };

    await sgMail.send(msg);
    return { success: true };
  } catch (error) {
    console.error("âŒ SLA email error:", error);
    return { success: false, error: error.message };
  }
};

// Send Seller Application Submitted Email
const sendSellerApplicationSubmittedEmail = async (email, name, applicationId) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("ðŸ“§ DEVELOPMENT MODE - Seller Application Submitted");
    console.log("=".repeat(50));
    console.log(`To: ${email}`);
    console.log(`Name: ${name}`);
    console.log(`Application ID: ${applicationId}`);
    console.log("=".repeat(50) + "\n");
    return { success: true };
  }

  const msg = {
    to: email,
    from: { email: senderEmail, name: senderName },
        subject: "Your Seller Application Has Been Submitted — MIA Marketplace",
    html: `
      <!DOCTYPE html>
      <html>
      <body style="margin:0;padding:0;background-color:#FDF5F3;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FDF5F3;padding:30px 0;">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(90,30,18,0.12);">
              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#5A1E12 0%,#7D2E1E 100%);padding:36px 40px;text-align:center;">
                  <p style="margin:0 0 8px;font-size:12px;color:#F9EDE9;letter-spacing:3px;text-transform:uppercase;">MIA Marketplace</p>
                  <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">&#128203; Application Submitted!</h1>
                  <p style="margin:10px 0 0;color:#F0D0C8;font-size:14px;">We've received your seller application</p>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:36px 40px 28px;">
                  <p style="color:#3D1009;font-size:17px;margin:0 0 10px;">Hi <strong>${name}</strong>,</p>
                  <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 28px;">Thank you for completing your seller application on MIA Marketplace! Your application has been received and is now under review by our team.</p>

                  <!-- Status box -->
                  <div style="background:#F9EDE9;border-radius:8px;padding:22px;border-top:3px solid #5A1E12;margin-bottom:24px;">
                    <p style="margin:0 0 14px;color:#5A1E12;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">What Happens Next?</p>
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;">
                          <span style="display:inline-block;background:#5A1E12;color:#fff;border-radius:50%;width:24px;height:24px;text-align:center;line-height:24px;font-size:12px;font-weight:700;margin-right:12px;">1</span>
                        </td>
                        <td style="padding:8px 0;color:#555;font-size:14px;line-height:1.6;">Our admin team will review your submitted details and KYC documents.</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;">
                          <span style="display:inline-block;background:#5A1E12;color:#fff;border-radius:50%;width:24px;height:24px;text-align:center;line-height:24px;font-size:12px;font-weight:700;margin-right:12px;">2</span>
                        </td>
                        <td style="padding:8px 0;color:#555;font-size:14px;line-height:1.6;">You will receive an email once your application has been approved or if any additional information is needed.</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;">
                          <span style="display:inline-block;background:#5A1E12;color:#fff;border-radius:50%;width:24px;height:24px;text-align:center;line-height:24px;font-size:12px;font-weight:700;margin-right:12px;">3</span>
                        </td>
                        <td style="padding:8px 0;color:#555;font-size:14px;line-height:1.6;">Once approved, you can start listing your Aboriginal artworks and selling to customers across Australia.</td>
                      </tr>
                    </table>
                  </div>

                  <!-- Application Reference Number -->
                  ${applicationId ? `
                  <div style="background:#F9EDE9;border-radius:8px;padding:18px 22px;border-top:3px solid #C4603A;margin-bottom:24px;text-align:center;">
                    <p style="margin:0 0 6px;color:#5A1E12;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Your Application Reference Number</p>
                    <p style="margin:0;font-size:22px;font-weight:800;color:#5A1E12;font-family:monospace;letter-spacing:2px;">${applicationId}</p>
                    <p style="margin:8px 0 0;color:#7D2E1E;font-size:12px;">Please quote this number when contacting our support team about your application.</p>
                  </div>` : ''}

                  <!-- Review time note -->
                  <div style="background:#F9EDE9;border-left:4px solid #C4603A;border-radius:0 8px 8px 0;padding:16px 20px;">
                    <p style="margin:0 0 6px;color:#5A1E12;font-weight:700;font-size:14px;">&#9200; Review Timeline</p>
                    <p style="margin:0;color:#7D2E1E;font-size:13px;line-height:1.6;">Applications are typically reviewed within <strong>2â€“3 business days</strong>. If you have any questions in the meantime, please contact our support team.</p>
                  </div>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color:#3D1009;padding:22px 40px;text-align:center;">
                  <p style="margin:0 0 4px;color:#F0D0C8;font-size:13px;">Thank you for joining MIA Marketplace! &#127775;</p>
                  <p style="margin:0;color:#8B5C54;font-size:11px;">This is an automated email â€” please do not reply. &copy; 2026 MIA Marketplace.</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`âœ… Application submitted email sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error("âŒ Email error:", error.response?.body || error.message);
    return { success: false, error: error.message };
  }
};

// Send Seller Registration / Account Created Email (sent right after OTP is verified)
const sendSellerRegistrationEmail = async (email, name, applicationNumber) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("📧 DEVELOPMENT MODE - Seller Registration Confirmation");
    console.log("=".repeat(50));
    console.log(`To: ${email}`);
    console.log(`Name: ${name}`);
    console.log(`Application Number: ${applicationNumber}`);
    console.log("=".repeat(50) + "\n");
    return { success: true };
  }

  const msg = {
    to: email,
    from: { email: senderEmail, name: senderName },
    subject: "Your Seller Account Has Been Created — MIA Marketplace",
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
      <body style="margin:0;padding:0;background-color:#FDF5F3;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FDF5F3;padding:30px 0;">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(90,30,18,0.12);">
              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#5A1E12 0%,#7D2E1E 100%);padding:36px 40px;text-align:center;">
                  <p style="margin:0 0 8px;font-size:12px;color:#F9EDE9;letter-spacing:3px;text-transform:uppercase;">MIA Marketplace</p>
                  <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">&#127881; Account Created!</h1>
                  <p style="margin:10px 0 0;color:#F0D0C8;font-size:14px;">Your seller account is ready &mdash; let's get started</p>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:36px 40px 28px;">
                  <p style="color:#3D1009;font-size:17px;margin:0 0 10px;">Hi <strong>${name}</strong>,</p>
                  <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 28px;">Welcome to MIA Marketplace! Your email has been verified and your seller account has been successfully created. Please keep your application number safe &mdash; you'll need it when contacting our support team.</p>

                  <!-- Application Number Box -->
                  <div style="background:#F9EDE9;border-radius:8px;padding:22px;border-top:3px solid #5A1E12;margin-bottom:24px;text-align:center;">
                    <p style="margin:0 0 6px;color:#5A1E12;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Your Application Number</p>
                    <p style="margin:0;font-size:22px;font-weight:800;color:#5A1E12;font-family:monospace;letter-spacing:2px;">${applicationNumber}</p>
                    <p style="margin:8px 0 0;color:#7D2E1E;font-size:12px;">Please save this number. Quote it when contacting support about your application.</p>
                  </div>

                  <!-- Next steps -->
                  <div style="background:#F9EDE9;border-radius:8px;padding:22px;border-top:3px solid #C4603A;margin-bottom:24px;">
                    <p style="margin:0 0 14px;color:#5A1E12;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Complete Your Application</p>
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;">
                          <span style="display:inline-block;background:#5A1E12;color:#fff;border-radius:50%;width:24px;height:24px;text-align:center;line-height:24px;font-size:12px;font-weight:700;margin-right:12px;">1</span>
                        </td>
                        <td style="padding:8px 0;color:#555;font-size:14px;line-height:1.6;">Fill in your <strong>Business Details</strong> (ABN, address, business type).</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;">
                          <span style="display:inline-block;background:#5A1E12;color:#fff;border-radius:50%;width:24px;height:24px;text-align:center;line-height:24px;font-size:12px;font-weight:700;margin-right:12px;">2</span>
                        </td>
                        <td style="padding:8px 0;color:#555;font-size:14px;line-height:1.6;">Set up your <strong>Store Profile</strong> with a store name, description and logo.</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;">
                          <span style="display:inline-block;background:#5A1E12;color:#fff;border-radius:50%;width:24px;height:24px;text-align:center;line-height:24px;font-size:12px;font-weight:700;margin-right:12px;">3</span>
                        </td>
                        <td style="padding:8px 0;color:#555;font-size:14px;line-height:1.6;">Upload your <strong>KYC documents</strong> and submit for review.</td>
                      </tr>
                    </table>
                  </div>

                  <div style="background:#F9EDE9;border-left:4px solid #C4603A;border-radius:0 8px 8px 0;padding:16px 20px;">
                    <p style="margin:0 0 6px;color:#5A1E12;font-weight:700;font-size:14px;">&#128161; Tip</p>
                    <p style="margin:0;color:#7D2E1E;font-size:13px;line-height:1.6;">Applications are typically reviewed within <strong>2–3 business days</strong> after submission. Make sure all your details are complete before submitting.</p>
                  </div>
                </td>
              </tr>
              <!-- CTA -->
              <tr>
                <td style="padding:0 40px 36px;text-align:center;">
                  <a href="${process.env.SELLER_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://apla-fe.vercel.app'}/seller/onboarding" style="display:inline-block;background-color:#5A1E12;color:#ffffff;padding:14px 40px;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;">Continue Your Application</a>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color:#3D1009;padding:22px 40px;text-align:center;">
                  <p style="margin:0 0 4px;color:#F0D0C8;font-size:13px;">Thank you for joining MIA Marketplace! &#127775;</p>
                  <p style="margin:0;color:#8B5C54;font-size:11px;">This is an automated email — please do not reply. &copy; 2026 MIA Marketplace.</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`✅ Registration confirmation email sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error("❌ Email error:", error.response?.body || error.message);
    return { success: false, error: error.message };
  }
};

// Send Seller Approved Email
const sendSellerApprovedEmail = async (email, name) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("ðŸ“§ DEVELOPMENT MODE - Seller Approved");
    console.log("=".repeat(50));
    console.log(`To: ${email}`);
    console.log(`Name: ${name}`);
    console.log(`Application ID: ${applicationId}`);
    console.log("=".repeat(50) + "\n");
    return { success: true };
  }

  const msg = {
    to: email,
    from: { email: senderEmail, name: senderName },
    subject: "Your Seller Account Has Been Approved — MIA Marketplace",
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
      <body style="margin:0;padding:0;background-color:#FDF5F3;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FDF5F3;padding:30px 0;">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(90,30,18,0.12);">
              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#5A1E12 0%,#7D2E1E 100%);padding:36px 40px;text-align:center;">
                  <p style="margin:0 0 8px;font-size:12px;color:#F9EDE9;letter-spacing:3px;text-transform:uppercase;">MIA Marketplace</p>
                  <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">&#127881; You're Approved!</h1>
                  <p style="margin:10px 0 0;color:#F0D0C8;font-size:14px;">Welcome to the MIA Marketplace seller community</p>
                </td>
              </tr>
              <!-- Approved banner -->
              <tr>
                <td style="background-color:#4CAF50;padding:14px 40px;text-align:center;">
                  <p style="margin:0;color:#ffffff;font-size:15px;font-weight:600;">&#10003; Seller Account Approved &amp; Active</p>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:36px 40px 28px;">
                  <p style="color:#3D1009;font-size:17px;margin:0 0 10px;">Hi <strong>${name}</strong>,</p>
                  <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 28px;">We're thrilled to let you know that your seller application has been <strong style="color:#5A1E12;">approved</strong>! You can now log in to your seller dashboard, upload your artworks, and start selling to customers across Australia.</p>

                  <!-- What you can do -->
                  <div style="background:#F9EDE9;border-radius:8px;padding:22px;border-top:3px solid #5A1E12;margin-bottom:24px;">
                    <p style="margin:0 0 16px;color:#5A1E12;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Get Started</p>
                    <table cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td style="padding:8px 0;">
                          <span style="color:#C4603A;font-size:16px;margin-right:10px;">&#127912;</span>
                          <span style="color:#555;font-size:14px;">Upload your first artwork listing from the seller dashboard</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;">
                          <span style="color:#C4603A;font-size:16px;margin-right:10px;">&#128247;</span>
                          <span style="color:#555;font-size:14px;">Add high-quality photos and detailed descriptions for best results</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;">
                          <span style="color:#C4603A;font-size:16px;margin-right:10px;">&#128176;</span>
                          <span style="color:#555;font-size:14px;">Ensure your bank details are saved to receive payments promptly</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;">
                          <span style="color:#C4603A;font-size:16px;margin-right:10px;">&#128179;</span>
                          <span style="color:#555;font-size:14px;">Once you have products uploaded, contact us to go fully live</span>
                        </td>
                      </tr>
                    </table>
                  </div>

                  <!-- Important note -->
                  <div style="background:#F9EDE9;border-left:4px solid #C4603A;border-radius:0 8px 8px 0;padding:16px 20px;">
                    <p style="margin:0 0 6px;color:#5A1E12;font-weight:700;font-size:14px;">&#128161; Important</p>
                    <p style="margin:0;color:#7D2E1E;font-size:13px;line-height:1.6;">Your products will be reviewed by our team before going live to customers. Upload your artworks and our admin will activate your store once everything is in order.</p>
                  </div>
                </td>
              </tr>
              <!-- CTA -->
              <tr>
                <td style="padding:0 40px 36px;text-align:center;">
                  <a href="${process.env.SELLER_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://apla-fe.vercel.app'}/seller/dashboard" style="display:inline-block;background-color:#5A1E12;color:#ffffff;padding:14px 40px;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;">Go to Seller Dashboard</a>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color:#3D1009;padding:22px 40px;text-align:center;">
                  <p style="margin:0 0 4px;color:#F0D0C8;font-size:13px;">Welcome to the MIA Marketplace family! &#127775;</p>
                  <p style="margin:0;color:#8B5C54;font-size:11px;">This is an automated email â€” please do not reply. &copy; 2026 MIA Marketplace.</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`âœ… Seller approved email sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error("âŒ Email error:", error.response?.body || error.message);
    return { success: false, error: error.message };
  }
};

// Send Seller Low Stock Alert Email
const sendSellerLowStockEmail = async (email, sellerName, productTitle, currentStock, productId) => {
  console.log(`\n📧 [Low Stock Email] Preparing to send to: ${email} | Product: "${productTitle}" | Stock: ${currentStock} | isDevelopmentMode: ${isDevelopmentMode}`);

  if (!email) {
    console.warn('⚠️  [Low Stock Email] No email address provided — skipping send.');
    return { success: false, error: 'No email address' };
  }

  if (isDevelopmentMode) {
    console.log("=".repeat(50));
    console.log("📧 [Low Stock Email] DEVELOPMENT MODE — Email not sent (SENDGRID_API_KEY missing).");
    console.log(`   To: ${email} | Seller: ${sellerName} | Product: ${productTitle} | Stock: ${currentStock}`);
    console.log("=".repeat(50) + "\n");
    return { success: false, error: 'Development mode — SendGrid not configured' };
  }

  const stockColor = currentStock === 0 ? "#D32F2F" : "#E65100";
  const stockLabel = currentStock === 0 ? "OUT OF STOCK" : `ONLY ${currentStock} LEFT`;
  const urgencyText = currentStock === 0
    ? "Your product has sold out and has been automatically hidden from the marketplace."
    : `Your product is critically low on stock (${currentStock} remaining) and has been automatically hidden from the marketplace to avoid overselling.`;

  const msg = {
    to: email,
    from: { email: senderEmail, name: senderName },
        subject: `Low Stock Alert: "${productTitle}" — MIA Marketplace`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
      <body style="margin:0;padding:0;background-color:#FDF5F3;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FDF5F3;padding:30px 0;">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(90,30,18,0.12);">
              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#5A1E12 0%,#7D2E1E 100%);padding:36px 40px;text-align:center;">
                  <p style="margin:0 0 8px;font-size:12px;color:#F9EDE9;letter-spacing:3px;text-transform:uppercase;">MIA Marketplace</p>
                  <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">⚠️ Stock Alert</h1>
                  <p style="margin:10px 0 0;color:#F0D0C8;font-size:14px;">Action required for one of your products</p>
                </td>
              </tr>
              <!-- Alert banner -->
              <tr>
                <td style="background-color:${stockColor};padding:14px 40px;text-align:center;">
                  <p style="margin:0;color:#ffffff;font-size:15px;font-weight:700;letter-spacing:1px;">${stockLabel}</p>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:36px 40px 28px;">
                  <p style="color:#3D1009;font-size:17px;margin:0 0 10px;">Hi <strong>${sellerName}</strong>,</p>
                  <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 28px;">${urgencyText}</p>

                  <!-- Product Box -->
                  <div style="background:#FFF3E0;border-radius:8px;padding:22px;border-top:3px solid ${stockColor};margin-bottom:24px;">
                    <p style="margin:0 0 14px;color:#5A1E12;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Product Details</p>
                    <table cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td style="padding:6px 0;color:#777;font-size:13px;width:140px;">Product Name</td>
                        <td style="padding:6px 0;color:#3D1009;font-size:14px;font-weight:700;">${productTitle}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#777;font-size:13px;">Current Stock</td>
                        <td style="padding:6px 0;font-size:14px;font-weight:700;color:${stockColor};">${currentStock} unit${currentStock === 1 ? '' : 's'}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#777;font-size:13px;">Status</td>
                        <td style="padding:6px 0;font-size:14px;font-weight:700;color:#D32F2F;">Inactive (hidden from marketplace)</td>
                      </tr>
                    </table>
                  </div>

                  <!-- What to do -->
                  <div style="background:#F9EDE9;border-radius:8px;padding:22px;border-top:3px solid #5A1E12;margin-bottom:24px;">
                    <p style="margin:0 0 14px;color:#5A1E12;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">What to do next</p>
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;">
                          <span style="display:inline-block;background:#5A1E12;color:#fff;border-radius:50%;width:24px;height:24px;text-align:center;line-height:24px;font-size:12px;font-weight:700;margin-right:12px;">1</span>
                        </td>
                        <td style="padding:8px 0;color:#555;font-size:14px;line-height:1.6;">Log in to your seller dashboard and go to <strong>My Products</strong>.</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;">
                          <span style="display:inline-block;background:#5A1E12;color:#fff;border-radius:50%;width:24px;height:24px;text-align:center;line-height:24px;font-size:12px;font-weight:700;margin-right:12px;">2</span>
                        </td>
                        <td style="padding:8px 0;color:#555;font-size:14px;line-height:1.6;">Edit the product <strong>"${productTitle}"</strong> and update the stock quantity.</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;vertical-align:top;">
                          <span style="display:inline-block;background:#5A1E12;color:#fff;border-radius:50%;width:24px;height:24px;text-align:center;line-height:24px;font-size:12px;font-weight:700;margin-right:12px;">3</span>
                        </td>
                        <td style="padding:8px 0;color:#555;font-size:14px;line-height:1.6;">Your product will be submitted for <strong>admin review</strong> and re-listed once approved.</td>
                      </tr>
                    </table>
                  </div>

                  <div style="background:#F9EDE9;border-left:4px solid #C4603A;border-radius:0 8px 8px 0;padding:16px 20px;">
                    <p style="margin:0 0 6px;color:#5A1E12;font-weight:700;font-size:14px;">💡 Tip</p>
                    <p style="margin:0;color:#7D2E1E;font-size:13px;line-height:1.6;">We recommend keeping a stock level of <strong>10 or more units</strong> to avoid interruptions to your sales.</p>
                  </div>
                </td>
              </tr>
              <!-- CTA -->
              <tr>
                <td style="padding:0 40px 36px;text-align:center;">
                  <a href="${process.env.SELLER_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://apla-fe.vercel.app'}/seller/products" style="display:inline-block;background-color:#5A1E12;color:#ffffff;padding:14px 40px;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;">Update Stock Now</a>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color:#3D1009;padding:22px 40px;text-align:center;">
                  <p style="margin:0 0 4px;color:#F0D0C8;font-size:13px;">MIA Marketplace &mdash; Supporting Aboriginal Artists &#127775;</p>
                  <p style="margin:0;color:#8B5C54;font-size:11px;">This is an automated email — please do not reply. &copy; 2026 MIA Marketplace.</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`✅ Low stock alert email sent to ${email} for product: ${productTitle}`);
    return { success: true };
  } catch (error) {
    console.error("❌ Low stock email error:", error.response?.body || error.message);
    return { success: false, error: error.message };
  }
};

// Send Admin Product Pending Review Email
const sendAdminProductPendingEmail = async (adminEmail, adminName, { productTitle, sellerName, productId } = {}) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("📧 DEVELOPMENT MODE - Admin Product Pending");
    console.log("=".repeat(50));
    console.log(`To: ${adminEmail} | Admin: ${adminName} | Product: ${productTitle} | Seller: ${sellerName}`);
    console.log("=".repeat(50) + "\n");
    return { success: true };
  }

  const dashboardUrl = `${process.env.ADMIN_URL || process.env.FRONTEND_URL || 'https://apla-fe.vercel.app'}/admin/products/${productId || ''}`;

  const msg = {
    to: adminEmail,
    from: { email: senderEmail, name: senderName },
        subject: `Product Pending Review: "${productTitle}" — MIA Marketplace`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
      <body style="margin:0;padding:0;background-color:#FDF5F3;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FDF5F3;padding:30px 0;">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(90,30,18,0.12);">
              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#5A1E12 0%,#7D2E1E 100%);padding:36px 40px;text-align:center;">
                  <p style="margin:0 0 8px;font-size:12px;color:#F9EDE9;letter-spacing:3px;text-transform:uppercase;">MIA Marketplace — Admin</p>
                  <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">&#128276; Product Pending Review</h1>
                  <p style="margin:10px 0 0;color:#F0D0C8;font-size:14px;">A seller has updated a product that requires your approval</p>
                </td>
              </tr>
              <!-- Status banner -->
              <tr>
                <td style="background-color:#E65100;padding:14px 40px;text-align:center;">
                  <p style="margin:0;color:#ffffff;font-size:15px;font-weight:600;">&#9201; Awaiting Admin Approval</p>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:36px 40px 28px;">
                  <p style="color:#3D1009;font-size:17px;margin:0 0 10px;">Hi <strong>${adminName || 'Admin'}</strong>,</p>
                  <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 28px;">A seller has submitted an updated product that is now <strong style="color:#5A1E12;">pending your review</strong>. Please log in to the admin dashboard to approve or reject the listing.</p>

                  <!-- Product details box -->
                  <div style="background:#F9EDE9;border-radius:8px;padding:22px;border-top:3px solid #5A1E12;margin-bottom:24px;">
                    <p style="margin:0 0 16px;color:#5A1E12;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Product Details</p>
                    <table cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #ECD5CF;">
                          <span style="color:#7D2E1E;font-size:13px;font-weight:700;display:inline-block;width:120px;">Product Title</span>
                          <span style="color:#333;font-size:14px;">${productTitle || 'Untitled'}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;">
                          <span style="color:#7D2E1E;font-size:13px;font-weight:700;display:inline-block;width:120px;">Seller Name</span>
                          <span style="color:#333;font-size:14px;">${sellerName || 'Unknown'}</span>
                        </td>
                      </tr>
                    </table>
                  </div>

                  <!-- Action note -->
                  <div style="background:#F9EDE9;border-left:4px solid #C4603A;border-radius:0 8px 8px 0;padding:16px 20px;">
                    <p style="margin:0 0 6px;color:#5A1E12;font-weight:700;font-size:14px;">&#128161; Action Required</p>
                    <p style="margin:0;color:#7D2E1E;font-size:13px;line-height:1.6;">Visit the admin dashboard to review the product images, description, and details — then approve or reject the listing.</p>
                  </div>
                </td>
              </tr>
              <!-- CTA -->
              <tr>
                <td style="padding:0 40px 36px;text-align:center;">
                  <a href="${dashboardUrl}" style="display:inline-block;background-color:#5A1E12;color:#ffffff;padding:14px 40px;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;">Review Product</a>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color:#3D1009;padding:22px 40px;text-align:center;">
                  <p style="margin:0 0 4px;color:#F0D0C8;font-size:13px;">MIA Marketplace &mdash; Supporting Aboriginal Artists &#127775;</p>
                  <p style="margin:0;color:#8B5C54;font-size:11px;">This is an automated email &mdash; please do not reply. &copy; 2026 MIA Marketplace.</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`✅ Admin product pending email sent to ${adminEmail} for product: "${productTitle}"`);
    return { success: true };
  } catch (error) {
    console.error("❌ Admin product pending email error:", error.response?.body || error.message);
    return { success: false, error: error.message };
  }
};

// Send Seller Product Approved Email
const sendSellerProductApprovedEmail = async (sellerEmail, sellerName, { productTitle, productId } = {}) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("📧 DEVELOPMENT MODE - Seller Product Approved");
    console.log("=".repeat(50));
    console.log(`To: ${sellerEmail} | Seller: ${sellerName} | Product: ${productTitle}`);
    console.log("=".repeat(50) + "\n");
    return { success: true };
  }

  const productUrl = `${process.env.SELLER_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://apla-fe.vercel.app'}/seller/products/${productId || ''}`;

  const msg = {
    to: sellerEmail,
    from: { email: senderEmail, name: senderName },
        subject: `Product Approved: "${productTitle}" is Now Live — MIA Marketplace`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
      <body style="margin:0;padding:0;background-color:#FDF5F3;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FDF5F3;padding:30px 0;">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(90,30,18,0.12);">
              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#5A1E12 0%,#7D2E1E 100%);padding:36px 40px;text-align:center;">
                  <p style="margin:0 0 8px;font-size:12px;color:#F9EDE9;letter-spacing:3px;text-transform:uppercase;">MIA Marketplace</p>
                  <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">&#127881; Product Approved!</h1>
                  <p style="margin:10px 0 0;color:#F0D0C8;font-size:14px;">Your artwork is now live on the marketplace</p>
                </td>
              </tr>
              <!-- Approved banner -->
              <tr>
                <td style="background-color:#4CAF50;padding:14px 40px;text-align:center;">
                  <p style="margin:0;color:#ffffff;font-size:15px;font-weight:600;">&#10003; Product Approved &amp; Active</p>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:36px 40px 28px;">
                  <p style="color:#3D1009;font-size:17px;margin:0 0 10px;">Hi <strong>${sellerName || 'Seller'}</strong>,</p>
                  <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 28px;">Great news! Your product has been reviewed and <strong style="color:#4CAF50;">approved</strong> by our team. It is now visible to customers on the MIA Marketplace.</p>

                  <!-- Product box -->
                  <div style="background:#F9EDE9;border-radius:8px;padding:22px;border-top:3px solid #4CAF50;margin-bottom:24px;">
                    <p style="margin:0 0 12px;color:#5A1E12;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Approved Product</p>
                    <p style="margin:0;color:#333;font-size:16px;font-weight:600;">&#127912; ${productTitle || 'Your Product'}</p>
                  </div>

                  <!-- What's next -->
                  <div style="background:#F9EDE9;border-radius:8px;padding:22px;border-top:3px solid #5A1E12;margin-bottom:24px;">
                    <p style="margin:0 0 16px;color:#5A1E12;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">What's Next?</p>
                    <table cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td style="padding:8px 0;">
                          <span style="color:#C4603A;font-size:16px;margin-right:10px;">&#128247;</span>
                          <span style="color:#555;font-size:14px;">Customers can now browse and purchase your artwork</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;">
                          <span style="color:#C4603A;font-size:16px;margin-right:10px;">&#128276;</span>
                          <span style="color:#555;font-size:14px;">You'll be notified when an order is placed</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;">
                          <span style="color:#C4603A;font-size:16px;margin-right:10px;">&#128176;</span>
                          <span style="color:#555;font-size:14px;">Earnings will be credited after the order is fulfilled</span>
                        </td>
                      </tr>
                    </table>
                  </div>

                  <div style="background:#F9EDE9;border-left:4px solid #C4603A;border-radius:0 8px 8px 0;padding:16px 20px;">
                    <p style="margin:0;color:#7D2E1E;font-size:13px;line-height:1.6;">Keep your stock levels updated so the listing stays active. Products with zero stock are automatically hidden from the marketplace.</p>
                  </div>
                </td>
              </tr>
              <!-- CTA -->
              <tr>
                <td style="padding:0 40px 36px;text-align:center;">
                  <a href="${productUrl}" style="display:inline-block;background-color:#5A1E12;color:#ffffff;padding:14px 40px;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;">View My Product</a>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color:#3D1009;padding:22px 40px;text-align:center;">
                  <p style="margin:0 0 4px;color:#F0D0C8;font-size:13px;">MIA Marketplace &mdash; Supporting Aboriginal Artists &#127775;</p>
                  <p style="margin:0;color:#8B5C54;font-size:11px;">This is an automated email &mdash; please do not reply. &copy; 2026 MIA Marketplace.</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`✅ Seller product approved email sent to ${sellerEmail} for product: "${productTitle}"`);
    return { success: true };
  } catch (error) {
    console.error("❌ Seller product approved email error:", error.response?.body || error.message);
    return { success: false, error: error.message };
  }
};

// Send Seller Product Rejected Email
const sendSellerProductRejectedEmail = async (sellerEmail, sellerName, { productTitle, reason, productId } = {}) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("📧 DEVELOPMENT MODE - Seller Product Rejected");
    console.log("=".repeat(50));
    console.log(`To: ${sellerEmail} | Seller: ${sellerName} | Product: ${productTitle} | Reason: ${reason}`);
    console.log("=".repeat(50) + "\n");
    return { success: true };
  }

  const dashboardUrl = `${process.env.SELLER_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://apla-fe.vercel.app'}/seller/products`;

  const msg = {
    to: sellerEmail,
    from: { email: senderEmail, name: senderName },
        subject: `Product Review: "${productTitle}" Requires Changes — MIA Marketplace`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
      <body style="margin:0;padding:0;background-color:#FDF5F3;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FDF5F3;padding:30px 0;">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(90,30,18,0.12);">
              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#5A1E12 0%,#7D2E1E 100%);padding:36px 40px;text-align:center;">
                  <p style="margin:0 0 8px;font-size:12px;color:#F9EDE9;letter-spacing:3px;text-transform:uppercase;">MIA Marketplace</p>
                  <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">Product Review Update</h1>
                  <p style="margin:10px 0 0;color:#F0D0C8;font-size:14px;">Your product listing requires some changes</p>
                </td>
              </tr>
              <!-- Rejected banner -->
              <tr>
                <td style="background-color:#C62828;padding:14px 40px;text-align:center;">
                  <p style="margin:0;color:#ffffff;font-size:15px;font-weight:600;">&#10007; Product Not Approved — Action Required</p>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:36px 40px 28px;">
                  <p style="color:#3D1009;font-size:17px;margin:0 0 10px;">Hi <strong>${sellerName || 'Seller'}</strong>,</p>
                  <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 28px;">Thank you for submitting your product. After reviewing your listing, our team has requested some changes before it can go live on the marketplace. Please review the feedback below and update your listing accordingly.</p>

                  <!-- Product box -->
                  <div style="background:#F9EDE9;border-radius:8px;padding:22px;border-top:3px solid #C62828;margin-bottom:24px;">
                    <p style="margin:0 0 12px;color:#5A1E12;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Product Under Review</p>
                    <p style="margin:0;color:#333;font-size:16px;font-weight:600;">&#127912; ${productTitle || 'Your Product'}</p>
                  </div>

                  <!-- Reason box -->
                  <div style="background:#FFF3F0;border-radius:8px;padding:22px;border-left:4px solid #C62828;margin-bottom:24px;">
                    <p style="margin:0 0 10px;color:#C62828;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">&#128221; Feedback from Admin</p>
                    <p style="margin:0;color:#333;font-size:15px;line-height:1.7;">${reason || 'No specific reason was provided. Please contact support if you need clarification.'}</p>
                  </div>

                  <!-- What to do next -->
                  <div style="background:#F9EDE9;border-radius:8px;padding:22px;border-top:3px solid #5A1E12;margin-bottom:24px;">
                    <p style="margin:0 0 16px;color:#5A1E12;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">How to Resubmit</p>
                    <table cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td style="padding:8px 0;">
                          <span style="color:#C4603A;font-size:16px;margin-right:10px;">&#49;&#65039;&#8419;</span>
                          <span style="color:#555;font-size:14px;">Log in to your seller dashboard</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;">
                          <span style="color:#C4603A;font-size:16px;margin-right:10px;">&#50;&#65039;&#8419;</span>
                          <span style="color:#555;font-size:14px;">Find this product and edit the listing based on the feedback above</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;">
                          <span style="color:#C4603A;font-size:16px;margin-right:10px;">&#51;&#65039;&#8419;</span>
                          <span style="color:#555;font-size:14px;">Save your changes — the product will be resubmitted for review automatically</span>
                        </td>
                      </tr>
                    </table>
                  </div>

                  <div style="background:#F9EDE9;border-left:4px solid #C4603A;border-radius:0 8px 8px 0;padding:16px 20px;">
                    <p style="margin:0 0 6px;color:#5A1E12;font-weight:700;font-size:14px;">&#128161; Need Help?</p>
                    <p style="margin:0;color:#7D2E1E;font-size:13px;line-height:1.6;">If you have any questions about the feedback or need assistance, please contact our support team. We're here to help you get your artwork listed successfully.</p>
                  </div>
                </td>
              </tr>
              <!-- CTA -->
              <tr>
                <td style="padding:0 40px 36px;text-align:center;">
                  <a href="${dashboardUrl}" style="display:inline-block;background-color:#5A1E12;color:#ffffff;padding:14px 40px;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;">Edit My Products</a>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color:#3D1009;padding:22px 40px;text-align:center;">
                  <p style="margin:0 0 4px;color:#F0D0C8;font-size:13px;">MIA Marketplace &mdash; Supporting Aboriginal Artists &#127775;</p>
                  <p style="margin:0;color:#8B5C54;font-size:11px;">This is an automated email &mdash; please do not reply. &copy; 2026 MIA Marketplace.</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`✅ Seller product rejected email sent to ${sellerEmail} for product: "${productTitle}"`);
    return { success: true };
  } catch (error) {
    console.error("❌ Seller product rejected email error:", error.response?.body || error.message);
    return { success: false, error: error.message };
  }
};

// ── Admin New Order Email ────────────────────────────────────────────────────
// Sent to every admin when a new order is placed.
// orderDetails: { orderId, customerName, customerEmail, customerPhone?,
//                 sellerNames (string), totalAmount, paymentMethod, items[] }
const sendAdminNewOrderEmail = async (adminEmail, adminName, orderDetails) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("📧 DEVELOPMENT MODE - Admin New Order Email");
    console.log("=".repeat(50));
    console.log(`To: ${adminEmail}`);
    console.log(`Order: ${orderDetails.orderId}`);
    console.log(`Customer: ${orderDetails.customerName}`);
    console.log(`Sellers: ${orderDetails.sellerNames}`);
    console.log(`Total: $${parseFloat(orderDetails.totalAmount).toFixed(2)}`);
    console.log("=".repeat(50) + "\n");
    return { success: true };
  }

  const productRows = (orderDetails.items || []).map(item => `
    <tr style="border-bottom:1px solid #EDD8CC;">
      <td style="padding:10px 12px;color:#333;font-size:14px;">${item.title || item.product?.title || 'Product'}</td>
      <td style="padding:10px 12px;text-align:center;color:#555;font-size:14px;">${item.quantity}</td>
      <td style="padding:10px 12px;text-align:right;color:#5A1E12;font-size:14px;font-weight:700;">$${(parseFloat(item.price || 0) * (item.quantity || 0)).toFixed(2)}</td>
    </tr>
  `).join('');

  const msg = {
    to: adminEmail,
    from: { email: senderEmail, name: senderName },
    subject: `New Order Placed: #${orderDetails.orderId} — MIA Marketplace`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
      <body style="margin:0;padding:0;background-color:#FDF5F3;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FDF5F3;padding:30px 0;">
          <tr><td align="center">
            <table width="650" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(90,30,18,0.12);">
              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#5A1E12 0%,#7D2E1E 100%);padding:36px 40px;text-align:center;">
                  <p style="margin:0 0 8px;font-size:12px;color:#F9EDE9;letter-spacing:3px;text-transform:uppercase;">Admin Dashboard</p>
                  <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">&#128717; New Order Received</h1>
                  <p style="margin:10px 0 0;color:#F0D0C8;font-size:14px;">A customer has just placed an order</p>
                </td>
              </tr>
              <!-- Greeting -->
              <tr>
                <td style="padding:28px 40px 16px;">
                  <p style="color:#3D1009;font-size:16px;margin:0 0 6px;">Hi <strong>${adminName}</strong>,</p>
                  <p style="color:#555;font-size:14px;line-height:1.7;margin:0;">A new order has been placed on the marketplace. Here are the full details.</p>
                </td>
              </tr>
              <!-- Order meta -->
              <tr>
                <td style="padding:0 40px 20px;">
                  <div style="background:#F9EDE9;border-radius:8px;padding:20px;border-top:3px solid #5A1E12;">
                    <p style="margin:0 0 14px;color:#5A1E12;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Order Details</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Order ID</strong></td>
                        <td style="padding:6px 0;color:#3D1009;font-size:14px;text-align:right;font-family:monospace;">#${orderDetails.orderId}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Date</strong></td>
                        <td style="padding:6px 0;color:#3D1009;font-size:14px;text-align:right;">${new Date().toLocaleDateString('en-AU', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#7D2E1E;font-size:14px;"><strong>Payment</strong></td>
                        <td style="padding:6px 0;color:#3D1009;font-size:14px;text-align:right;">${orderDetails.paymentMethod || 'N/A'}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#7D2E1E;font-size:16px;"><strong>Order Total</strong></td>
                        <td style="padding:6px 0;color:#5A1E12;font-size:20px;font-weight:800;text-align:right;">$${parseFloat(orderDetails.totalAmount).toFixed(2)}</td>
                      </tr>
                    </table>
                  </div>
                </td>
              </tr>
              <!-- Customer + Seller info -->
              <tr>
                <td style="padding:0 40px 20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td width="48%" valign="top" style="padding-right:8px;">
                        <div style="background:#F9EDE9;border-radius:8px;padding:16px;border-top:3px solid #C4603A;">
                          <p style="margin:0 0 10px;color:#5A1E12;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Customer</p>
                          <p style="margin:4px 0;color:#333;font-size:14px;"><strong>${orderDetails.customerName || 'N/A'}</strong></p>
                          <p style="margin:4px 0;color:#555;font-size:13px;">${orderDetails.customerEmail || 'N/A'}</p>
                          ${orderDetails.customerPhone ? `<p style="margin:4px 0;color:#555;font-size:13px;">${orderDetails.customerPhone}</p>` : ''}
                        </div>
                      </td>
                      <td width="4%"></td>
                      <td width="48%" valign="top" style="padding-left:8px;">
                        <div style="background:#F9EDE9;border-radius:8px;padding:16px;border-top:3px solid #5A1E12;">
                          <p style="margin:0 0 10px;color:#5A1E12;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Seller(s)</p>
                          <p style="margin:4px 0;color:#333;font-size:14px;"><strong>${orderDetails.sellerNames || 'N/A'}</strong></p>
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <!-- Items -->
              ${productRows ? `
              <tr>
                <td style="padding:0 40px 20px;">
                  <p style="color:#5A1E12;font-size:15px;font-weight:700;margin:0 0 10px;">Items Ordered</p>
                  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;">
                    <thead>
                      <tr style="background-color:#5A1E12;">
                        <th style="padding:11px 12px;text-align:left;color:#fff;font-size:13px;">Product</th>
                        <th style="padding:11px 12px;text-align:center;color:#fff;font-size:13px;">Qty</th>
                        <th style="padding:11px 12px;text-align:right;color:#fff;font-size:13px;">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>${productRows}</tbody>
                    <tfoot>
                      <tr style="background:#F9EDE9;">
                        <td colspan="2" style="padding:12px;text-align:right;color:#5A1E12;font-size:15px;font-weight:700;">Total:</td>
                        <td style="padding:12px;text-align:right;color:#5A1E12;font-size:18px;font-weight:800;">$${parseFloat(orderDetails.totalAmount).toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </td>
              </tr>` : ''}
              <!-- CTA -->
              <tr>
                <td style="padding:0 40px 36px;text-align:center;">
                  <table width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td style="padding-right:8px;text-align:right;">
                      <a href="${process.env.FRONTEND_URL || 'https://apla-fe.vercel.app'}/admin/orders/${orderDetails.orderId}" style="display:inline-block;background-color:#5A1E12;color:#ffffff;padding:13px 28px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">&#128717; View in Admin Panel</a>
                    </td>
                    <td style="padding-left:8px;text-align:left;">
                      <a href="${process.env.FRONTEND_URL || 'https://apla-fe.vercel.app'}/admin/orders/${orderDetails.orderId}" style="display:inline-block;background-color:#C4603A;color:#ffffff;padding:13px 28px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">&#128196; Download Invoice</a>
                    </td>
                  </tr></table>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="background-color:#3D1009;padding:22px 40px;text-align:center;">
                  <p style="margin:0 0 4px;color:#F0D0C8;font-size:13px;">MIA Marketplace &mdash; Admin Notification</p>
                  <p style="margin:0;color:#8B5C54;font-size:11px;">This is an automated email &mdash; please do not reply. &copy; 2026 MIA Marketplace.</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`✅ Admin new order email sent to ${adminEmail} for order ${orderDetails.orderId}`);
    return { success: true };
  } catch (error) {
    console.error("❌ Admin new order email error:", error.response?.body || error.message);
    return { success: false, error: error.message };
  }
};

// Test email configuration
const testEmailConfig = async () => {
  if (!emailConfigured) {
    console.log("âš ï¸  Email not configured");
    return false;
  }
  
  console.log("âœ“ SendGrid email service is ready");
  return true;
};

module.exports = { 
  generateOTP, 
  sendOTPEmail, 
  testEmailConfig,
  sendOrderConfirmationEmail,
  sendOrderStatusEmail,
  sendSellerOrderNotificationEmail,
  sendAdminNewOrderEmail,
  sendContactFormEmail,
  sendSLAWarningEmail,
  sendSellerApplicationSubmittedEmail,
  sendSellerApprovedEmail,
  sendSellerRegistrationEmail,
  sendSellerLowStockEmail,
  sendAdminProductPendingEmail,
  sendSellerProductApprovedEmail,
  sendSellerProductRejectedEmail
};




