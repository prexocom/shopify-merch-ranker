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

async function generateRankData() {
  const allProducts = await fetchAllProducts();

  // Sort: in-stock first, then newest first
  const sorted = allProducts
    .sort((a, b) => {
      const aOutOfStock = a.variants.every(v => v.inventory_quantity <= 0);
      const bOutOfStock = b.variants.every(v => v.inventory_quantity <= 0);

      if (aOutOfStock !== bOutOfStock) {
        return aOutOfStock ? 1 : -1;
      }

      return new Date(b.created_at) - new Date(a.created_at);
    })
    .map(p => ({
      handle: p.handle,
      in_stock: p.variants.some(v =>
        v.inventory_management == null || v.inventory_quantity > 0
      )
    }));

  fs.writeFileSync(outputFile, JSON.stringify(sorted, null, 2));
  console.log(`✅ merch-rank.json generated (${sorted.length} products)`);
}

generateRankData().catch(err => {
  console.error("❌ Error generating rank:", err);
  process.exit(1);
});
