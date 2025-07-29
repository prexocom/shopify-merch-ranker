const fs = require("fs");
const path = require("path");
const axios = require("axios");

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_API_TOKEN;

const outputFile = path.resolve(__dirname, "../merch-rank.json");

// CONFIG: You can tweak these weights based on importance
const WEIGHTS = {
  revenue: 0.6,
  units_sold: 0.3,
  in_stock: 0.1, // boost in-stock products
};

async function fetchAllProducts() {
  const products = [];
  let endpoint = `https://${SHOP}/admin/api/2023-04/products.json?limit=250&status=active`;

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

    // Filter out non-visible products just in case
    const filtered = res.data.products.filter((p) => p.published_at);
    products.push(...filtered);

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
  const salesByProductId = {};
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

        if (!salesByProductId[handle]) {
          salesByProductId[handle] = {
            units_sold: 0,
            revenue: 0,
          };
        }

        salesByProductId[handle].units_sold += item.quantity;
        salesByProductId[handle].revenue += parseFloat(item.price) * item.quantity;
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

  return salesByProductId;
}

function normalize(value, max) {
  return max > 0 ? value / max : 0;
}

async function generateRankData() {
  const allProducts = await fetchAllProducts();
  const sales = await fetchSalesData(allProducts);

  // Determine max values to normalize score
  const revenues = Object.values(sales).map((s) => s.revenue);
  const units = Object.values(sales).map((s) => s.units_sold);
  const maxRevenue = Math.max(...revenues, 0);
  const maxUnits = Math.max(...units, 0);

  const ranked = allProducts.map((p) => {
    const handle = p.handle;
    const sale = sales[handle] || { units_sold: 0, revenue: 0 };
    const inStock = p.variants.some(
      (v) => v.inventory_management == null || v.inventory_quantity > 0
    );

    const revenueScore = normalize(sale.revenue, maxRevenue);
    const unitScore = normalize(sale.units_sold, maxUnits);
    const stockScore = inStock ? 1 : 0;

    const totalScore =
      (revenueScore * WEIGHTS.revenue) +
      (unitScore * WEIGHTS.units_sold) +
      (stockScore * WEIGHTS.in_stock);

    return {
      handle,
      in_stock: inStock,
      units_sold: sale.units_sold,
      revenue: sale.revenue,
      score: parseFloat(totalScore.toFixed(4)), // rounded for clarity
    };
  });

  // Sort by score descending
  ranked.sort((a, b) => b.score - a.score);

  fs.writeFileSync(outputFile, JSON.stringify(ranked, null, 2));
  console.log(`✅ merch-rank.json generated with ${ranked.length} products`);
}

generateRankData().catch((err) => {
  console.error("❌ Error generating rank:", err);
  process.exit(1);
});
