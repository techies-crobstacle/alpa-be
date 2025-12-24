// const { db } = require("../config/firebase");
// const { checkInventory } = require("../utils/checkInventory");




// // Stock Management and Inventory Alert
// exports.createOrder = async (request, reply) => {
//   try {
//     const userId = request.user.uid;
//     const { shippingAddress, paymentMethod } = request.body;

//     if (!shippingAddress || !paymentMethod) {
//       return reply.status(400).send({ success: false, message: "All fields are required" });
//     }

//     // Get user's cart
//     const cartRef = db.collection("carts").doc(userId);
//     const cartSnap = await cartRef.get();

//     if (!cartSnap.exists || !cartSnap.data().products || cartSnap.data().products.length === 0) {
//       return reply.status(400).send({ success: false, message: "Cart is empty" });
//     }

//     const cartProducts = cartSnap.data().products;
//     let orderProducts = [];
//     let totalAmount = 0;

//     // Stock validation + price calculation
//     for (const item of cartProducts) {
//       const productRef = db.collection("products").doc(item.productId);
//       const productSnap = await productRef.get();

//       if (!productSnap.exists) {
//         return reply.status(404).send({ success: false, message: `Product not found: ${item.productId}` });
//       }

//       const product = productSnap.data();

//       // Check stock
//       if (product.stock < item.quantity) {
//         return reply.status(400).send({
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

//     return reply.status(200).send({
//       success: true,
//       message: "Order placed successfully",
//       orderId: orderRef.id,
//       totalAmount
//     });

//   } catch (error) {
//     return reply.status(500).send({ success: false, message: error.message });
//   }
// };


// // USER — VIEW MY ORDERS
// exports.getMyOrders = async (request, reply) => {
//   try {
//     const userId = request.user.uid;
//     const snapshot = await db.collection("orders").where("userId", "==", userId).get();
//     const orders = snapshot.docs.map((doc) => doc.data());

//     return reply.status(200).send({ success: true, orders });
//   } catch (error) {
//     return reply.status(500).send({ success: false, message: error.message });
//   }
// };

// // USER — CANCEL ORDER
// exports.cancelOrder = async (request, reply) => {
//   try {
//     const orderId = request.params.id;
//     const userId = request.user.uid;

//     const orderRef = db.collection("orders").doc(orderId);
//     const snap = await orderRef.get();

//     if (!snap.exists) return reply.status(404).send({ success: false, message: "Order not found" });

//     const order = snap.data();
//     if (order.userId !== userId) return reply.status(403).send({ success: false, message: "Not authorized" });

//     if (order.status !== "pending") {
//       return reply.status(400).send({ success: false, message: "Order cannot be cancelled" });
//     }

//     await orderRef.update({ status: "cancelled" });

//     return reply.status(200).send({ success: true, message: "Order cancelled successfully" });

//   } catch (error) {
//     return reply.status(500).send({ success: false, message: error.message });
//   }
// };

// // SELLER — VIEW ORDERS
// exports.getSellerOrders = async (request, reply) => {
//   try {
//     const sellerId = request.user.uid;
//     const snapshot = await db.collection("orders").get();

//     let sellerOrders = [];

//     snapshot.forEach((doc) => {
//       const order = doc.data();
//       const containsSellerItem = order.products.some(
//         (p) => p.sellerId === sellerId
//       );
//       if (containsSellerItem) sellerOrders.push(order);
//     });

//     return reply.status(200).send({ success: true, orders: sellerOrders });
//   } catch (error) {
//     return reply.status(500).send({ success: false, message: error.message });
//   }
// };

// // SELLER — UPDATE ORDER STATUS
// exports.updateOrderStatus = async (request, reply) => {
//   try {
//     const sellerId = request.user.uid;
//     const { orderId } = request.params;
//     const { status } = request.body;

//     const allowed = ["pending", "packed", "shipped", "delivered", "cancelled"];
//     if (!allowed.includes(status)) {
//       return reply.status(400).send({ success: false, message: "Invalid status" });
//     }

//     const orderRef = db.collection("orders").doc(orderId);
//     const snap = await orderRef.get();

//     if (!snap.exists) return reply.status(404).send({ success: false, message: "Order not found" });

//     const order = snap.data();
//     const containsSellerItem = order.products.some((p) => p.sellerId === sellerId);

//     if (!containsSellerItem) {
//       return reply.status(403).send({ success: false, message: "Unauthorized seller" });
//     }

//     await orderRef.update({ status, updatedAt: new Date() });

//     return reply.status(200).send({ success: true, message: "Status updated successfully" });

//   } catch (error) {
//     return reply.status(500).send({ success: false, message: error.message });
//   }
// };

// // SELLER — UPDATE TRACKING INFO
// exports.updateTrackingInfo = async (request, reply) => {
//   try {
//     const sellerId = request.user.uid;
//     const { orderId } = request.params;
//     const { trackingNumber, estimatedDelivery } = request.body;

//     const orderRef = db.collection("orders").doc(orderId);
//     const snap = await orderRef.get();

//     if (!snap.exists) return reply.status(404).send({ success: false, message: "Order not found" });

//     const order = snap.data();
//     const containsSellerItem = order.products.some((p) => p.sellerId === sellerId);

//     if (!containsSellerItem) {
//       return reply.status(403).send({ success: false, message: "Unauthorized seller" });
//     }

//     await orderRef.update({
//       trackingNumber,
//       estimatedDelivery,
//       updatedAt: new Date(),
//     });

//     return reply.status(200).send({ success: true, message: "Tracking info updated" });

//   } catch (error) {
//     return reply.status(500).send({ success: false, message: error.message });
//   }
// };


// exports.bulkUpdateStock = async (request, reply) => {
//   try {
//     const sellerId = request.user.uid;
//     const updates = request.body;

//     if (!Array.isArray(updates) || updates.length === 0) {
//       return reply.status(400).send({ success: false, message: "Updates array is required" });
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

//     return reply.status(200).send({
//       success: true,
//       message: "Bulk stock update completed",
//       results
//     });

//   } catch (error) {
//     return reply.status(500).send({ success: false, message: error.message });
//   }
// };


const prisma = require("../config/prisma");
const { checkInventory } = require("../utils/checkInventory");
const { 
  sendOrderConfirmationEmail, 
  sendOrderStatusEmail,
  sendSellerOrderNotificationEmail 
} = require("../utils/emailService");

// Stock Management and Inventory Alert with SMS Notification
exports.createOrder = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { shippingAddress, paymentMethod } = request.body;

    if (!shippingAddress || !paymentMethod) {
      return reply.status(400).send({ success: false, message: "All fields are required" });
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

    let totalAmount = 0;
    let sellerNotifications = new Map();
    const orderItems = [];

    // Stock validation + price calculation
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
      totalAmount += itemTotal;

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
          products: []
        });
      }
      const sellerData = sellerNotifications.get(product.sellerId);
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
      // Deduct stock
      for (const item of cart.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: { decrement: item.quantity }
          }
        });
      }

      // Create order with items
      const newOrder = await tx.order.create({
        data: {
          userId,
          totalAmount,
          shippingAddress,
          paymentMethod,
          status: "PENDING",
          customerName: user.name,
          customerEmail: user.email,
          customerPhone: user.phone || '',
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

      // Clear cart
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id }
      });

      return newOrder;
    });

    console.log(`✅ Order created: ${order.id}`);

    // Send email to customer (non-blocking)
    if (user.email) {
      console.log(`📧 Sending order confirmation email to customer: ${user.email}`);
      sendOrderConfirmationEmail(user.email, user.name, {
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
        customerPhone: user.phone
      }).catch(error => {
        console.error("Email error (non-blocking):", error.message);
      });
    }

    // Send email to each seller (non-blocking)
    for (const [sellerId, sellerData] of sellerNotifications) {
      try {
        const seller = await prisma.user.findUnique({
          where: { id: sellerId },
          include: { sellerProfile: true }
        });

        if (seller && seller.email && seller.sellerProfile) {
          const sellerName = seller.sellerProfile.storeName || seller.sellerProfile.businessName || 'Seller';
          console.log(`📧 Sending order notification email to seller: ${seller.email}`);
          
          sendSellerOrderNotificationEmail(seller.email, sellerName, {
            orderId: order.id,
            productCount: sellerData.productCount,
            totalAmount: sellerData.totalAmount,
            products: sellerData.products,
            shippingAddress,
            paymentMethod,
            customerName: user.name,
            customerEmail: user.email,
            customerPhone: user.phone
          }).catch(error => {
            console.error("Seller email error (non-blocking):", error.message);
          });
        }
      } catch (error) {
        console.error(`Error notifying seller ${sellerId}:`, error.message);
      }
    }

    return reply.status(200).send({
      success: true,
      message: "Order placed successfully! Confirmation email sent.",
      orderId: order.id,
      totalAmount
    });

  } catch (error) {
    console.error("Create order error:", error);
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
                price: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return reply.status(200).send({ success: true, orders });
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

    const order = await prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!order) return reply.status(404).send({ success: false, message: "Order not found" });

    if (order.userId !== userId) return reply.status(403).send({ success: false, message: "Not authorized" });

    if (order.status !== "PENDING") {
      return reply.status(400).send({ success: false, message: "Order cannot be cancelled" });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED" }
    });

    // Send email notification about cancellation
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (user && user.email) {
      console.log(`📧 Sending cancellation email to customer: ${user.email}`);
      sendOrderStatusEmail(user.email, user.name, {
        orderId,
        status: "cancelled"
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


