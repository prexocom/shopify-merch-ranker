const fs = require("fs");
const path = require("path");
const axios = require("axios");

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_API_TOKEN;

const outputFile = path.resolve(__dirname, "../merch-rank.json");

async function fetchAllProducts() {
  const products = [];
  let endpoint = `https://${SHOP}/admin/api/2023-04/products.json?limit=250`;

  while (endpoint) {
    const res = await axios.get(endpoint, {
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json",
      },
      validateStatus: () => true,
    });

    if (!(res.status >= 200 && res.status < 300)) {
      throw new Error(`Failed to fetch products: ${res.status}`);
    }

    products.push(...res.data.products);

    const linkHeader = res.headers["link"];
    if (linkHeader) {
      const nextMatch = linkHeader.match(/<([^>]+)>; rel="next"/);
      endpoint = nextMatch ? nextMatch[1] : null;
    } else {
      endpoint = null;
    }
  }

  return products;
}

async function fetchSalesData(allProducts) {
  const salesByHandle = {};
  const productIdToHandle = {};

  for (const product of allProducts) {
    productIdToHandle[product.id] = product.handle;
  }

  let endpoint = `https://${SHOP}/admin/api/2023-04/orders.json?status=any&limit=250&created_at_min=2024-01-01`;

  while (endpoint) {
    const res = await axios.get(endpoint, {
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json",
      },
    });

    for (const order of res.data.orders) {
      for (const item of order.line_items) {
        const productId = item.product_id;
        if (!productId) continue;

        const handle = productIdToHandle[productId];
        if (!handle) continue;

        if (!salesByHandle[handle]) {
          salesByHandle[handle] = {
            units_sold: 0,
            revenue: 0,
          };
        }

        salesByHandle[handle].units_sold += item.quantity;
        salesByHandle[handle].revenue += parseFloat(item.price) * item.quantity;
      }
    }

    const linkHeader = res.headers["link"];
    if (linkHeader) {
      const nextMatch = linkHeader.match(/<([^>]+)>; rel="next"/);
      endpoint = nextMatch ? nextMatch[1] : null;
    } else {
      endpoint = null;
    }
  }

  return salesByHandle;
}

async function generateRankData() {
  const allProducts = await fetchAllProducts();
  const sales = await fetchSalesData(allProducts);

  const ranked = allProducts.map((p) => {
    const handle = p.handle;
    const sale = sales[handle] || { units_sold: 0, revenue: 0 };
    const inStock = p.variants.some(
      (v) => v.inventory_management == null || v.inventory_quantity > 0
    );

    return {
      handle,
      in_stock: inStock,
      units_sold: sale.units_sold,
      revenue: sale.revenue,
      star: sale.units_sold >= 10, // Optional: you can raise/lower this threshold
    };
  });

  // Sort by revenue DESC, then units_sold DESC, then in-stock first
  ranked.sort((a, b) => {
    if (b.revenue !== a.revenue) return b.revenue - a.revenue;
    if (b.units_sold !== a.units_sold) return b.units_sold - a.units_sold;
    return a.in_stock === b.in_stock ? 0 : a.in_stock ? -1 : 1;
  });

  fs.writeFileSync(outputFile, JSON.stringify(ranked, null, 2));
  console.log(`✅ merch-rank.json generated (${ranked.length} products)`);
}

generateRankData().catch((err) => {
  console.error("❌ Error generating rank:", err);
  process.exit(1);
});
