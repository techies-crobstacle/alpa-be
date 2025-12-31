
exports.checkInventory = async (productId) => {
  const productRef = db.collection("products").doc(productId);
  const snap = await productRef.get();

  if (!snap.exists) return;
  
  const product = snap.data();
  const { stock, minStock, sellerId } = product;

  // OUT OF STOCK
  if (stock <= 0) {
    await productRef.update({ isActive: false });
    console.log(`Product auto deactivated due to 0 quantity: ${product.title}`);
    // TODO: send alert to seller
    return { type: "outOfStock" };
  }

  // LOW STOCK
  if (stock <= minStock) {
    console.log(`Low stock alert for: ${product.title}`);
    // TODO: send alert to seller
    return { type: "lowStock" };
  }

  return { type: "ok" };
};

