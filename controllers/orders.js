// const { db } = require("../config/firebase");
// const { checkInventory } = require("../utils/checkInventory");




// // Stock Management and Inventory Alert
// exports.createOrder = async (req, res) => {
//   try {
//     const userId = req.user.uid;
//     const { shippingAddress, paymentMethod } = req.body;

//     if (!shippingAddress || !paymentMethod) {
//       return res.status(400).json({ success: false, message: "All fields are required" });
//     }

//     // Get user's cart
//     const cartRef = db.collection("carts").doc(userId);
//     const cartSnap = await cartRef.get();

//     if (!cartSnap.exists || !cartSnap.data().products || cartSnap.data().products.length === 0) {
//       return res.status(400).json({ success: false, message: "Cart is empty" });
//     }

//     const cartProducts = cartSnap.data().products;
//     let orderProducts = [];
//     let totalAmount = 0;

//     // Stock validation + price calculation
//     for (const item of cartProducts) {
//       const productRef = db.collection("products").doc(item.productId);
//       const productSnap = await productRef.get();

//       if (!productSnap.exists) {
//         return res.status(404).json({ success: false, message: `Product not found: ${item.productId}` });
//       }

//       const product = productSnap.data();

//       // Check stock
//       if (product.stock < item.quantity) {
//         return res.status(400).json({
//           success: false,
//           message: `Insufficient stock for product: ${product.title}`
//         });
//       }

//       // Prepare order items
//       orderProducts.push({
//         productId: item.productId,
//         quantity: item.quantity,
//         price: product.price,
//         sellerId: product.sellerId,
//         title: product.title
//       });

//       totalAmount += product.price * item.quantity;
//     }

//     // Deduct stock after validation success
//     for (const item of cartProducts) {
//       const productRef = db.collection("products").doc(item.productId);
//       const productSnap = await productRef.get();
//       const product = productSnap.data();

//       const newStock = product.stock - item.quantity;

//       await productRef.update({
//         stock: newStock,
//         active: newStock > 0 ? true : false,
//         updatedAt: new Date()
//       });
//     }

//     // Create order document
//     const orderRef = db.collection("orders").doc();
//     await orderRef.set({
//       id: orderRef.id,
//       userId,
//       products: orderProducts,
//       totalAmount,
//       shippingAddress,
//       paymentMethod,
//       status: "pending",
//       createdAt: new Date()
//     });

//     // Clear cart after order
//     await cartRef.delete();

//     return res.status(200).json({
//       success: true,
//       message: "Order placed successfully",
//       orderId: orderRef.id,
//       totalAmount
//     });

//   } catch (error) {
//     return res.status(500).json({ success: false, message: error.message });
//   }
// };


// // USER — VIEW MY ORDERS
// exports.getMyOrders = async (req, res) => {
//   try {
//     const userId = req.user.uid;
//     const snapshot = await db.collection("orders").where("userId", "==", userId).get();
//     const orders = snapshot.docs.map((doc) => doc.data());

//     return res.status(200).json({ success: true, orders });
//   } catch (error) {
//     return res.status(500).json({ success: false, message: error.message });
//   }
// };

// // USER — CANCEL ORDER
// exports.cancelOrder = async (req, res) => {
//   try {
//     const orderId = req.params.id;
//     const userId = req.user.uid;

//     const orderRef = db.collection("orders").doc(orderId);
//     const snap = await orderRef.get();

//     if (!snap.exists) return res.status(404).json({ success: false, message: "Order not found" });

//     const order = snap.data();
//     if (order.userId !== userId) return res.status(403).json({ success: false, message: "Not authorized" });

//     if (order.status !== "pending") {
//       return res.status(400).json({ success: false, message: "Order cannot be cancelled" });
//     }

//     await orderRef.update({ status: "cancelled" });

//     return res.status(200).json({ success: true, message: "Order cancelled successfully" });

//   } catch (error) {
//     return res.status(500).json({ success: false, message: error.message });
//   }
// };

// // SELLER — VIEW ORDERS
// exports.getSellerOrders = async (req, res) => {
//   try {
//     const sellerId = req.user.uid;
//     const snapshot = await db.collection("orders").get();

//     let sellerOrders = [];

//     snapshot.forEach((doc) => {
//       const order = doc.data();
//       const containsSellerItem = order.products.some(
//         (p) => p.sellerId === sellerId
//       );
//       if (containsSellerItem) sellerOrders.push(order);
//     });

//     return res.status(200).json({ success: true, orders: sellerOrders });
//   } catch (error) {
//     return res.status(500).json({ success: false, message: error.message });
//   }
// };

// // SELLER — UPDATE ORDER STATUS
// exports.updateOrderStatus = async (req, res) => {
//   try {
//     const sellerId = req.user.uid;
//     const { orderId } = req.params;
//     const { status } = req.body;

//     const allowed = ["pending", "packed", "shipped", "delivered", "cancelled"];
//     if (!allowed.includes(status)) {
//       return res.status(400).json({ success: false, message: "Invalid status" });
//     }

//     const orderRef = db.collection("orders").doc(orderId);
//     const snap = await orderRef.get();

//     if (!snap.exists) return res.status(404).json({ success: false, message: "Order not found" });

//     const order = snap.data();
//     const containsSellerItem = order.products.some((p) => p.sellerId === sellerId);

//     if (!containsSellerItem) {
//       return res.status(403).json({ success: false, message: "Unauthorized seller" });
//     }

//     await orderRef.update({ status, updatedAt: new Date() });

//     return res.status(200).json({ success: true, message: "Status updated successfully" });

//   } catch (error) {
//     return res.status(500).json({ success: false, message: error.message });
//   }
// };

// // SELLER — UPDATE TRACKING INFO
// exports.updateTrackingInfo = async (req, res) => {
//   try {
//     const sellerId = req.user.uid;
//     const { orderId } = req.params;
//     const { trackingNumber, estimatedDelivery } = req.body;

//     const orderRef = db.collection("orders").doc(orderId);
//     const snap = await orderRef.get();

//     if (!snap.exists) return res.status(404).json({ success: false, message: "Order not found" });

//     const order = snap.data();
//     const containsSellerItem = order.products.some((p) => p.sellerId === sellerId);

//     if (!containsSellerItem) {
//       return res.status(403).json({ success: false, message: "Unauthorized seller" });
//     }

//     await orderRef.update({
//       trackingNumber,
//       estimatedDelivery,
//       updatedAt: new Date(),
//     });

//     return res.status(200).json({ success: true, message: "Tracking info updated" });

//   } catch (error) {
//     return res.status(500).json({ success: false, message: error.message });
//   }
// };


// exports.bulkUpdateStock = async (req, res) => {
//   try {
//     const sellerId = req.user.uid;
//     const updates = req.body;

//     if (!Array.isArray(updates) || updates.length === 0) {
//       return res.status(400).json({ success: false, message: "Updates array is required" });
//     }

//     let results = [];

//     for (const item of updates) {
//       const { productId, stock } = item;

//       if (!productId || stock === undefined) {
//         results.push({ productId, success: false, message: "productId and stock are required" });
//         continue;
//       }

//       const productRef = db.collection("products").doc(productId);
//       const productSnap = await productRef.get();

//       if (!productSnap.exists) {
//         results.push({ productId, success: false, message: "Product not found" });
//         continue;
//       }

//       const product = productSnap.data();

//       // Check seller ownership
//       if (product.sellerId !== sellerId) {
//         results.push({ productId, success: false, message: "Unauthorized seller" });
//         continue;
//       }

//       const newStock = Number(stock);
//       const isActive = newStock > 0;

//       await productRef.update({
//         stock: newStock,
//         active: isActive,
//         updatedAt: new Date()
//       });

//       results.push({
//         productId,
//         success: true,
//         stock: newStock,
//         active: isActive,
//         message: "Stock updated successfully"
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       message: "Bulk stock update completed",
//       results
//     });

//   } catch (error) {
//     return res.status(500).json({ success: false, message: error.message });
//   }
// };


const { db } = require("../config/firebase");
const { checkInventory } = require("../utils/checkInventory");
const { 
  sendOrderConfirmationEmail, 
  sendOrderStatusEmail,
  sendSellerOrderNotificationEmail 
} = require("../utils/emailService");

// Stock Management and Inventory Alert with SMS Notification
exports.createOrder = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { shippingAddress, paymentMethod } = req.body;

    if (!shippingAddress || !paymentMethod) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    // Get user details for SMS
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const user = userDoc.data();

    // Get user's cart
    const cartRef = db.collection("carts").doc(userId);
    const cartSnap = await cartRef.get();

    if (!cartSnap.exists || !cartSnap.data().products || cartSnap.data().products.length === 0) {
      return res.status(400).json({ success: false, message: "Cart is empty" });
    }

    const cartProducts = cartSnap.data().products;
    let orderProducts = [];
    let totalAmount = 0;
    let sellerNotifications = new Map(); // Track sellers to notify

    // Stock validation + price calculation
    for (const item of cartProducts) {
      const productRef = db.collection("products").doc(item.productId);
      const productSnap = await productRef.get();

      if (!productSnap.exists) {
        return res.status(404).json({ success: false, message: `Product not found: ${item.productId}` });
      }

      const product = productSnap.data();

      // Check stock
      if (product.stock < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for product: ${product.title}`
        });
      }

      // Prepare order items
      orderProducts.push({
        productId: item.productId,
        quantity: item.quantity,
        price: product.price,
        sellerId: product.sellerId,
        title: product.title
      });

      totalAmount += product.price * item.quantity;

      // Track seller products for notification
      if (!sellerNotifications.has(product.sellerId)) {
        sellerNotifications.set(product.sellerId, {
          productCount: 0,
          totalAmount: 0
        });
      }
      const sellerData = sellerNotifications.get(product.sellerId);
      sellerData.productCount += item.quantity;
      sellerData.totalAmount += product.price * item.quantity;
    }

    // Deduct stock after validation success
    for (const item of cartProducts) {
      const productRef = db.collection("products").doc(item.productId);
      const productSnap = await productRef.get();
      const product = productSnap.data();

      const newStock = product.stock - item.quantity;

      await productRef.update({
        stock: newStock,
        active: newStock > 0 ? true : false,
        updatedAt: new Date()
      });
    }

    // Create order document
    const orderRef = db.collection("orders").doc();
    await orderRef.set({
      id: orderRef.id,
      userId,
      products: orderProducts,
      totalAmount,
      shippingAddress,
      paymentMethod,
      status: "pending",
      createdAt: new Date()
    });

    console.log(`✅ Order created: ${orderRef.id}`);

    // Clear cart after order
    await cartRef.delete();

    // Send email to customer (don't wait for it - non-blocking)
    const userEmail = user.email;
    const userName = user.name || user.displayName || 'Customer';
    const userPhone = user.phone || user.mobile || shippingAddress.phone;
    
    if (userEmail) {
      console.log(`📧 Sending order confirmation email to customer: ${userEmail}`);
      sendOrderConfirmationEmail(userEmail, userName, {
        orderId: orderRef.id,
        totalAmount,
        itemCount: orderProducts.length,
        products: orderProducts,
        shippingAddress,
        paymentMethod,
        customerPhone: userPhone
      }).catch(error => {
        console.error("Email error (non-blocking):", error.message);
      });
    } else {
      console.log("⚠️  User has no email. Customer notification skipped.");
    }

    // Send email to each seller (don't wait for it - non-blocking)
    for (const [sellerId, sellerData] of sellerNotifications) {
      try {
        const sellerDoc = await db.collection("sellers").doc(sellerId).get();
        if (sellerDoc.exists && sellerDoc.data().email) {
          const sellerEmail = sellerDoc.data().email;
          const sellerName = sellerDoc.data().storeName || sellerDoc.data().businessName || 'Seller';
          console.log(`📧 Sending order notification email to seller: ${sellerEmail}`);
          
          // Filter products for this specific seller
          const sellerProducts = orderProducts.filter(p => p.sellerId === sellerId);
          
          sendSellerOrderNotificationEmail(sellerEmail, sellerName, {
            orderId: orderRef.id,
            productCount: sellerData.productCount,
            totalAmount: sellerData.totalAmount,
            products: sellerProducts,
            shippingAddress,
            paymentMethod,
            customerName: userName,
            customerEmail: userEmail,
            customerPhone: userPhone
          }).catch(error => {
            console.error("Seller email error (non-blocking):", error.message);
          });
        }
      } catch (error) {
        console.error(`Error notifying seller ${sellerId}:`, error.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Order placed successfully! Confirmation email sent.",
      orderId: orderRef.id,
      totalAmount
    });

  } catch (error) {
    console.error("Create order error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// USER — VIEW MY ORDERS
exports.getMyOrders = async (req, res) => {
  try {
    const userId = req.user.uid;
    const snapshot = await db.collection("orders").where("userId", "==", userId).get();
    const orders = snapshot.docs.map((doc) => doc.data());

    return res.status(200).json({ success: true, orders });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// USER — CANCEL ORDER (with SMS notification)
exports.cancelOrder = async (req, res) => {
  try {
    const orderId = req.params.id;
    const userId = req.user.uid;

    const orderRef = db.collection("orders").doc(orderId);
    const snap = await orderRef.get();

    if (!snap.exists) return res.status(404).json({ success: false, message: "Order not found" });

    const order = snap.data();
    if (order.userId !== userId) return res.status(403).json({ success: false, message: "Not authorized" });

    if (order.status !== "pending") {
      return res.status(400).json({ success: false, message: "Order cannot be cancelled" });
    }

    await orderRef.update({ status: "cancelled" });

    // Send email notification about cancellation
    const userDoc = await db.collection("users").doc(userId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      const userEmail = userData.email;
      const userName = userData.name || userData.displayName || 'Customer';
      if (userEmail) {
        console.log(`📧 Sending cancellation email to customer: ${userEmail}`);
        sendOrderStatusEmail(userEmail, userName, {
          orderId,
          status: "cancelled"
        }).catch(error => {
          console.error("Email error (non-blocking):", error.message);
        });
      }
    }

    return res.status(200).json({ success: true, message: "Order cancelled successfully. Email notification sent." });

  } catch (error) {
    console.error("Cancel order error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};