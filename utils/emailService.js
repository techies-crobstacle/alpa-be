// const nodemailer = require("nodemailer");

// /**
//  * FREE EMAIL SERVICE SETUP (No Paid Service Required!)
//  * 
//  * To enable email notifications, add these to your .env file:
//  * 
//  * EMAIL_USER=your-email@gmail.com
//  * EMAIL_PASSWORD=your-app-password
//  * 
//  * For Gmail:
//  * 1. Go to Google Account settings
//  * 2. Enable 2-Step Verification
//  * 3. Go to Security > App passwords
//  * 4. Generate an app password for "Mail"
//  * 5. Use that password in EMAIL_PASSWORD
//  * 
//  * If not configured, emails will be logged to console in development mode.
//  */

// // Create transporter (configure with your email service)
// let transporter = null;

// try {
//   if (process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
//     transporter = nodemailer.createTransport({
//       host: "smtp.gmail.com",
//       port: 587, // Use 587 instead of 465 (more reliable)
//       secure: false, // Use STARTTLS
//       auth: {
//         user: process.env.EMAIL_USER, // Your email
//         pass: process.env.EMAIL_PASSWORD, // Your email password or app password
//       },
//       tls: {
//         rejectUnauthorized: false // Allow self-signed certificates (dev only)
//       }
//     });
//     console.log("✅ Email service initialized");
//   } else {
//     console.log("⚠️  Email credentials not configured. Email notifications will be logged to console.");
//   }
// } catch (error) {
//   console.error("❌ Email initialization error:", error.message);
// }

// // Development mode - logs to console if email not configured
// const isDevelopmentMode = !process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD;

// // Generate 6-digit OTP
// const generateOTP = () => {
//   return Math.floor(100000 + Math.random() * 900000).toString();
// };

// // Send OTP email
// const sendOTPEmail = async (email, otp, name) => {
//   // Development mode - just log OTP to console
//   if (isDevelopmentMode) {
//     console.log("\n" + "=".repeat(50));
//     console.log("📧 DEVELOPMENT MODE - OTP Email");
//     console.log("=".repeat(50));
//     console.log(`To: ${email}`);
//     console.log(`Name: ${name}`);
//     console.log(`OTP: ${otp}`);
//     console.log("=".repeat(50) + "\n");
//     return { success: true };
//   }

//   const mailOptions = {
//     from: process.env.EMAIL_USER,
//     to: email,
//     subject: "Email Verification - OTP",
//     html: `
//       <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//         <h2 style="color: #333;">Email Verification</h2>
//         <p>Hi ${name},</p>
//         <p>Thank you for registering! Please use the following OTP to verify your email address:</p>
//         <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
//           ${otp}
//         </div>
//         <p style="color: #666;">This OTP will expire in 10 minutes.</p>
//         <p style="color: #666;">If you didn't request this, please ignore this email.</p>
//         <hr style="margin-top: 30px; border: none; border-top: 1px solid #ddd;">
//         <p style="color: #999; font-size: 12px;">This is an automated email, please do not reply.</p>
//       </div>
//     `,
//   };

//   try {
//     // Add timeout to prevent hanging (15 seconds)
//     const sendMailWithTimeout = Promise.race([
//       transporter.sendMail(mailOptions),
//       new Promise((_, reject) => 
//         setTimeout(() => reject(new Error("Email sending timeout - network issue")), 15000)
//       )
//     ]);
    
//     await sendMailWithTimeout;
//     console.log("✅ Email sent successfully to:", email);
//     return { success: true };
//   } catch (error) {
//     console.error("❌ Email sending error:", error.message);
    
//     // Return success in development/testing to not block user registration
//     if (process.env.NODE_ENV === 'development') {
//       console.log("⚠️ Development mode: Returning success despite email error");
//       console.log("📝 OTP for testing:", otp);
//       return { success: true };
//     }
    
//     return { success: false, error: error.message };
//   }
// };

// // Send Order Confirmation Email
// const sendOrderConfirmationEmail = async (email, customerName, orderDetails) => {
//   // Development mode - just log to console
//   if (isDevelopmentMode || !transporter) {
//     console.log("\n" + "=".repeat(50));
//     console.log("📧 DEVELOPMENT MODE - Order Confirmation Email");
//     console.log("=".repeat(50));
//     console.log(`To: ${email}`);
//     console.log(`Customer: ${customerName}`);
//     console.log(`Order ID: ${orderDetails.orderId}`);
//     console.log(`Total: $${orderDetails.totalAmount.toFixed(2)}`);
//     console.log(`Items: ${orderDetails.itemCount} product(s)`);
//     console.log("=".repeat(50) + "\n");
//     return { success: true, message: "Email logged to console (dev mode)" };
//   }

//   // Build product rows HTML
//   const productRows = orderDetails.products.map(product => `
//     <tr style="border-bottom: 1px solid #ddd;">
//       <td style="padding: 12px 8px;">${product.title || 'Product'}</td>
//       <td style="padding: 12px 8px; text-align: center;">${product.quantity}</td>
//       <td style="padding: 12px 8px; text-align: right;">$${(product.price || 0).toFixed(2)}</td>
//       <td style="padding: 12px 8px; text-align: right; font-weight: bold;">$${((product.price || 0) * (product.quantity || 0)).toFixed(2)}</td>
//     </tr>
//   `).join('');

//   const shippingAddress = orderDetails.shippingAddress || {};
//   const addressParts = [
//     shippingAddress.address || shippingAddress.street,
//     shippingAddress.city,
//     shippingAddress.state,
//     shippingAddress.pincode || shippingAddress.zipCode || shippingAddress.postalCode
//   ].filter(Boolean).join(', ');

//   const mailOptions = {
//     from: `"Aboriginal Art Marketplace" <${process.env.EMAIL_USER}>`,
//     to: email,
//     subject: `Order Confirmation - Invoice #${orderDetails.orderId}`,
//     html: `
//       <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; background-color: #fff;">
//         <!-- Header -->
//         <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0;">
//           <h1 style="margin: 0; font-size: 28px;">🎨 ORDER CONFIRMED</h1>
//           <p style="margin: 10px 0 0 0; font-size: 14px;">Thank you for your purchase!</p>
//         </div>

//         <!-- Invoice Details -->
//         <div style="background-color: #f9f9f9; padding: 20px; border-left: 4px solid #4CAF50;">
//           <table style="width: 100%; border-collapse: collapse;">
//             <tr>
//               <td style="padding: 8px 0;"><strong>Invoice Number:</strong></td>
//               <td style="padding: 8px 0; text-align: right;">#${orderDetails.orderId}</td>
//             </tr>
//             <tr>
//               <td style="padding: 8px 0;"><strong>Order Date:</strong></td>
//               <td style="padding: 8px 0; text-align: right;">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
//             </tr>
//             <tr>
//               <td style="padding: 8px 0;"><strong>Payment Method:</strong></td>
//               <td style="padding: 8px 0; text-align: right;">${orderDetails.paymentMethod || 'COD'}</td>
//             </tr>
//           </table>
//         </div>

//         <!-- Customer & Shipping Info -->
//         <div style="margin: 20px 0;">
//           <table style="width: 100%;">
//             <tr>
//               <td style="width: 50%; vertical-align: top; padding-right: 10px;">
//                 <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
//                   <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">Customer Details</h3>
//                   <p style="margin: 5px 0;"><strong>Name:</strong> ${customerName}</p>
//                   <p style="margin: 5px 0;"><strong>Email:</strong> ${email}</p>
//                   ${orderDetails.customerPhone ? `<p style="margin: 5px 0;"><strong>Phone:</strong> ${orderDetails.customerPhone}</p>` : ''}
//                 </div>
//               </td>
//               <td style="width: 50%; vertical-align: top; padding-left: 10px;">
//                 <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
//                   <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">Shipping Address</h3>
//                   <p style="margin: 5px 0; line-height: 1.6;">
//                     ${shippingAddress.name || customerName}<br/>
//                     ${addressParts || 'Address not provided'}
//                   </p>
//                   ${shippingAddress.phone ? `<p style="margin: 5px 0;"><strong>Phone:</strong> ${shippingAddress.phone}</p>` : ''}
//                 </div>
//               </td>
//             </tr>
//           </table>
//         </div>

//         <!-- Products Table -->
//         <div style="margin: 20px 0;">
//           <h3 style="color: #333; margin-bottom: 10px;">Order Items</h3>
//           <table style="width: 100%; border-collapse: collapse; background-color: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
//             <thead>
//               <tr style="background-color: #4CAF50; color: white;">
//                 <th style="padding: 12px 8px; text-align: left;">Product</th>
//                 <th style="padding: 12px 8px; text-align: center;">Quantity</th>
//                 <th style="padding: 12px 8px; text-align: right;">Unit Price</th>
//                 <th style="padding: 12px 8px; text-align: right;">Total</th>
//               </tr>
//             </thead>
//             <tbody>
//               ${productRows}
//             </tbody>
//             <tfoot>
//               <tr style="background-color: #f9f9f9; font-weight: bold;">
//                 <td colspan="3" style="padding: 15px 8px; text-align: right; font-size: 18px;">Grand Total:</td>
//                 <td style="padding: 15px 8px; text-align: right; color: #4CAF50; font-size: 20px;">$${orderDetails.totalAmount.toFixed(2)}</td>
//               </tr>
//             </tfoot>
//           </table>
//         </div>

//         <!-- Next Steps -->
//         <div style="background-color: #E3F2FD; padding: 15px; border-radius: 5px; margin: 20px 0;">
//           <h3 style="margin: 0 0 10px 0; color: #1976D2;">📦 What's Next?</h3>
//           <p style="margin: 5px 0; color: #555;">✓ Your order is being processed</p>
//           <p style="margin: 5px 0; color: #555;">✓ We'll email you when it ships with tracking details</p>
//           <p style="margin: 5px 0; color: #555;">✓ Track your order anytime using the button below</p>
//         </div>

//         <!-- CTA Button -->
//         <div style="text-align: center; margin: 30px 0;">
//           <a href="${process.env.FRONTEND_URL || 'https://yourwebsite.com'}/orders/${orderDetails.orderId}" 
//              style="background-color: #4CAF50; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-size: 16px; font-weight: bold;">
//             Track Your Order
//           </a>
//         </div>

//         <!-- Footer -->
//         <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
//           <p style="color: #666; font-size: 14px; margin: 5px 0;">Thank you for supporting Aboriginal artists! 🌟</p>
//           <p style="color: #999; font-size: 12px; margin: 5px 0;">This is an automated email, please do not reply.</p>
//         </div>
//       </div>
//     `,
//   };

//   try {
//     await transporter.sendMail(mailOptions);
//     console.log(`✅ Order confirmation email sent to ${email}`);
//     return { success: true, message: "Email sent successfully" };
//   } catch (error) {
//     console.error("❌ Email sending error:", error.message);
//     return { success: false, error: error.message };
//   }
// };

// // Send Order Status Update Email
// const sendOrderStatusEmail = async (email, customerName, orderDetails) => {
//   // Development mode - just log to console
//   if (isDevelopmentMode || !transporter) {
//     console.log("\n" + "=".repeat(50));
//     console.log("📧 DEVELOPMENT MODE - Order Status Update Email");
//     console.log("=".repeat(50));
//     console.log(`To: ${email}`);
//     console.log(`Customer: ${customerName}`);
//     console.log(`Order ID: ${orderDetails.orderId}`);
//     console.log(`Status: ${orderDetails.status}`);
//     if (orderDetails.trackingNumber) {
//       console.log(`Tracking: ${orderDetails.trackingNumber}`);
//     }
//     console.log("=".repeat(50) + "\n");
//     return { success: true, message: "Email logged to console (dev mode)" };
//   }

//   let statusMessage = "";
//   let statusColor = "#4CAF50";
  
//   switch (orderDetails.status) {
//     case "packed":
//       statusMessage = "Your order has been packed and is ready for shipping! 📦";
//       statusColor = "#FF9800";
//       break;
//     case "shipped":
//       statusMessage = "Great news! Your order has been shipped! 🚚";
//       statusColor = "#2196F3";
//       break;
//     case "delivered":
//       statusMessage = "Your order has been delivered! 🎉";
//       statusColor = "#4CAF50";
//       break;
//     case "cancelled":
//       statusMessage = "Your order has been cancelled. Refund will be processed within 3-5 business days.";
//       statusColor = "#F44336";
//       break;
//     default:
//       statusMessage = `Your order status has been updated to: ${orderDetails.status}`;
//   }

//   const mailOptions = {
//     from: `"Aboriginal Art Marketplace" <${process.env.EMAIL_USER}>`,
//     to: email,
//     subject: `Order Update - #${orderDetails.orderId}`,
//     html: `
//       <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//         <h2 style="color: #333; border-bottom: 2px solid ${statusColor}; padding-bottom: 10px;">🎨 Order Update</h2>
//         <p>Hi ${customerName},</p>
        
//         <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
//           <h3 style="margin-top: 0; color: ${statusColor};">${statusMessage}</h3>
//           <p><strong>Order ID:</strong> #${orderDetails.orderId}</p>
//           ${orderDetails.trackingNumber ? `<p><strong>Tracking Number:</strong> ${orderDetails.trackingNumber}</p>` : ''}
//         </div>

//         <div style="text-align: center; margin: 30px 0;">
//           <a href="${process.env.FRONTEND_URL || 'https://yourwebsite.com'}/orders/${orderDetails.orderId}" 
//              style="background-color: ${statusColor}; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
//             View Order Details
//           </a>
//         </div>

//         <p style="color: #666; font-size: 14px;">Thank you for shopping with us! 🌟</p>
        
//         <hr style="margin-top: 30px; border: none; border-top: 1px solid #ddd;">
//         <p style="color: #999; font-size: 12px;">This is an automated email, please do not reply.</p>
//       </div>
//     `,
//   };

//   try {
//     await transporter.sendMail(mailOptions);
//     console.log(`✅ Order status email sent to ${email}`);
//     return { success: true, message: "Email sent successfully" };
//   } catch (error) {
//     console.error("❌ Email sending error:", error.message);
//     return { success: false, error: error.message };
//   }
// };

// // Send Seller Order Notification Email
// const sendSellerOrderNotificationEmail = async (email, sellerName, orderDetails) => {
//   // Development mode - just log to console
//   if (isDevelopmentMode || !transporter) {
//     console.log("\n" + "=".repeat(50));
//     console.log("📧 DEVELOPMENT MODE - Seller Order Notification Email");
//     console.log("=".repeat(50));
//     console.log(`To: ${email}`);
//     console.log(`Seller: ${sellerName}`);
//     console.log(`Order ID: ${orderDetails.orderId}`);
//     console.log(`Products: ${orderDetails.productCount}`);
//     console.log(`Amount: $${orderDetails.totalAmount.toFixed(2)}`);
//     console.log("=".repeat(50) + "\n");
//     return { success: true, message: "Email logged to console (dev mode)" };
//   }

//   // Build product rows HTML for seller's products only
//   const productRows = orderDetails.products ? orderDetails.products.map(product => `
//     <tr style="border-bottom: 1px solid #ddd;">
//       <td style="padding: 12px 8px;">${product.title || 'Product'}</td>
//       <td style="padding: 12px 8px; text-align: center;">${product.quantity}</td>
//       <td style="padding: 12px 8px; text-align: right;">$${(product.price || 0).toFixed(2)}</td>
//       <td style="padding: 12px 8px; text-align: right; font-weight: bold;">$${((product.price || 0) * (product.quantity || 0)).toFixed(2)}</td>
//     </tr>
//   `).join('') : '';

//   const shippingAddress = orderDetails.shippingAddress || {};
//   const addressParts = [
//     shippingAddress.address || shippingAddress.street,
//     shippingAddress.city,
//     shippingAddress.state,
//     shippingAddress.pincode || shippingAddress.zipCode || shippingAddress.postalCode
//   ].filter(Boolean).join(', ');

//   const mailOptions = {
//     from: `"Aboriginal Art Marketplace" <${process.env.EMAIL_USER}>`,
//     to: email,
//     subject: `🎉 New Order #${orderDetails.orderId} - Action Required`,
//     html: `
//       <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; background-color: #fff;">
//         <!-- Header -->
//         <div style="background-color: #FF9800; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0;">
//           <h1 style="margin: 0; font-size: 28px;">🎉 NEW ORDER RECEIVED</h1>
//           <p style="margin: 10px 0 0 0; font-size: 14px;">You have a new order to process!</p>
//         </div>

//         <!-- Seller Greeting -->
//         <div style="padding: 20px; background-color: #FFF3E0; border-left: 4px solid #FF9800;">
//           <p style="margin: 0; font-size: 16px;">Hi <strong>${sellerName}</strong>,</p>
//           <p style="margin: 10px 0 0 0;">Great news! You've received a new order. Please process it as soon as possible.</p>
//         </div>

//         <!-- Order Details -->
//         <div style="background-color: #f9f9f9; padding: 20px; margin: 20px 0; border-left: 4px solid #4CAF50;">
//           <table style="width: 100%; border-collapse: collapse;">
//             <tr>
//               <td style="padding: 8px 0;"><strong>Order ID:</strong></td>
//               <td style="padding: 8px 0; text-align: right;">#${orderDetails.orderId}</td>
//             </tr>
//             <tr>
//               <td style="padding: 8px 0;"><strong>Order Date:</strong></td>
//               <td style="padding: 8px 0; text-align: right;">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
//             </tr>
//             <tr>
//               <td style="padding: 8px 0;"><strong>Payment Method:</strong></td>
//               <td style="padding: 8px 0; text-align: right;">${orderDetails.paymentMethod || 'COD'}</td>
//             </tr>
//           </table>
//         </div>

//         <!-- Customer & Shipping Info -->
//         <div style="margin: 20px 0;">
//           <h3 style="color: #333; margin-bottom: 10px;">Customer & Delivery Details</h3>
//           <table style="width: 100%;">
//             <tr>
//               <td style="width: 50%; vertical-align: top; padding-right: 10px;">
//                 <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
//                   <h4 style="margin: 0 0 10px 0; color: #555; font-size: 14px;">CUSTOMER INFORMATION</h4>
//                   <p style="margin: 5px 0;"><strong>Name:</strong> ${orderDetails.customerName || 'N/A'}</p>
//                   <p style="margin: 5px 0;"><strong>Email:</strong> ${orderDetails.customerEmail || 'N/A'}</p>
//                   ${orderDetails.customerPhone ? `<p style="margin: 5px 0;"><strong>Phone:</strong> ${orderDetails.customerPhone}</p>` : ''}
//                 </div>
//               </td>
//               <td style="width: 50%; vertical-align: top; padding-left: 10px;">
//                 <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">
//                   <h4 style="margin: 0 0 10px 0; color: #555; font-size: 14px;">SHIPPING ADDRESS</h4>
//                   <p style="margin: 5px 0; line-height: 1.6;">
//                     ${shippingAddress.name || orderDetails.customerName || 'Customer'}<br/>
//                     ${addressParts || 'Address not provided'}
//                   </p>
//                   ${shippingAddress.phone ? `<p style="margin: 5px 0;"><strong>Phone:</strong> ${shippingAddress.phone}</p>` : ''}
//                 </div>
//               </td>
//             </tr>
//           </table>
//         </div>

//         <!-- Products Table -->
//         <div style="margin: 20px 0;">
//           <h3 style="color: #333; margin-bottom: 10px;">Your Products in This Order</h3>
//           <table style="width: 100%; border-collapse: collapse; background-color: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
//             <thead>
//               <tr style="background-color: #FF9800; color: white;">
//                 <th style="padding: 12px 8px; text-align: left;">Product</th>
//                 <th style="padding: 12px 8px; text-align: center;">Quantity</th>
//                 <th style="padding: 12px 8px; text-align: right;">Unit Price</th>
//                 <th style="padding: 12px 8px; text-align: right;">Total</th>
//               </tr>
//             </thead>
//             <tbody>
//               ${productRows || `<tr><td colspan="4" style="padding: 20px; text-align: center; color: #999;">Product details will be available in your dashboard</td></tr>`}
//             </tbody>
//             <tfoot>
//               <tr style="background-color: #f9f9f9; font-weight: bold;">
//                 <td colspan="3" style="padding: 15px 8px; text-align: right; font-size: 18px;">Your Total Earnings:</td>
//                 <td style="padding: 15px 8px; text-align: right; color: #4CAF50; font-size: 20px;">$${orderDetails.totalAmount.toFixed(2)}</td>
//               </tr>
//             </tfoot>
//           </table>
//         </div>

//         <!-- Action Required Box -->
//         <div style="background-color: #FFEBEE; padding: 15px; border-radius: 5px; border-left: 4px solid #F44336; margin: 20px 0;">
//           <h3 style="margin: 0 0 10px 0; color: #D32F2F;">⚠️ Action Required</h3>
//           <p style="margin: 5px 0; color: #555;">✓ Log in to your seller dashboard</p>
//           <p style="margin: 5px 0; color: #555;">✓ Confirm the order and update stock</p>
//           <p style="margin: 5px 0; color: #555;">✓ Pack and ship the items within 2-3 business days</p>
//           <p style="margin: 5px 0; color: #555;">✓ Update tracking information for customer</p>
//         </div>

//         <!-- CTA Button -->
//         <div style="text-align: center; margin: 30px 0;">
//           <a href="${process.env.FRONTEND_URL || 'https://yourwebsite.com'}/seller/orders" 
//              style="background-color: #FF9800; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-size: 16px; font-weight: bold;">
//             View Order in Dashboard
//           </a>
//         </div>

//         <!-- Footer -->
//         <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
//           <p style="color: #666; font-size: 14px; margin: 5px 0;">Thank you for being a valued seller! 💼</p>
//           <p style="color: #999; font-size: 12px; margin: 5px 0;">This is an automated email, please do not reply.</p>
//         </div>
//       </div>
//     `,
//   };

//   try {
//     await transporter.sendMail(mailOptions);
//     console.log(`✅ Seller notification email sent to ${email}`);
//     return { success: true, message: "Email sent successfully" };
//   } catch (error) {
//     console.error("❌ Email sending error:", error.message);
//     return { success: false, error: error.message };
//   }
// };

// // Test email configuration
// const testEmailConfig = async () => {
//   if (!transporter) {
//     console.log("⚠️  Email not configured - notifications will be logged to console");
//     return false;
//   }
  
//   try {
//     await transporter.verify();
//     console.log("✓ Email service is ready to send emails");
//     return true;
//   } catch (error) {
//     console.error("✗ Email configuration error:", error.message);
//     console.error("Please check your EMAIL_USER and EMAIL_PASSWORD in .env file");
//     return false;
//   }
// };

// // Send Contact Form Confirmation Email
// const sendContactFormEmail = async (email, name, subject, message) => {
//   // Development mode - just log to console
//   if (isDevelopmentMode || !transporter) {
//     console.log("\n" + "=".repeat(50));
//     console.log("📧 DEVELOPMENT MODE - Contact Form Email");
//     console.log("=".repeat(50));
//     console.log(`To: ${email}`);
//     console.log(`Name: ${name}`);
//     console.log(`Subject: ${subject}`);
//     console.log(`Message: ${message}`);
//     console.log("=".repeat(50) + "\n");
//     return { success: true, message: "Email logged to console (dev mode)" };
//   }

//   const mailOptions = {
//     from: process.env.EMAIL_USER,
//     to: email,
//     subject: `Contact Form Received - ${subject}`,
//     html: `
//       <!DOCTYPE html>
//       <html>
//       <head>
//         <meta charset="UTF-8">
//         <meta name="viewport" content="width=device-width, initial-scale=1.0">
//       </head>
//       <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
//         <table role="presentation" style="width: 100%; border-collapse: collapse;">
//           <tr>
//             <td style="padding: 20px 0; text-align: center; background-color: #2c3e50;">
//               <h1 style="margin: 0; color: #ffffff; font-size: 28px;">Message Received</h1>
//             </td>
//           </tr>
//           <tr>
//             <td style="padding: 40px 20px;">
//               <table role="presentation" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
//                 <tr>
//                   <td style="padding: 40px 30px;">
//                     <h2 style="color: #2c3e50; margin-top: 0;">Hi ${name},</h2>
//                     <p style="color: #555; line-height: 1.6; font-size: 16px;">
//                       Thank you for contacting us! We've received your message and our support team will review it shortly.
//                     </p>

//                     <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin: 30px 0;">
//                       <h3 style="color: #2c3e50; margin-top: 0; font-size: 18px;">Your Message:</h3>
//                       <p style="margin: 5px 0; color: #666;"><strong>Subject:</strong> ${subject}</p>
//                       <p style="margin: 15px 0 5px 0; color: #666;"><strong>Message:</strong></p>
//                       <p style="margin: 5px 0; color: #555; line-height: 1.6;">${message}</p>
//                     </div>

//                     <div style="background-color: #e8f4f8; padding: 20px; border-left: 4px solid #3498db; border-radius: 4px; margin: 30px 0;">
//                       <p style="margin: 0; color: #2c3e50; font-weight: bold;">📧 What's Next?</p>
//                       <p style="margin: 10px 0 0 0; color: #555; line-height: 1.6;">
//                         Our support team typically responds within 24-48 hours. You'll receive a reply at this email address.
//                       </p>
//                     </div>

//                     <p style="color: #555; line-height: 1.6;">
//                       If you need immediate assistance, please call our customer service hotline.
//                     </p>

//                     <p style="color: #555; line-height: 1.6; margin-top: 30px;">
//                       Best regards,<br>
//                       <strong>Customer Support Team</strong>
//                     </p>
//                   </td>
//                 </tr>
//               </table>
//             </td>
//           </tr>
//           <tr>
//             <td style="padding: 20px; text-align: center; background-color: #2c3e50;">
//               <p style="margin: 0; color: #ffffff; font-size: 14px;">
//                 This is an automated confirmation email. Please do not reply directly to this email.
//               </p>
//             </td>
//           </tr>
//         </table>
//       </body>
//       </html>
//     `
//   };

//   try {
//     await transporter.sendMail(mailOptions);
//     return { success: true };
//   } catch (error) {
//     console.error("Contact form email error:", error);
//     return { success: false, error: error.message };
//   }
// };



// // Send SLA Warning Email
// const sendSLAWarningEmail = async (sellerId, orderId, notificationType, slaStatus) => {
//   try {
//     let seller, order;
    
//     // Safely get seller and order information
//     try {
//       const prisma = require('../config/prisma');
      
//       seller = await prisma.user.findUnique({
//         where: { id: sellerId },
//         select: { email: true, name: true }
//       });

//       order = await prisma.order.findUnique({
//         where: { id: orderId },
//         select: { 
//           id: true,
//           customerName: true,
//           totalAmount: true,
//           createdAt: true
//         }
//       });
//     } catch (dbError) {
//       console.error("Database error in SLA email:", dbError.message);
//       return { success: false, error: "Database connection error" };
//     }

//     if (!seller || !seller.email) {
//       console.log("No seller email found for SLA warning");
//       return { success: false, error: "Seller email not found" };
//     }

//     // Development mode - just log to console
//     if (isDevelopmentMode || !transporter) {
//       console.log("\n" + "=".repeat(50));
//       console.log("⚠️  SLA WARNING EMAIL - DEVELOPMENT MODE");
//       console.log("=".repeat(50));
//       console.log(`To: ${seller.email} (${seller.name})`);
//       console.log(`Order: ${orderId}`);
//       console.log(`Type: ${notificationType}`);
//       console.log(`Status: ${slaStatus.status}`);
//       console.log(`Time Remaining: ${slaStatus.timeRemaining.toFixed(1)} hours`);
//       console.log(`Customer: ${order?.customerName || 'N/A'}`);
//       console.log("=".repeat(50) + "\n");
//       return { success: true, message: "SLA warning logged to console (dev mode)" };
//     }

//     const urgencyColor = slaStatus.status === 'BREACHED' ? '#e74c3c' : '#f39c12';
//     const urgencyText = slaStatus.status === 'BREACHED' ? 'OVERDUE' : 'WARNING';

//     const mailOptions = {
//       from: `"Aboriginal Art Marketplace" <${process.env.EMAIL_USER}>`,
//       to: seller.email,
//       subject: `🚨 ${urgencyText}: ${notificationType.replace('_', ' ')} Required - Order #${orderId?.slice(-8)}`,
//       html: `
//         <!DOCTYPE html>
//         <html>
//         <head>
//           <meta charset="utf-8">
//           <meta name="viewport" content="width=device-width, initial-scale=1.0">
//           <title>SLA ${urgencyText}</title>
//         </head>
//         <body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Arial, sans-serif;">
//           <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="border-collapse: collapse; background-color: #ffffff; margin-top: 20px; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
//             <tr>
//               <td style="padding: 30px 40px; background: linear-gradient(135deg, ${urgencyColor} 0%, ${urgencyColor}dd 100%); text-align: center;">
//                 <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold;">
//                   ⚠️ SLA ${urgencyText}
//                 </h1>
//                 <p style="margin: 10px 0 0 0; color: #ffffff; font-size: 16px; opacity: 0.9;">
//                   Immediate attention required
//                 </p>
//               </td>
//             </tr>
//             <tr>
//               <td style="padding: 40px;">
//                 <div style="background-color: ${urgencyColor}15; padding: 20px; border-radius: 8px; border-left: 4px solid ${urgencyColor}; margin-bottom: 30px;">
//                   <h2 style="margin: 0 0 10px 0; color: ${urgencyColor}; font-size: 20px;">
//                     ${notificationType.replace('_', ' ').toUpperCase()} Required
//                   </h2>
//                   <p style="margin: 0; color: #2c3e50; font-size: 16px; line-height: 1.6;">
//                     ${slaStatus.status === 'BREACHED' ? 
//                       'This order is now OVERDUE and requires immediate action.' :
//                       'This order is approaching its deadline and needs attention soon.'
//                     }
//                   </p>
//                 </div>

//                 <div style="background-color: #f8f9fa; padding: 25px; border-radius: 8px; margin-bottom: 30px;">
//                   <h3 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 18px; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">
//                     📋 Order Details
//                   </h3>
//                   <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
//                     <div style="flex: 1;">
//                       <div style="margin-bottom: 10px;">
//                         <strong style="color: #2c3e50;">Order ID:</strong>
//                         <span style="color: #555; margin-left: 10px;">#${orderId?.slice(-8) || 'N/A'}</span>
//                       </div>
//                       <div style="margin-bottom: 10px;">
//                         <strong style="color: #2c3e50;">Customer:</strong>
//                         <span style="color: #555; margin-left: 10px;">${order?.customerName || 'N/A'}</span>
//                       </div>
//                       <div style="margin-bottom: 10px;">
//                         <strong style="color: #2c3e50;">Order Value:</strong>
//                         <span style="color: #555; margin-left: 10px;">$${order?.totalAmount?.toString() || '0.00'}</span>
//                       </div>
//                     </div>
//                   </div>
//                 </div>

//                 <div style="background-color: #fff3cd; padding: 25px; border-radius: 8px; border: 1px solid #ffeaa7; margin-bottom: 30px;">
//                   <h3 style="margin: 0 0 15px 0; color: #856404; font-size: 18px;">
//                     ⏰ SLA Status
//                   </h3>
//                   <div style="margin-bottom: 10px;">
//                     <strong style="color: #856404;">Status:</strong>
//                     <span style="color: ${urgencyColor}; margin-left: 10px; font-weight: bold;">${slaStatus.status}</span>
//                   </div>
//                   <div style="margin-bottom: 10px;">
//                     <strong style="color: #856404;">Time Remaining:</strong>
//                     <span style="color: #555; margin-left: 10px;">
//                       ${slaStatus.isOverdue ? 
//                         `OVERDUE by ${Math.abs(slaStatus.timeRemaining).toFixed(1)} hours` :
//                         `${slaStatus.timeRemaining.toFixed(1)} hours remaining`
//                       }
//                     </span>
//                   </div>
//                   <div>
//                     <strong style="color: #856404;">Priority:</strong>
//                     <span style="color: ${urgencyColor}; margin-left: 10px; font-weight: bold;">${slaStatus.priority}</span>
//                   </div>
//                 </div>

//                 <div style="text-align: center; margin: 30px 0;">
//                   <a href="${process.env.FRONTEND_URL || 'https://yourapp.com'}/seller/orders/${orderId}" 
//                      style="display: inline-block; padding: 15px 30px; background-color: ${urgencyColor}; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold; transition: background-color 0.3s ease;">
//                     🚀 Take Action Now
//                   </a>
//                 </div>

//                 <div style="background-color: #e8f4fd; padding: 20px; border-radius: 8px; border-left: 4px solid #3498db;">
//                   <h4 style="margin: 0 0 10px 0; color: #2980b9; font-size: 16px;">💡 Next Steps:</h4>
//                   <ul style="margin: 0; padding-left: 20px; color: #34495e; line-height: 1.6;">
//                     <li>Log in to your seller dashboard</li>
//                     <li>Update the order status</li>
//                     <li>Add tracking information if applicable</li>
//                     <li>Contact the customer if needed</li>
//                   </ul>
//                 </div>

//                 <p style="color: #7f8c8d; line-height: 1.6; margin-top: 30px; font-size: 14px; border-top: 1px solid #ecf0f1; padding-top: 20px;">
//                   This is an automated SLA monitoring notification. Please take immediate action to avoid service level violations.
//                 </p>
//               </td>
//             </tr>
//             <tr>
//               <td style="padding: 20px; text-align: center; background-color: #2c3e50;">
//                 <p style="margin: 0; color: #ffffff; font-size: 14px;">
//                   Aboriginal Art Marketplace - Seller Support System
//                 </p>
//               </td>
//             </tr>
//           </table>
//         </body>
//         </html>
//       `
//     };

//     await transporter.sendMail(mailOptions);
//     return { success: true };
//   } catch (error) {
//     console.error("SLA warning email error:", error);
//     return { success: false, error: error.message };
//   }
// };

// module.exports = { 
//   generateOTP, 
//   sendOTPEmail, 
//   testEmailConfig,
//   sendOrderConfirmationEmail,
//   sendOrderStatusEmail,
//   sendSellerOrderNotificationEmail,
//   sendContactFormEmail,
//   sendSLAWarningEmail
// };


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
  console.log("✅ SendGrid email service initialized");
  console.log("SendGrid senderEmail:", process.env.SENDER_EMAIL);
  console.log("SendGrid API Key present:", !!process.env.SENDGRID_API_KEY);
} else {
  console.log("⚠️  SendGrid API key not configured. Emails will be logged to console.");
}

const isDevelopmentMode = !emailConfigured;
const senderEmail = process.env.SENDER_EMAIL || process.env.EMAIL_USER || 'noreply@yourapp.com';

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP email
const sendOTPEmail = async (email, otp, name) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("📧 DEVELOPMENT MODE - OTP Email");
    console.log("=".repeat(50));
    console.log(`To: ${email}`);
    console.log(`Name: ${name}`);
    console.log(`OTP: ${otp}`);
    console.log("=".repeat(50) + "\n");
    return { success: true };
  }

  const msg = {
    to: email,
    from: senderEmail,
    subject: "Email Verification - OTP",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Email Verification</h2>
        <p>Hi ${name},</p>
        <p>Thank you for registering! Please use the following OTP to verify your email address:</p>
        <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
          ${otp}
        </div>
        <p style="color: #666;">This OTP will expire in 10 minutes.</p>
        <p style="color: #666;">If you didn't request this, please ignore this email.</p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #ddd;">
        <p style="color: #999; font-size: 12px;">This is an automated email, please do not reply.</p>
      </div>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log("✅ Email sent successfully to:", email);
    return { success: true };
  } catch (error) {
    console.error("❌ SendGrid error:", error.response?.body || error.message);
    
    // Fallback for development
    if (process.env.NODE_ENV === 'development') {
      console.log("⚠️ Development mode: Returning success despite email error");
      console.log("📝 OTP for testing:", otp);
      return { success: true };
    }
    
    return { success: false, error: error.message };
  }
};

// Send Order Confirmation Email
const sendOrderConfirmationEmail = async (email, customerName, orderDetails) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("📧 DEVELOPMENT MODE - Order Confirmation Email");
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

  const shippingAddress = orderDetails.shippingAddress || {};
  const addressParts = [
    shippingAddress.address || shippingAddress.street,
    shippingAddress.city,
    shippingAddress.state,
    shippingAddress.pincode || shippingAddress.zipCode || shippingAddress.postalCode
  ].filter(Boolean).join(', ');

  const msg = {
    to: email,
    from: {
      email: senderEmail,
      name: "Aboriginal Art Marketplace"
    },
    subject: `Order Confirmation - Invoice #${orderDetails.orderId}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; background-color: #fff;">
        <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0;">
          <h1 style="margin: 0; font-size: 28px;">🎨 ORDER CONFIRMED</h1>
          <p style="margin: 10px 0 0 0; font-size: 14px;">Thank you for your purchase!</p>
        </div>

        <div style="background-color: #f9f9f9; padding: 20px; border-left: 4px solid #4CAF50;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0;"><strong>Invoice Number:</strong></td>
              <td style="padding: 8px 0; text-align: right;">#${orderDetails.orderId}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Order Date:</strong></td>
              <td style="padding: 8px 0; text-align: right;">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Payment Method:</strong></td>
              <td style="padding: 8px 0; text-align: right;">${orderDetails.paymentMethod || 'COD'}</td>
            </tr>
          </table>
        </div>

        <div style="margin: 20px 0;">
          <h3 style="color: #333; margin-bottom: 10px;">Order Items</h3>
          <table style="width: 100%; border-collapse: collapse; background-color: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <thead>
              <tr style="background-color: #4CAF50; color: white;">
                <th style="padding: 12px 8px; text-align: left;">Product</th>
                <th style="padding: 12px 8px; text-align: center;">Quantity</th>
                <th style="padding: 12px 8px; text-align: right;">Unit Price</th>
                <th style="padding: 12px 8px; text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${productRows}
            </tbody>
            <tfoot>
              <tr style="background-color: #f9f9f9; font-weight: bold;">
                <td colspan="3" style="padding: 15px 8px; text-align: right; font-size: 18px;">Grand Total:</td>
                <td style="padding: 15px 8px; text-align: right; color: #4CAF50; font-size: 20px;">$${orderDetails.totalAmount.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
          <p style="color: #666; font-size: 14px; margin: 5px 0;">Thank you for supporting Aboriginal artists! 🌟</p>
        </div>
      </div>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`✅ Order confirmation email sent to ${email}`);
    return { success: true, message: "Email sent successfully" };
  } catch (error) {
    console.error("❌ Email sending error:", error.response?.body || error.message);
    return { success: false, error: error.message };
  }
};

// Send Order Status Update Email
const sendOrderStatusEmail = async (email, customerName, orderDetails) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("📧 DEVELOPMENT MODE - Order Status Update");
    console.log("=".repeat(50));
    console.log(`To: ${email}`);
    console.log(`Status: ${orderDetails.status}`);
    console.log("=".repeat(50) + "\n");
    return { success: true };
  }

  let statusMessage = "";
  let statusColor = "#4CAF50";
  
  switch (orderDetails.status) {
    case "packed":
      statusMessage = "Your order has been packed and is ready for shipping! 📦";
      statusColor = "#FF9800";
      break;
    case "shipped":
      statusMessage = "Great news! Your order has been shipped! 🚚";
      statusColor = "#2196F3";
      break;
    case "delivered":
      statusMessage = "Your order has been delivered! 🎉";
      statusColor = "#4CAF50";
      break;
    case "cancelled":
      statusMessage = "Your order has been cancelled.";
      statusColor = "#F44336";
      break;
    default:
      statusMessage = `Your order status: ${orderDetails.status}`;
  }

  const msg = {
    to: email,
    from: {
      email: senderEmail,
      name: "Aboriginal Art Marketplace"
    },
    subject: `Order Update - #${orderDetails.orderId}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333; border-bottom: 2px solid ${statusColor}; padding-bottom: 10px;">🎨 Order Update</h2>
        <p>Hi ${customerName},</p>
        
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: ${statusColor};">${statusMessage}</h3>
          <p><strong>Order ID:</strong> #${orderDetails.orderId}</p>
          ${orderDetails.trackingNumber ? `<p><strong>Tracking:</strong> ${orderDetails.trackingNumber}</p>` : ''}
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL || 'https://yourwebsite.com'}/orders/${orderDetails.orderId}" 
             style="background-color: ${statusColor}; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            View Order Details
          </a>
        </div>
      </div>
    `,
  };

  try {
    await sgMail.send(msg);
    return { success: true };
  } catch (error) {
    console.error("❌ Email error:", error.response?.body || error.message);
    return { success: false, error: error.message };
  }
};

// Send Seller Order Notification Email
const sendSellerOrderNotificationEmail = async (email, sellerName, orderDetails) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("📧 DEVELOPMENT MODE - Seller Notification");
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
      name: "Aboriginal Art Marketplace"
    },
    subject: `🎉 New Order #${orderDetails.orderId}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #FF9800; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0;">🎉 NEW ORDER RECEIVED</h1>
        </div>

        <div style="padding: 20px; background-color: #FFF3E0;">
          <p>Hi <strong>${sellerName}</strong>,</p>
          <p>You have a new order to process!</p>
        </div>

        <div style="padding: 20px;">
          <h3>Order #${orderDetails.orderId}</h3>
          <p><strong>Total:</strong> $${orderDetails.totalAmount.toFixed(2)}</p>
          ${productRows ? `<table style="width: 100%;">${productRows}</table>` : ''}
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL || 'https://yourwebsite.com'}/seller/orders" 
             style="background-color: #FF9800; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px;">
            View in Dashboard
          </a>
        </div>
      </div>
    `,
  };

  try {
    await sgMail.send(msg);
    return { success: true };
  } catch (error) {
    console.error("❌ Email error:", error.response?.body || error.message);
    return { success: false, error: error.message };
  }
};

// Send Contact Form Email
const sendContactFormEmail = async (email, name, subject, message) => {
  if (isDevelopmentMode) {
    console.log("\n" + "=".repeat(50));
    console.log("📧 DEVELOPMENT MODE - Contact Form");
    console.log("=".repeat(50));
    console.log(`To: ${email}`);
    console.log(`Subject: ${subject}`);
    console.log("=".repeat(50) + "\n");
    return { success: true };
  }

  const msg = {
    to: email,
    from: senderEmail,
    subject: `Contact Form Received - ${subject}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Hi ${name},</h2>
        <p>Thank you for contacting us! We've received your message.</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin: 30px 0;">
          <h3>Your Message:</h3>
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>Message:</strong> ${message}</p>
        </div>

        <p>Our team will respond within 24-48 hours.</p>
      </div>
    `,
  };

  try {
    await sgMail.send(msg);
    return { success: true };
  } catch (error) {
    console.error("❌ Email error:", error.response?.body || error.message);
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
      console.log("\n⚠️  SLA WARNING:", seller.email, orderId, notificationType);
      return { success: true };
    }

    const urgencyColor = slaStatus.status === 'BREACHED' ? '#e74c3c' : '#f39c12';

    const msg = {
      to: seller.email,
      from: {
        email: senderEmail,
        name: "Aboriginal Art Marketplace"
      },
      subject: `🚨 ${notificationType} Required - Order #${orderId?.slice(-8)}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: ${urgencyColor}; color: white; padding: 20px; text-align: center;">
            <h1>⚠️ SLA WARNING</h1>
          </div>

          <div style="padding: 20px;">
            <h2>${notificationType.replace('_', ' ')}</h2>
            <p><strong>Order:</strong> #{orderId?.slice(-8)}</p>
            <p><strong>Status:</strong> ${slaStatus.status}</p>
            <p><strong>Time:</strong> ${slaStatus.timeRemaining.toFixed(1)} hours</p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL}/seller/orders/${orderId}" 
               style="background-color: ${urgencyColor}; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px;">
              Take Action Now
            </a>
          </div>
        </div>
      `,
    };

    await sgMail.send(msg);
    return { success: true };
  } catch (error) {
    console.error("❌ SLA email error:", error);
    return { success: false, error: error.message };
  }
};

// Test email configuration
const testEmailConfig = async () => {
  if (!emailConfigured) {
    console.log("⚠️  Email not configured");
    return false;
  }
  
  console.log("✓ SendGrid email service is ready");
  return true;
};

module.exports = { 
  generateOTP, 
  sendOTPEmail, 
  testEmailConfig,
  sendOrderConfirmationEmail,
  sendOrderStatusEmail,
  sendSellerOrderNotificationEmail,
  sendContactFormEmail,
  sendSLAWarningEmail
};

