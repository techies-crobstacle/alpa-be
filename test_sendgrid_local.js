require("dotenv").config();
const { sendAdminNewOrderEmail, sendFinanceOrderEmail } = require("./utils/emailService");

async function test() {
  try {
    const res1 = await sendAdminNewOrderEmail('ritkashyap13@gmail.com', 'Test Admin', {
      displayId: 'TEST999',
      customerName: 'John',
      sellerNames: 'Bob',
      totalAmount: 100.50,
      items: []
    });
    console.log('Admin Email Result:', res1);

    const res2 = await sendFinanceOrderEmail({
      displayId: 'TEST999',
      totalAmount: 100.5,
      products: [{ title: 'Shirt', quantity: 1, price: 10.0 }],
      shippingAddress: '123 Fake St'
    });
    console.log('Finance Email Result:', res2);
  } catch(e) {
    console.error('Error:', e);
  }
}

test();
