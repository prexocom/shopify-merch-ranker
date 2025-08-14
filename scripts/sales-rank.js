const fs = require("fs");
const path = require("path");
const axios = require("axios");

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_API_TOKEN;

// Output directory for JSON files
const outputDir = path.resolve(__dirname, "../tag-rankings");

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function fetchAllProducts() {
  const products = [];
  let endpoint = `https://${SHOP}/admin/api/2023-04/products.json?limit=250&status=active&fields=id,title,handle,images,variants,tags,product_type,vendor,created_at,published_at,status`;

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

    // Filter out non-visible products
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

  let endpoint = `https://${SHOP}/admin/api/2023-04/orders.json?status=any&limit=250&created_at_min=2024-01-01&fields=line_items`;

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

async function fetchProductRatings(allProducts) {
  const ratingsByHandle = {};
  const productHandles = allProducts.map(p => p.handle);
  
  // This assumes you have a product reviews app installed
  // Replace with your actual reviews API endpoint if different
  try {
    const res = await axios.get(`https://${SHOP}/apps/product-reviews/api/reviews`, {
      params: {
        handles: productHandles.join(',')
      }
    });
    
    res.data.reviews.forEach(review => {
      if (!ratingsByHandle[review.product_handle]) {
        ratingsByHandle[review.product_handle] = {
          rating: 0,
          count: 0
        };
      }
      ratingsByHandle[review.product_handle].rating += review.rating;
      ratingsByHandle[review.product_handle].count++;
    });
    
    // Calculate average ratings
    Object.keys(ratingsByHandle).forEach(handle => {
      ratingsByHandle[handle].rating = 
        ratingsByHandle[handle].rating / ratingsByHandle[handle].count;
    });
    
  } catch (err) {
    console.warn("Could not fetch product ratings:", err.message);
  }
  
  return ratingsByHandle;
}

async function generateTagBasedRankings() {
  const allProducts = await fetchAllProducts();
  const sales = await fetchSalesData(allProducts);
  const ratings = await fetchProductRatings(allProducts);

  // Group products by tags
  const productsByTag = {};
  
  allProducts.forEach(product => {
    const handle = product.handle;
    const sale = sales[handle] || { units_sold: 0, revenue: 0 };
    const rating = ratings[handle] || { rating: 0, count: 0 };
    
    // Get featured image
    const featuredImage = product.images.length > 0 
      ? product.images.find(img => img.position === 1) || product.images[0]
      : null;
    
    // Get price range
    const prices = product.variants.map(v => parseFloat(v.price));
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = minPrice === maxPrice 
      ? `$${minPrice.toFixed(2)}` 
      : `$${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`;
    
    // Check for compare_at_price to determine if on sale
    const onSale = product.variants.some(v => v.compare_at_price && 
      parseFloat(v.compare_at_price) > parseFloat(v.price));
    
    const productData = {
      handle,
      title: product.title,
      featured_image: featuredImage ? {
        src: featuredImage.src,
        alt: featuredImage.alt || product.title,
        width: featuredImage.width,
        height: featuredImage.height
      } : null,
      price: priceRange,
      on_sale: onSale,
      vendor: product.vendor,
      product_type: product.product_type,
      rating: rating.rating,
      review_count: rating.count,
      units_sold: sale.units_sold,
      revenue: sale.revenue,
      tags: product.tags.split(', ').map(tag => tag.trim()),
      created_at: product.created_at,
      published_at: product.published_at
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
    
    // Sort by units sold (primary) and revenue (secondary)
    tagProducts.sort((a, b) => {
      if (b.units_sold !== a.units_sold) {
        return b.units_sold - a.units_sold;
      }
      return b.revenue - a.revenue;
    });
    
    // Add ranking position to each product
    const rankedProducts = tagProducts.map((product, index) => ({
      ...product,
      rank: index + 1
    }));
    
    tagRankings[tag] = rankedProducts;
    
    // Save individual JSON file for each tag
    const tagFileName = tag.toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '') + '-rankings.json';
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
