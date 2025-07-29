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
        "Content-Type": "application/json"
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

async function fetchAllOrders() {
  const orders = [];
  let endpoint = `https://${SHOP}/admin/api/2023-04/orders.json?status=any&limit=250&fields=created_at,line_items,financial_status`;

  while (endpoint) {
    const res = await axios.get(endpoint, {
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      },
      validateStatus: () => true,
    });

    if (!(res.status >= 200 && res.status < 300)) {
      throw new Error(`Failed to fetch orders: ${res.status}`);
    }

    orders.push(...res.data.orders);

    const linkHeader = res.headers["link"];
    if (linkHeader) {
      const nextMatch = linkHeader.match(/<([^>]+)>; rel="next"/);
      endpoint = nextMatch ? nextMatch[1] : null;
    } else {
      endpoint = null;
    }
  }

  return orders;
}

async function generateRankData() {
  const [products, orders] = await Promise.all([fetchAllProducts(), fetchAllOrders()]);

  const salesByHandle = {};
  for (const order of orders) {
    if (["voided", "refunded"].includes(order.financial_status)) continue;

    for (const item of order.line_items) {
      const handle = item.product_exists ? item.handle : null;
      if (!handle) continue;

      if (!salesByHandle[handle]) {
        salesByHandle[handle] = {
          units_sold: 0,
          total_revenue: 0,
        };
      }

      salesByHandle[handle].units_sold += item.quantity;
      salesByHandle[handle].total_revenue += parseFloat(item.price) * item.quantity;
    }
  }

  const ranked = products.map(product => {
    const handle = product.handle;
    const variants = product.variants || [];

    const in_stock = variants.some(v => v.inventory_management == null || v.inventory_quantity > 0);

    const sales = salesByHandle[handle] || { units_sold: 0, total_revenue: 0 };

    const score =
      (in_stock ? 50 : 0) +         // Boost for in-stock products
      sales.total_revenue * 0.01 +  // Weighted revenue
      sales.units_sold * 100;       // High weight for popularity

    return {
      handle,
      in_stock,
      units_sold: sales.units_sold,
      total_revenue: sales.total_revenue,
      score,
    };
  });

  ranked.sort((a, b) => b.score - a.score);

  fs.writeFileSync(outputFile, JSON.stringify(ranked, null, 2));
  console.log(`✅ merch-rank.json generated (${ranked.length} products)`);
}

generateRankData().catch(err => {
  console.error("❌ Error generating rank:", err);
  process.exit(1);
});
