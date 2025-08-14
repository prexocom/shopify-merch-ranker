const fs = require("fs");
const path = require("path");
const axios = require("axios");

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_API_TOKEN;

// Output separate JSON files for each tag category
const outputDir = path.resolve(__dirname, "../tag-rankings");

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

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

async function generateTagBasedRankings() {
  const allProducts = await fetchAllProducts();
  const sales = await fetchSalesData(allProducts);

  // Group products by tags
  const productsByTag = {};
  
  allProducts.forEach(product => {
    const handle = product.handle;
    const sale = sales[handle] || { units_sold: 0, revenue: 0 };
    
    const productData = {
      handle,
      title: product.title,
      units_sold: sale.units_sold,
      revenue: sale.revenue,
      tags: product.tags.split(', ').map(tag => tag.trim())
    };

    // Add product to each tag category
    product.tags.split(', ').forEach(tag => {
      const cleanTag = tag.trim();
      if (!productsByTag[cleanTag]) {
        productsByTag[cleanTag] = [];
      }
      productsByTag[cleanTag].push(productData);
    });
  });

  // Generate rankings for each tag
  const tagRankings = {};
  
  Object.keys(productsByTag).forEach(tag => {
    const tagProducts = productsByTag[tag];
    
    // Sort by units sold (you can change this to revenue if preferred)
    tagProducts.sort((a, b) => b.units_sold - a.units_sold);
    
    // Add ranking position to each product
    const rankedProducts = tagProducts.map((product, index) => ({
      ...product,
      rank: index + 1
    }));
    
    tagRankings[tag] = rankedProducts;
    
    // Save individual JSON file for each tag
    const tagFileName = tag.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-rankings.json';
    const tagFilePath = path.join(outputDir, tagFileName);
    
    fs.writeFileSync(tagFilePath, JSON.stringify(rankedProducts, null, 2));
    console.log(`✅ ${tagFileName} generated with ${rankedProducts.length} products`);
  });

  // Also save a master file with all tag rankings
  const masterFilePath = path.join(outputDir, 'all-tag-rankings.json');
  fs.writeFileSync(masterFilePath, JSON.stringify(tagRankings, null, 2));
  
  console.log(`✅ Master file generated with ${Object.keys(tagRankings).length} tag categories`);
  
  return tagRankings;
}

generateTagBasedRankings().catch((err) => {
  console.error("❌ Error generating tag-based rankings:", err);
  process.exit(1);
});
