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
//     console.log("âœ… Email service initialized");
//   } else {
//     console.log("âš ï¸  Email credentials not configured. Email notifications will be logged to console.");
//   }
// } catch (error) {
//   console.error("âŒ Email initialization error:", error.message);
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
//     console.log("ðŸ“§ DEVELOPMENT MODE - OTP Email");
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
//     console.log("âœ… Email sent successfully to:", email);
//     return { success: true };
//   } catch (error) {
//     console.error("âŒ Email sending error:", error.message);
    
//     // Return success in development/testing to not block user registration
//     if (process.env.NODE_ENV === 'development') {
//       console.log("âš ï¸ Development mode: Returning success despite email error");
//       console.log("ðŸ“ OTP for testing:", otp);
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
//     console.log("ðŸ“§ DEVELOPMENT MODE - Order Confirmation Email");
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
//     from: `"MIA Marketplace" <${process.env.EMAIL_USER}>`,
//     to: email,
//     subject: `Order Confirmation - Invoice #${orderDetails.orderId}`,
//     html: `
//       <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; background-color: #fff;">
//         <!-- Header -->
//         <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0;">
//           <h1 style="margin: 0; font-size: 28px;">ðŸŽ¨ ORDER CONFIRMED</h1>
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
//           <h3 style="margin: 0 0 10px 0; color: #1976D2;">ðŸ“¦ What's Next?</h3>
//           <p style="margin: 5px 0; color: #555;">âœ“ Your order is being processed</p>
//           <p style="margin: 5px 0; color: #555;">âœ“ We'll email you when it ships with tracking details</p>
//           <p style="margin: 5px 0; color: #555;">âœ“ Track your order anytime using the button below</p>
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
//           <p style="color: #666; font-size: 14px; margin: 5px 0;">Thank you for supporting Aboriginal artists! ðŸŒŸ</p>
//           <p style="color: #999; font-size: 12px; margin: 5px 0;">This is an automated email, please do not reply.</p>
//         </div>
//       </div>
//     `,
//   };

//   try {
//     await transporter.sendMail(mailOptions);
//     console.log(`âœ… Order confirmation email sent to ${email}`);
//     return { success: true, message: "Email sent successfully" };
//   } catch (error) {
//     console.error("âŒ Email sending error:", error.message);
//     return { success: false, error: error.message };
//   }
// };

// // Send Order Status Update Email
// const sendOrderStatusEmail = async (email, customerName, orderDetails) => {
//   // Development mode - just log to console
//   if (isDevelopmentMode || !transporter) {
//     console.log("\n" + "=".repeat(50));
//     console.log("ðŸ“§ DEVELOPMENT MODE - Order Status Update Email");
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
//       statusMessage = "Your order has been packed and is ready for shipping! ðŸ“¦";
//       statusColor = "#FF9800";
//       break;
//     case "shipped":
//       statusMessage = "Great news! Your order has been shipped! ðŸšš";
//       statusColor = "#2196F3";
//       break;
//     case "delivered":
//       statusMessage = "Your order has been delivered! ðŸŽ‰";
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
//     from: `"MIA Marketplace" <${process.env.EMAIL_USER}>`,
//     to: email,
//     subject: `Order Update - #${orderDetails.orderId}`,
//     html: `
//       <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
//         <h2 style="color: #333; border-bottom: 2px solid ${statusColor}; padding-bottom: 10px;">ðŸŽ¨ Order Update</h2>
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

//         <p style="color: #666; font-size: 14px;">Thank you for shopping with us! ðŸŒŸ</p>
        
//         <hr style="margin-top: 30px; border: none; border-top: 1px solid #ddd;">
//         <p style="color: #999; font-size: 12px;">This is an automated email, please do not reply.</p>
//       </div>
//     `,
//   };

//   try {
//     await transporter.sendMail(mailOptions);
//     console.log(`âœ… Order status email sent to ${email}`);
//     return { success: true, message: "Email sent successfully" };
//   } catch (error) {
//     console.error("âŒ Email sending error:", error.message);
//     return { success: false, error: error.message };
//   }
// };

// // Send Seller Order Notification Email
// const sendSellerOrderNotificationEmail = async (email, sellerName, orderDetails) => {
//   // Development mode - just log to console
//   if (isDevelopmentMode || !transporter) {
//     console.log("\n" + "=".repeat(50));
//     console.log("ðŸ“§ DEVELOPMENT MODE - Seller Order Notification Email");
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
//     from: `"MIA Marketplace" <${process.env.EMAIL_USER}>`,
//     to: email,
//     subject: `ðŸŽ‰ New Order #${orderDetails.orderId} - Action Required`,
//     html: `
//       <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; background-color: #fff;">
//         <!-- Header -->
//         <div style="background-color: #FF9800; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0;">
//           <h1 style="margin: 0; font-size: 28px;">ðŸŽ‰ NEW ORDER RECEIVED</h1>
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
//           <h3 style="margin: 0 0 10px 0; color: #D32F2F;">âš ï¸ Action Required</h3>
//           <p style="margin: 5px 0; color: #555;">âœ“ Log in to your seller dashboard</p>
//           <p style="margin: 5px 0; color: #555;">âœ“ Confirm the order and update stock</p>
//           <p style="margin: 5px 0; color: #555;">âœ“ Pack and ship the items within 2-3 business days</p>
//           <p style="margin: 5px 0; color: #555;">âœ“ Update tracking information for customer</p>
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
//           <p style="color: #666; font-size: 14px; margin: 5px 0;">Thank you for being a valued seller! ðŸ’¼</p>
//           <p style="color: #999; font-size: 12px; margin: 5px 0;">This is an automated email, please do not reply.</p>
//         </div>
//       </div>
//     `,
//   };

//   try {
//     await transporter.sendMail(mailOptions);
//     console.log(`âœ… Seller notification email sent to ${email}`);
//     return { success: true, message: "Email sent successfully" };
//   } catch (error) {
//     console.error("âŒ Email sending error:", error.message);
//     return { success: false, error: error.message };
//   }
// };

// // Test email configuration
// const testEmailConfig = async () => {
//   if (!transporter) {
//     console.log("âš ï¸  Email not configured - notifications will be logged to console");
//     return false;
//   }
  
//   try {
//     await transporter.verify();
//     console.log("âœ“ Email service is ready to send emails");
//     return true;
//   } catch (error) {
//     console.error("âœ— Email configuration error:", error.message);
//     console.error("Please check your EMAIL_USER and EMAIL_PASSWORD in .env file");
//     return false;
//   }
// };

// // Send Contact Form Confirmation Email
// const sendContactFormEmail = async (email, name, subject, message) => {
//   // Development mode - just log to console
//   if (isDevelopmentMode || !transporter) {
//     console.log("\n" + "=".repeat(50));
//     console.log("ðŸ“§ DEVELOPMENT MODE - Contact Form Email");
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
//                       <p style="margin: 0; color: #2c3e50; font-weight: bold;">ðŸ“§ What's Next?</p>
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
//       console.log("âš ï¸  SLA WARNING EMAIL - DEVELOPMENT MODE");
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
//       from: `"MIA Marketplace" <${process.env.EMAIL_USER}>`,
//       to: seller.email,
//       subject: `ðŸš¨ ${urgencyText}: ${notificationType.replace('_', ' ')} Required - Order #${orderId?.slice(-8)}`,
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
//                   âš ï¸ SLA ${urgencyText}
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
//                     ðŸ“‹ Order Details
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
//                     â° SLA Status
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
//                     ðŸš€ Take Action Now
//                   </a>
//                 </div>

//                 <div style="background-color: #e8f4fd; padding: 20px; border-radius: 8px; border-left: 4px solid #3498db;">
//                   <h4 style="margin: 0 0 10px 0; color: #2980b9; font-size: 16px;">ðŸ’¡ Next Steps:</h4>
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
//                   MIA Marketplace - Seller Support System
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
  console.log("âœ… SendGrid email service initialized");
  console.log("SendGrid senderEmail:", process.env.SENDER_EMAIL);
  console.log("SendGrid API Key present:", !!process.env.SENDGRID_API_KEY);
} else {
  console.log("âš ï¸  SendGrid API key not configured. Emails will be logged to console.");
}

const isDevelopmentMode = !emailConfigured;
const senderEmail = process.env.SENDER_EMAIL || process.env.EMAIL_USER || 'noreply@yourapp.com';
const senderName = process.env.SENDER_NAME || 'MIA Marketplace';

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
      <html>
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
                  <p style="margin:6px 0 0;color:#8B5C54;font-size:11px;">Â© 2026 MIA Marketplace. All rights reserved.</p>
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
  const trackingUrl = orderDetails.isGuest
    ? `${baseUrl}/guest/track-order?orderId=${orderDetails.orderId}&email=${encodeURIComponent(email)}`
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
      <html>
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
                  <a href="${trackingUrl}" style="display:inline-block;background-color:#5A1E12;color:#ffffff;padding:14px 40px;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.5px;">Track Your Order</a>
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
  const trackingUrl = orderDetails.isGuest
    ? `${baseUrl}/guest/track-order?orderId=${orderDetails.orderId}&email=${encodeURIComponent(email)}`
    : `${baseUrl}/orders/${orderDetails.orderId}`;

  const msg = {
    to: email,
    from: {
      name: senderName,
      email: senderEmail
    },
    subject: `Order Update â€” #${orderDetails.orderId?.slice(-8)}`,
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
                  <a href="${trackingUrl}" style="display:inline-block;background-color:#5A1E12;color:#ffffff;padding:14px 40px;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;">Track Your Order</a>
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
    subject: `ðŸŽ‰ New Order #${orderDetails.orderId}`,
    html: `
      <!DOCTYPE html>
      <html>
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
                  <a href="${process.env.FRONTEND_URL || 'https://apla-fe.vercel.app'}/seller/orders" style="display:inline-block;background-color:#5A1E12;color:#ffffff;padding:14px 40px;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;">View Order in Dashboard</a>
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
      <html>
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
      subject: `ðŸš¨ ${notificationType} Required - Order #${orderId?.slice(-8)}`,
      html: `
        <!DOCTYPE html>
        <html>
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
    subject: "Your Seller Application Has Been Submitted â€” Alpa Art Marketplace",
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
    subject: "Congratulations! Your Seller Account Has Been Approved",
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
  sendContactFormEmail,
  sendSLAWarningEmail,
  sendSellerApplicationSubmittedEmail,
  sendSellerApprovedEmail
};




