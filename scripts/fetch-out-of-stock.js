const fs = require('fs');
const axios = require('axios');

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_API_TOKEN;
const OUTPUT_FILE = 'merch-rank.json';

async function fetchProductsAndInventory() {
  let allProducts = [];
  let pageInfo = null;

  try {
    do {
      const res = await axios.get(`https://${SHOP}/admin/api/2024-01/products.json`, {
        headers: {
          'X-Shopify-Access-Token': TOKEN
        },
        params: {
          limit: 250,
          page_info: pageInfo
        }
      });

      const linkHeader = res.headers['link'];
      if (linkHeader && linkHeader.includes('rel="next"')) {
        pageInfo = new URLSearchParams(linkHeader.split(';')[0].replace(/[<>]/g, '').split('?')[1]).get('page_info');
      } else {
        pageInfo = null;
      }

      allProducts.push(...res.data.products);
    } while (pageInfo);

    const result = allProducts.map(p => {
      const variant = p.variants[0];
      return {
        handle: p.handle,
        in_stock: variant.inventory_quantity > 0
      };
    });

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
    console.log(`✅ Generated merch-rank.json with ${result.length} products`);
  } catch (err) {
    console.error('❌ Failed to fetch products:', err.response?.data || err.message);
    process.exit(1);
  }
}

fetchProductsAndInventory();
