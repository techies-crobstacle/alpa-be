const PDFDocument = require('pdfkit');

/**
 * Generates an invoice PDF buffer for any order.
 * Works for both logged-in user orders and guest orders.
 *
 * @param {Object} order
 * @param {string} order.displayId
 * @param {Date}   order.createdAt
 * @param {string} order.status
 * @param {string} order.customerName
 * @param {string} order.customerEmail
 * @param {string} [order.customerPhone]
 * @param {string} [order.shippingPhone]
 * @param {string} [order.shippingAddressLine]
 * @param {string} [order.shippingCity]
 * @param {string} [order.shippingState]
 * @param {string} [order.shippingZipCode]
 * @param {string} [order.shippingCountry]
 * @param {number} order.totalAmount
 * @param {number} [order.discountAmount]
 * @param {string} [order.couponCode]
 * @param {string} [order.paymentMethod]
 * @param {Array}  order.items  — each item: { price, quantity, product: { title } }
 * @returns {Promise<Buffer>}
 */
const generateInvoiceBuffer = (order) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Header ──────────────────────────────────────────────────────────────
    doc.fontSize(20).text('Made in Arnhem Land', 50, 50)
       .fontSize(10).text('Your Cultural Marketplace', 50, 75).moveDown();

    // ── Invoice meta ────────────────────────────────────────────────────────
    doc.fontSize(16).text('INVOICE', 50, 120)
       .fontSize(12)
       .text(`Invoice #: ${order.displayId || order.id}`, 50, 145)
       .text(`Date: ${new Date(order.createdAt).toLocaleDateString('en-AU')}`, 50, 160)
       .text(`Status: ${order.status}`, 50, 175);

    // ── Bill To ─────────────────────────────────────────────────────────────
    doc.fontSize(14).text('Bill To:', 50, 210)
       .fontSize(12)
       .text(order.customerName || '', 50, 230)
       .text(order.customerEmail || '', 50, 245)
       .text(order.shippingPhone || order.customerPhone || '', 50, 260);

    // ── Ship To ─────────────────────────────────────────────────────────────
    doc.fontSize(14).text('Ship To:', 300, 210).fontSize(12);
    if (order.shippingAddressLine || order.shippingCity) {
      doc.text(order.shippingAddressLine || '', 300, 230)
         .text(`${order.shippingCity || ''}, ${order.shippingState || ''}`, 300, 245)
         .text(order.shippingZipCode || '', 300, 260)
         .text(order.shippingCountry || '', 300, 275);
    }

    // ── Items table ──────────────────────────────────────────────────────────
    const tableTop = 320;
    doc.fontSize(12)
       .text('Item',       50,  tableTop)
       .text('Quantity',  250, tableTop)
       .text('Unit Price',350, tableTop)
       .text('Total',     450, tableTop);
    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

    let yPos = tableTop + 30;
    let subtotal = 0;
    (order.items || []).forEach(item => {
      const lineTotal = Number(item.price) * item.quantity;
      subtotal += lineTotal;
      doc.text(item.product?.title || 'Product', 50, yPos)
         .text(String(item.quantity),             250, yPos)
         .text(`$${Number(item.price).toFixed(2)}`,350, yPos)
         .text(`$${lineTotal.toFixed(2)}`,          450, yPos);
      yPos += 20;
    });

    yPos += 10;
    doc.moveTo(50, yPos).lineTo(550, yPos).stroke();
    yPos += 15;

    // ── Coupon / discount ────────────────────────────────────────────────────
    if (order.discountAmount && parseFloat(order.discountAmount) > 0) {
      doc.fontSize(12)
         .text(`Coupon (${order.couponCode || ''}) Discount:`, 300, yPos)
         .text(`-$${parseFloat(order.discountAmount).toFixed(2)}`, 450, yPos);
      yPos += 20;
    }

    // ── Totals ───────────────────────────────────────────────────────────────
    doc.fontSize(12)
       .text('Subtotal:',     350, yPos)
       .text(`$${subtotal.toFixed(2)}`, 450, yPos);
    yPos += 20;
    doc.fontSize(14)
       .text('Total Amount:', 350, yPos)
       .text(`$${Number(order.totalAmount).toFixed(2)}`, 450, yPos);

    yPos += 40;
    doc.fontSize(12).text(`Payment Method: ${order.paymentMethod || 'N/A'}`, 50, yPos);

    // ── Footer ───────────────────────────────────────────────────────────────
    yPos += 60;
    doc.fontSize(10)
       .text('Thank you for your business!', 50, yPos)
       .text('For questions about this invoice, contact support@miamarketplace.com.au', 50, yPos + 15);

    doc.end();
  });
};

module.exports = { generateInvoiceBuffer };
