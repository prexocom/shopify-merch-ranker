const fs = require("fs");
const path = require("path");
const https = require("https");

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_API_TOKEN;

const outputFile = path.resolve(__dirname, "../merch-rank.json");

async function fetchAllProducts() {
  const products = [];
  let endpoint = `https://${SHOP}/admin/api/2023-04/products.json?limit=250`;
  let pageInfo = null;

  while (endpoint) {
    const res = await fetch(endpoint, {
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      }
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch products: ${res.status}`);
    }

    const data = await res.json();
    products.push(...data.products);

    // Check for pagination
    const linkHeader = res.headers.get("link");
    const nextMatch = linkHeader && linkHeader.match(/<([^>]+)>; rel="next"/);
    endpoint = nextMatch ? nextMatch[1] : null;
  }

  return products;
}

async function generateRankData() {
  const allProducts = await fetchAllProducts();

  // Sample ranking logic: In-stock first, then by created_at
  const sorted = allProducts
    .sort((a, b) => {
      const aOutOfStock = a.variants.every(v => v.inventory_quantity <= 0);
      const bOutOfStock = b.variants.every(v => v.inventory_quantity <= 0);

      if (aOutOfStock !== bOutOfStock) {
        return aOutOfStock ? 1 : -1; // push out-of-stock down
      }

      return new Date(b.created_at) - new Date(a.created_at); // newest first
    })
    .map((p) => ({ handle: p.handle }));

  fs.writeFileSync(outputFile, JSON.stringify(sorted, null, 2));
  console.log(`✅ merch-rank.json generated (${sorted.length} products)`);
}

function fetch(url, options) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: options.method || "GET",
      headers: options.headers || {}
    }, res => {
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => {
        res.json = async () => JSON.parse(data);
        res.ok = res.statusCode >= 200 && res.statusCode < 300;
        res.status = res.statusCode;
        res.headers = new Map(Object.entries(res.headers));
        res.headers.get = key => res.headers.get(key.toLowerCase());
        resolve(res);
      });
    });

    req.on("error", reject);
    req.end();
  });
}

generateRankData().catch(err => {
  console.error("❌ Error generating rank:", err);
  process.exit(1);
});
