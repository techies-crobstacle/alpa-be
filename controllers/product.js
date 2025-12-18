const { db, admin } = require("../config/firebase");

// ADD PRODUCT (Seller only)
exports.addProduct = async (request, reply) => {
  const { title, description, price, stock, category, images } = request.body;

  try {
    const sellerId = req.sellerId; // From authenticateSeller middleware

    // Check if seller is approved and active
    const sellerDoc = await db.collection("sellers").doc(sellerId).get();
    
    if (!sellerDoc.exists) {
      return reply.status(404).send({ success: false, message: "Seller account not found" });
    }

    const seller = sellerDoc.data();

    if (seller.status !== "approved" && seller.status !== "active") {
      return reply.status(403).send({ 
        success: false, 
        message: "Your seller account must be approved before adding products. Current status: " + seller.status 
      });
    }

    // Products are pending until seller goes live (status = "active")
    const productStatus = seller.status === "active" ? "active" : "pending";

    const productRef = db.collection("products").doc();
    const productData = {
      id: productRef.id,
      title,
      description,
      price,
      stock,
      category,
      images: images || [],
      sellerId,
      sellerName: seller.storeName || seller.businessName,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: productStatus
    };
    
    await productRef.set(productData);

    // Update seller product count
    const currentCount = seller.productCount || 0;
    await db.collection("sellers").doc(sellerId).update({
      productCount: currentCount + 1,
      minimumProductsUploaded: currentCount + 1 >= 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return reply.status(200).send({ 
      success: true, 
      message: "Product added successfully",
      productId: productRef.id,
      product: {
        id: productRef.id,
        title,
        description,
        price,
        stock,
        category,
        images: images || [],
        status: productStatus
      },
      note: productStatus === "pending" ? "Product will go live when your store is activated by admin" : "Product is live",
      totalProducts: currentCount + 1
    });
  } catch (err) {
    console.error("Add product error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// GET MY PRODUCTS (Seller only)
exports.getMyProducts = async (request, reply) => {
  try {
    const sellerId = req.sellerId; // From authenticateSeller middleware

    const productsSnap = await db.collection("products")
      .where("sellerId", "==", sellerId)
      .get();

    const products = productsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return reply.status(200).send({ 
      success: true, 
      products,
      count: products.length 
    });
  } catch (err) {
    console.error("Get my products error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// GET PRODUCT BY ID (Public)
exports.getProductById = async (request, reply) => {
  try {
    const productRef = db.collection("products").doc(request.params.id);
    const docSnap = await productRef.get();

    if (!docSnap.exists) {
      return reply.status(404).send({ success: false, message: "Product not found" });
    }

    reply.status(200).send({ success: true, product: { id: docSnap.id, ...docSnap.data() } });
  } catch (err) {
    console.error("Get product by ID error:", err);
    reply.status(500).send({ success: false, error: err.message });
  }
};

// UPDATE PRODUCT (Seller only)
exports.updateProduct = async (request, reply) => {
  try {
    const sellerId = req.sellerId; // From authenticateSeller middleware
    const productRef = db.collection("products").doc(request.params.id);
    const docSnap = await productRef.get();

    if (!docSnap.exists) {
      return reply.status(404).send({ success: false, message: "Product not found" });
    }

    const product = docSnap.data();

    // Check if the logged-in seller is the owner
    if (product.sellerId !== sellerId) {
      return reply.status(403).send({ success: false, message: "You are not authorized to update this product" });
    }

    const { title, description, price, stock, category, images } = request.body;

    // Update only the provided fields
    const updatedData = {
      title: title ?? product.title,
      description: description ?? product.description,
      price: price ?? product.price,
      stock: stock ?? product.stock,
      category: category ?? product.category,
      images: images ?? product.images,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await productRef.update(updatedData);

    return reply.status(200).send({ 
      success: true, 
      message: "Product updated successfully", 
      product: { id: request.params.id, ...updatedData }
    });
  } catch (err) {
    console.error("Update product error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// DELETE PRODUCT (Seller only)
exports.deleteProduct = async (request, reply) => {
  try {
    const sellerId = req.sellerId; // From authenticateSeller middleware
    const productRef = db.collection("products").doc(request.params.id);
    const docSnap = await productRef.get();

    if (!docSnap.exists) {
      return reply.status(404).send({ success: false, message: "Product not found" });
    }

    const product = docSnap.data();

    // Check if the logged-in seller is the owner
    if (product.sellerId !== sellerId) {
      return reply.status(403).send({ success: false, message: "You are not authorized to delete this product" });
    }

    await productRef.delete();

    // Update seller product count
    const sellerDoc = await db.collection("sellers").doc(sellerId).get();
    const currentCount = sellerDoc.data().productCount || 0;
    await db.collection("sellers").doc(sellerId).update({
      productCount: Math.max(0, currentCount - 1),
      minimumProductsUploaded: (currentCount - 1) >= 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return reply.status(200).send({ 
      success: true, 
      message: "Product deleted successfully",
      totalProducts: Math.max(0, currentCount - 1)
    });
  } catch (err) {
    console.error("Delete product error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};

// GET ALL PRODUCTS (Public - only active sellers' products)
exports.getAllProducts = async (request, reply) => {
  try {
    const productsSnap = await db.collection("products")
      .where("status", "==", "active")
      .get();
    
    // Filter products to only include those from active (live) sellers
    const productPromises = productsSnap.docs.map(async (doc) => {
      const productData = doc.data();
      const sellerDoc = await db.collection("sellers").doc(productData.sellerId).get();
      
      if (sellerDoc.exists && sellerDoc.data().status === "active") {
        return { id: doc.id, ...productData };
      }
      return null;
    });

    const allProducts = await Promise.all(productPromises);
    const products = allProducts.filter(p => p !== null);

    return reply.status(200).send({ success: true, products, count: products.length });
  } catch (err) {
    console.error("Get all products error:", err);
    return reply.status(500).send({ success: false, error: err.message });
  }
};



