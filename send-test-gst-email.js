require('dotenv').config();
const prisma = require('./config/prisma');
const { generateGstReportCSV } = require('./utils/csvExport');
const { sendMonthlyGstReportEmail } = require('./utils/emailService');

async function testEmail() {
  try {
    const today = new Date();
    const m = today.getMonth();
    const y = today.getFullYear();
    
    const startDate = new Date(y, m, 1);
    const endDate = new Date(y, m + 1, 0, 23, 59, 59, 999);
    const prevMonthStartDate = new Date(y, m - 1, 1);
    const prevMonthEndDate = new Date(y, m, 0, 23, 59, 59, 999);

    const activeGst = await prisma.gST.findFirst({ where: { isActive: true }, orderBy: { isDefault: 'desc' } });
    const defaultGstRate = activeGst ? parseFloat(activeGst.percentage) : 10.0;

    const currentOrders = await prisma.order.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        paymentStatus: 'PAID',
        overallStatus: { notIn: ['CANCELLED'] }
      },
      include: {
        items: { include: { product: { include: { seller: { include: { sellerProfile: { select: { businessName: true, storeName: true } } } } } } } },
        subOrders: { include: { items: { include: { product: { include: { seller: { include: { sellerProfile: { select: { businessName: true, storeName: true } } } } } } } } } },
        user: { select: { name: true } },
      }
    });

    const prevOrdersRes = await prisma.order.aggregate({
      where: { createdAt: { gte: prevMonthStartDate, lte: prevMonthEndDate }, paymentStatus: 'PAID', overallStatus: { notIn: ['CANCELLED'] } },
      _sum: { totalAmount: true },
      _count: { id: true }
    });

    const prevGross = parseFloat(prevOrdersRes._sum.totalAmount || 0);
    const prevOrdersCount = prevOrdersRes._count.id;
    const prevGst = prevGross - (prevGross / (1 + defaultGstRate / 100));

    let grossTotal = 0;
    const paymentMethods = {};
    const sellersData = {};
    const rateBreakdowns = {
      [defaultGstRate.toFixed(1)]: { rate: defaultGstRate, transactions: 0, netAmount: 0, gstAmount: 0, grossAmount: 0 }
    };
    
    const transactions = [];

    currentOrders.forEach(order => {
      const orderGross = parseFloat(order.totalAmount || 0);
      grossTotal += orderGross;
      
      let itemsGross = 0;
      const allItems = order.subOrders && order.subOrders.length > 0 ? order.subOrders.flatMap(sub => sub.items || []) : order.items || [];
      allItems.forEach(item => { itemsGross += parseFloat(item.price || 0) * item.quantity; });
      
      const orderGst = itemsGross - (itemsGross / (1 + defaultGstRate / 100));
      const orderNet = orderGross - orderGst;

      const rateKey = defaultGstRate.toFixed(1);
      rateBreakdowns[rateKey].transactions += 1;
      rateBreakdowns[rateKey].netAmount += orderNet;
      rateBreakdowns[rateKey].gstAmount += orderGst;
      rateBreakdowns[rateKey].grossAmount += orderGross;

      const pMethod = order.paymentMethod || 'Unknown';
      if (!paymentMethods[pMethod]) paymentMethods[pMethod] = { count: 0, netAmount: 0, gstAmount: 0, grossAmount: 0, fees: 0 };
      paymentMethods[pMethod].count += 1;
      paymentMethods[pMethod].grossAmount += orderGross;
      paymentMethods[pMethod].netAmount += orderNet;
      paymentMethods[pMethod].gstAmount += orderGst;
      
      paymentMethods[pMethod].fees += pMethod.toLowerCase().includes('stripe') || pMethod.toLowerCase().includes('card') 
        ? (orderGross * 0.0175) + 0.30 : (orderGross * 0.02);

      allItems.forEach(item => {
        const sid = item.product.sellerId || 'Unknown';
        if (!sellersData[sid]) {
          const sellerName = item.product.seller?.sellerProfile?.storeName || item.product.seller?.sellerProfile?.businessName || item.product.seller?.name || `Seller ${sid}`;
          sellersData[sid] = { sellerName, orderIds: new Set(), netSales: 0, gstCollected: 0 };
        }
        sellersData[sid].orderIds.add(order.id);
        const itemGross = parseFloat(item.price) * item.quantity;
        const itemNet = itemGross / (1 + defaultGstRate / 100);
        sellersData[sid].netSales += itemNet;
        sellersData[sid].gstCollected += (itemGross - itemNet);
      });

      transactions.push({
        orderId: order.displayId || order.id, date: order.createdAt, customerName: order.user?.name || order.customerName,
        paymentMethod: pMethod, netAmount: orderNet, gstRate: defaultGstRate, gstAmount: orderGst, totalAmount: orderGross,
        status: order.overallStatus, ref: order.stripePaymentIntentId || order.paypalOrderId || 'N/A'
      });
    });

    let gstTotal = 0; let netTotal = 0;
    Object.values(rateBreakdowns).forEach(rate => { gstTotal += rate.gstAmount; netTotal += rate.netAmount; });

    let growthPerc = prevGross > 0 ? ((grossTotal - prevGross) / prevGross) * 100 : (grossTotal > 0 ? 100 : 0);

    const reportData = {
      period: { month: m + 1, year: y, startDate: startDate.toISOString(), endDate: endDate.toISOString() },
      executiveSummary: { totalOrders: currentOrders.length, grossRevenue: grossTotal, netRevenue: netTotal, gstCollected: gstTotal },
      trend: { prevOrders: prevOrdersCount, prevNetRevenue: prevGross - prevGst, prevGstCollected: prevGst, growthPercentage: parseFloat(growthPerc.toFixed(1)) || 0 },
      gstBreakdown: Object.values(rateBreakdowns),
      paymentMethods: Object.entries(paymentMethods).map(([method, stats]) => ({ method, transactions: stats.count, netAmount: stats.netAmount, gstAmount: stats.gstAmount, grossAmount: stats.grossAmount, fees: stats.fees, netReceived: stats.grossAmount - stats.fees })),
      topSellers: Object.values(sellersData).map(s => ({ sellerName: s.sellerName, orders: s.orderIds.size, netSales: s.netSales, gstCollected: s.gstCollected })).sort((a,b) => b.netSales - a.netSales),
      transactions: transactions.slice(0, 1000)
    };

    console.log("Generating CSV...");
    const csvString = generateGstReportCSV(reportData.transactions);
    const csvBase64String = Buffer.from(csvString).toString('base64');
    
    console.log("Sending Email...");
    process.env.NODE_ENV = 'development';
    await sendMonthlyGstReportEmail('ritikkumar1@crobstacle.com', reportData, csvBase64String);
    console.log("🎉 Sample email successfully sent to ritikkumar1@crobstacle.com");
    process.exit(0);

  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
testEmail();