// .github/scripts/generate-rank.js

const fs = require('fs');
const path = require('path');
const https = require('https');

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_API_TOKEN;

// Load handles from handles.json
const handlesPath = path.resolve(__dirname, 'handles.json');
const handles = JSON.parse(fs.readFileSync(handlesPath, 'utf8'));

const results = [];

async function fetchProductData(handle) {
  const endpoint = `https://${SHOP}/admin/api/2024-04/products.json?handle=${handle}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      endpoint,
      {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': TOKEN,
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.products?.[0] || null);
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

(async () => {
  for (const handle of handles.map(h => h.handle)) {
    try {
      const product = await fetchProductData(handle);

      const inStock = product?.variants?.some(
        (variant) => variant.inventory_quantity > 0 || variant.inventory_policy === 'continue'
      );

      results.push({ handle, in_stock: !!inStock });
    } catch (err) {
      console.error(`Error fetching: ${handle}`, err);
      results.push({ handle, in_stock: false });
    }
  }

  // Write merch-rank.json
  const outputPath = path.resolve(__dirname, '../../merch-rank.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log('✅ merch-rank.json updated.');
})();
