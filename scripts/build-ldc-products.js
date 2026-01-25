const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const productMapPath = path.join(root, 'product-map.json');
const outputPath = path.join(root, 'medusa-backend', 'src', 'scripts', 'ldc-products.json');

const productMap = JSON.parse(fs.readFileSync(productMapPath, 'utf8'));
const htmlFiles = [
  'index.html',
  'tumblers.html',
  'cups.html',
  'accessories.html',
  'attire.html',
  'doormats.html',
  'best-sellers.html',
  'restock.html'
].map(file => path.join(root, file)).filter(file => fs.existsSync(file));

const manualPrices = {
  'attire-custom': 20,
  'doormat-custom': 40
};

const decodeHtml = value =>
  String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const slugify = value =>
  String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const cleanLabel = value =>
  String(value || '')
    .replace(/^\s*View\s+/i, '')
    .replace(/\s*(swatch|accent|option)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const parseAttributes = line => {
  const attrs = {};
  const regex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let match = regex.exec(line);
  while (match) {
    attrs[match[1]] = decodeHtml(match[2]);
    match = regex.exec(line);
  }
  return attrs;
};

const titlePatterns = [
  /class="product-title"[^>]*>([^<]+)</,
  /class="tile-title"[^>]*>([^<]+)</,
  /<h3[^>]*class="product-title"[^>]*>([^<]+)</,
  /<h3[^>]*>([^<]+)</
];

const priceRegex = /\$\s?([0-9]+(?:\.[0-9]{2})?)/;
const descriptionPattern = /<div[^>]*class="[^"]*text-xs text-slate-600[^"]*"[^>]*>/i;

const findTitle = (lines, index) => {
  for (let i = index; i >= 0 && i >= index - 120; i -= 1) {
    const line = lines[i];
    for (const pattern of titlePatterns) {
      const match = line.match(pattern);
      if (match) {
        return decodeHtml(match[1].trim());
      }
    }
  }
  return null;
};

const findDescription = blockLines => {
  for (let i = blockLines.length - 1; i >= 0; i -= 1) {
    const line = blockLines[i];
    if (!descriptionPattern.test(line)) continue;
    let text = line.replace(descriptionPattern, '').replace(/<\/div>.*/, '').trim();
    if (!text) {
      for (let j = i + 1; j < blockLines.length; j += 1) {
        const nextLine = blockLines[j];
        if (nextLine.includes('</div>')) {
          const partial = nextLine.replace(/<\/div>.*/, '').trim();
          if (partial) text += (text ? ' ' : '') + partial;
          break;
        }
        const trimmed = nextLine.trim();
        if (trimmed) text += (text ? ' ' : '') + trimmed;
      }
    }
    const cleaned = decodeHtml(text).replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    if (/^\d+(\.\d+)?\s*\(\d+\)$/.test(cleaned)) continue;
    return cleaned;
  }
  return null;
};

const findPrice = (lines, index) => {
  for (let i = index; i >= 0 && i >= index - 120; i -= 1) {
    const match = lines[i].match(priceRegex);
    if (match) {
      return parseFloat(match[1]);
    }
  }
  for (let i = index + 1; i < lines.length && i <= index + 120; i += 1) {
    const match = lines[i].match(priceRegex);
    if (match) {
      return parseFloat(match[1]);
    }
  }
  return null;
};

const findCardStart = (lines, index) => {
  for (let i = index; i >= 0 && i >= index - 200; i -= 1) {
    const line = lines[i];
    if (/<(div|article)[^>]*class="[^"]*product-card[^"]*"/.test(line)) {
      return i;
    }
    if (/<(div|article)[^>]*class="[^"]*group relative[^"]*"/.test(line)) {
      return i;
    }
  }
  return Math.max(0, index - 120);
};

const findCardImage = blockLines => {
  for (const line of blockLines) {
    const match = line.match(/<img[^>]+src="([^"]+)"/);
    if (match) return decodeHtml(match[1]);
    const dataMatch = line.match(/<img[^>]+data-src="([^"]+)"/);
    if (dataMatch) return decodeHtml(dataMatch[1]);
  }
  return null;
};

const extractSwatches = blockLines => {
  const swatches = [];
  const swatchRegex = /<span[^>]*class="[^"]*\bswatch\b[^"]*"/i;
  blockLines.forEach(line => {
    if (!swatchRegex.test(line)) return;
    const attrs = parseAttributes(line);
    const className = attrs['class'] || '';
    if (
      /swatch-arrow/i.test(className) ||
      /swatch-slider/i.test(className) ||
      /swatch-slider-track/i.test(className) ||
      /swatch-slider-window/i.test(className)
    ) {
      return;
    }
    const rawLabel =
      attrs['data-color-label'] ||
      attrs['data-accessory-label'] ||
      attrs['aria-label'] ||
      attrs['data-image-alt'] ||
      attrs['title'] ||
      '';
    const label = cleanLabel(rawLabel);
    if (!label) return;
    const price = attrs['data-price'] ? parseFloat(attrs['data-price']) : null;
    const image = attrs['data-image-src'] || null;
    swatches.push({
      label,
      labelKey: slugify(label),
      image,
      price
    });
  });
  return swatches;
};

const mergeSwatches = (existing, incoming) => {
  const map = new Map();
  existing.forEach(item => {
    map.set(item.labelKey, { ...item });
  });
  incoming.forEach(item => {
    const current = map.get(item.labelKey);
    if (!current) {
      map.set(item.labelKey, { ...item });
      return;
    }
    if (!current.image && item.image) current.image = item.image;
    if ((current.price == null || Number.isNaN(current.price)) && typeof item.price === 'number') {
      current.price = item.price;
    }
    map.set(item.labelKey, current);
  });
  return Array.from(map.values());
};

const found = {};

for (const file of htmlFiles) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/data-product-key="([^"]+)"/);
    if (!match) continue;
    const key = match[1];
    const start = findCardStart(lines, i);
    const block = lines.slice(start, i + 1);
    const swatches = extractSwatches(block);
    const image = findCardImage(block);
    const price = findPrice(lines, i);
    if (!found[key]) {
      found[key] = {
        key,
        title: findTitle(lines, i),
        price: price,
        image: image,
        swatches: swatches,
        description: findDescription(block)
      };
    } else {
      if (!found[key].price) found[key].price = price;
      if (!found[key].image && image) found[key].image = image;
      found[key].swatches = mergeSwatches(found[key].swatches || [], swatches);
      if (!found[key].description) found[key].description = findDescription(block);
    }
  }
}

const keys = Object.keys(productMap.products || {}).sort();
const products = [];
const missing = [];

for (const key of keys) {
  const mapEntry = productMap.products[key] || {};
  const foundEntry = found[key] || {};
  const title = foundEntry.title || mapEntry.title || key;
  const description = foundEntry.description || mapEntry.description || null;
  let price = typeof foundEntry.price === 'number' ? foundEntry.price : null;
  if (manualPrices[key]) {
    price = manualPrices[key];
  }
  if (!price) {
    missing.push(key);
  }
  const priceValue = typeof price === 'number' ? price : 0;
  const image = foundEntry.image || null;
  const swatches = Array.isArray(foundEntry.swatches) ? foundEntry.swatches : [];
  const variants = swatches.map(swatch => {
    const variantPrice = typeof swatch.price === 'number' ? swatch.price : priceValue;
    return {
      label: swatch.label,
      title: `${title} - ${swatch.label}`,
      price: typeof variantPrice === 'number' ? variantPrice : 0,
      image: swatch.image || image
    };
  });
  products.push({
    key,
    title,
    handle: key,
    price: priceValue,
    image,
    variants,
    description
  });
}

if (missing.length) {
  console.warn('Missing prices for:', missing.join(', '));
}

const output = {
  currency: 'usd',
  products
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(`Wrote ${products.length} products to ${outputPath}`);
