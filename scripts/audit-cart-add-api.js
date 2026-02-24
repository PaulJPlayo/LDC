#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.join(ROOT_DIR, 'artifacts');

const DEFAULT_BACKEND_URL = 'https://api.lovettsldc.com';
const DEFAULT_PRODUCT_PAGE_LIMIT = 200;

const envLimit = Number.parseInt(process.env.AUDIT_LIMIT_VARIANTS || '', 10);
const AUDIT_LIMIT_VARIANTS = Number.isInteger(envLimit) && envLimit > 0 ? envLimit : null;
const MEDUSA_BACKEND_URL = String(process.env.MEDUSA_BACKEND_URL || DEFAULT_BACKEND_URL).replace(/\/$/, '');

const sanitizeText = value =>
  String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();

const extractPublishableKeyFromCommerce = async () => {
  const commercePath = path.join(ROOT_DIR, 'commerce.js');
  const source = await fs.readFile(commercePath, 'utf8');
  const match = source.match(/pk_[A-Za-z0-9]+/);
  return match ? match[0] : '';
};

const resolvePublishableKey = async () => {
  if (process.env.MEDUSA_PUBLISHABLE_KEY) {
    return String(process.env.MEDUSA_PUBLISHABLE_KEY).trim();
  }
  return extractPublishableKeyFromCommerce();
};

const createStoreRequest = ({ backendUrl, publishableKey }) => {
  return async (pathname, options = {}) => {
    const url = `${backendUrl}${pathname}`;
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'content-type': 'application/json',
        ...(publishableKey ? { 'x-publishable-api-key': publishableKey } : {}),
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (error) {
        json = null;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      text,
      json,
      url
    };
  };
};

const parseErrorDetails = response => {
  const payload = response && typeof response.json === 'object' ? response.json : null;
  const errorCode = sanitizeText(payload?.type || payload?.code || '');
  const message = sanitizeText(
    payload?.message ||
      payload?.error ||
      response?.text ||
      `Request failed with status ${response?.status || 'unknown'}`
  );
  const detail = payload ? sanitizeText(JSON.stringify(payload)) : sanitizeText(response?.text || '');
  return {
    status: Number.isFinite(Number(response?.status)) ? Number(response.status) : null,
    error_code: errorCode,
    message,
    detail
  };
};

const classifyFailure = details => {
  const status = Number(details?.status);
  const combined = `${sanitizeText(details?.error_code).toLowerCase()} ${sanitizeText(
    details?.message
  ).toLowerCase()} ${sanitizeText(details?.detail).toLowerCase()}`;

  if (
    /not associated with any stock location/.test(combined) ||
    (/sales channel/.test(combined) && /stock location/.test(combined))
  ) {
    return 'unavailable_stock_location';
  }

  if (/out of stock|not enough inventory|insufficient inventory|inventory item/.test(combined)) {
    return 'out_of_stock';
  }

  if (/missing price|no price|not priced|price list|price.*region|region.*price/.test(combined)) {
    return 'missing_price';
  }

  if (/do not exist|does not exist|not published|variant .* not found|invalid_data/.test(combined)) {
    return 'unavailable_variant';
  }

  if (status >= 500) {
    return 'server_error';
  }

  return 'unknown_add_failure';
};

const getVariantPricing = variant => {
  const calculated = variant?.calculated_price || {};
  const amount =
    calculated?.calculated_amount ??
    calculated?.original_amount ??
    variant?.prices?.[0]?.amount ??
    null;
  const currency =
    calculated?.currency_code || variant?.prices?.[0]?.currency_code || '';

  return {
    amount_minor: Number.isFinite(Number(amount)) ? Number(amount) : null,
    currency_code: sanitizeText(currency).toLowerCase() || ''
  };
};

const getSummary = rows => {
  const totals = {
    total_variants_tested: rows.length,
    success_count: 0,
    failure_count: 0,
    failures_by_type: {}
  };

  rows.forEach(row => {
    if (row.success) {
      totals.success_count += 1;
      return;
    }
    totals.failure_count += 1;
    const key = row.failure_type || 'unknown_add_failure';
    totals.failures_by_type[key] = (totals.failures_by_type[key] || 0) + 1;
  });

  return totals;
};

const toCsv = rows => {
  const headers = [
    'success',
    'failure_type',
    'status',
    'error_code',
    'error_message',
    'product_title',
    'product_handle',
    'product_id',
    'variant_title',
    'variant_id',
    'currency_code',
    'price_minor'
  ];

  const escapeCell = value => {
    const text = String(value == null ? '' : value);
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  };

  const lines = [headers.join(',')];
  rows.forEach(row => {
    lines.push(
      headers
        .map(header => escapeCell(row[header]))
        .join(',')
    );
  });
  return `${lines.join('\n')}\n`;
};

const getTopFailingVariants = rows => {
  const map = new Map();
  rows
    .filter(row => !row.success)
    .forEach(row => {
      const key = `${row.variant_id}::${row.failure_type}`;
      const entry = map.get(key) || {
        variant_id: row.variant_id,
        variant_title: row.variant_title,
        product_title: row.product_title,
        failure_type: row.failure_type,
        status: row.status,
        error_message: row.error_message,
        count: 0
      };
      entry.count += 1;
      map.set(key, entry);
    });

  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);
};

const toMarkdown = ({ generatedAt, config, summary, topFailures }) => {
  const failureRows = Object.entries(summary.failures_by_type)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `| ${type} | ${count} |`)
    .join('\n');

  const topRows = topFailures
    .slice(0, 20)
    .map(
      entry =>
        `| ${entry.variant_id} | ${entry.product_title} | ${entry.variant_title} | ${entry.failure_type} | ${entry.status || ''} | ${entry.count} | ${entry.error_message} |`
    )
    .join('\n');

  return [
    '# Cart Add API Audit',
    '',
    `Generated: ${generatedAt}`,
    '',
    '## Config',
    '',
    `- backend: ${config.backend}`,
    `- region_id: ${config.region_id || '(none)'}`,
    `- audit_limit_variants: ${config.audit_limit_variants || 'none'}`,
    '',
    '## Summary',
    '',
    `- total_products: ${config.total_products}`,
    `- total_variants_tested: ${summary.total_variants_tested}`,
    `- success_count: ${summary.success_count}`,
    `- failure_count: ${summary.failure_count}`,
    '',
    '## Failures By Type',
    '',
    '| failure_type | count |',
    '| --- | ---: |',
    failureRows || '| (none) | 0 |',
    '',
    '## Top Failing Variants',
    '',
    '| variant_id | product | variant | failure_type | status | count | message |',
    '| --- | --- | --- | --- | ---: | ---: | --- |',
    topRows || '| (none) | | | | | | |',
    ''
  ].join('\n');
};

const ensureArtifactsDir = async () => {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
};

const main = async () => {
  const publishableKey = await resolvePublishableKey();
  if (!publishableKey) {
    throw new Error(
      'Missing publishable key. Set MEDUSA_PUBLISHABLE_KEY or ensure commerce.js contains a publishable key default.'
    );
  }

  const request = createStoreRequest({
    backendUrl: MEDUSA_BACKEND_URL,
    publishableKey
  });

  console.log('[api-audit] Starting cart add audit.');
  console.log('[api-audit] backend=', MEDUSA_BACKEND_URL);
  console.log('[api-audit] limit_variants=', AUDIT_LIMIT_VARIANTS || 'none');

  const regionsResponse = await request('/store/regions');
  if (!regionsResponse.ok) {
    const details = parseErrorDetails(regionsResponse);
    throw new Error(`[api-audit] Failed to fetch regions: ${details.status} ${details.message}`);
  }

  const regions = Array.isArray(regionsResponse.json?.regions)
    ? regionsResponse.json.regions
    : [];
  const region = regions[0] || null;
  const regionId = region?.id || '';

  const products = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const query = new URLSearchParams({
      limit: String(DEFAULT_PRODUCT_PAGE_LIMIT),
      offset: String(offset)
    });
    if (regionId) {
      query.set('region_id', regionId);
    }

    const response = await request(`/store/products?${query.toString()}`);
    if (!response.ok) {
      const details = parseErrorDetails(response);
      throw new Error(
        `[api-audit] Failed to fetch products at offset=${offset}: ${details.status} ${details.message}`
      );
    }

    const batch = Array.isArray(response.json?.products) ? response.json.products : [];
    const reportedCount = Number(response.json?.count || 0);

    if (!batch.length) {
      hasMore = false;
      break;
    }

    products.push(...batch);
    offset += batch.length;

    if (reportedCount && offset >= reportedCount) {
      hasMore = false;
    }
  }

  const variantTargets = [];
  products.forEach(product => {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    variants.forEach(variant => {
      variantTargets.push({ product, variant });
    });
  });

  const targets = AUDIT_LIMIT_VARIANTS
    ? variantTargets.slice(0, AUDIT_LIMIT_VARIANTS)
    : variantTargets;

  const rows = [];

  for (let index = 0; index < targets.length; index += 1) {
    const { product, variant } = targets[index];
    const productTitle = sanitizeText(product?.title || '');
    const productHandle = sanitizeText(product?.handle || '');
    const productId = sanitizeText(product?.id || '');
    const variantTitle = sanitizeText(variant?.title || '');
    const variantId = sanitizeText(variant?.id || '');
    const pricing = getVariantPricing(variant);

    if (!variantId) {
      rows.push({
        success: false,
        failure_type: 'unavailable_variant',
        status: null,
        error_code: 'missing_variant_id',
        error_message: 'Variant record is missing id.',
        product_title: productTitle,
        product_handle: productHandle,
        product_id: productId,
        variant_title: variantTitle,
        variant_id: '',
        currency_code: pricing.currency_code,
        price_minor: pricing.amount_minor
      });
      continue;
    }

    const cartResponse = await request('/store/carts', { method: 'POST' });
    if (!cartResponse.ok) {
      const details = parseErrorDetails(cartResponse);
      rows.push({
        success: false,
        failure_type: classifyFailure(details),
        status: details.status,
        error_code: details.error_code,
        error_message: details.message,
        product_title: productTitle,
        product_handle: productHandle,
        product_id: productId,
        variant_title: variantTitle,
        variant_id: variantId,
        currency_code: pricing.currency_code,
        price_minor: pricing.amount_minor
      });
      continue;
    }

    const cart = cartResponse.json?.cart || cartResponse.json || null;
    const cartId = sanitizeText(cart?.id || '');
    if (!cartId) {
      rows.push({
        success: false,
        failure_type: 'unknown_add_failure',
        status: null,
        error_code: 'missing_cart_id',
        error_message: 'Cart creation response did not include an id.',
        product_title: productTitle,
        product_handle: productHandle,
        product_id: productId,
        variant_title: variantTitle,
        variant_id: variantId,
        currency_code: pricing.currency_code,
        price_minor: pricing.amount_minor
      });
      continue;
    }

    const addResponse = await request(`/store/carts/${cartId}/line-items`, {
      method: 'POST',
      body: {
        variant_id: variantId,
        quantity: 1
      }
    });

    if (addResponse.ok) {
      rows.push({
        success: true,
        failure_type: '',
        status: addResponse.status,
        error_code: '',
        error_message: '',
        product_title: productTitle,
        product_handle: productHandle,
        product_id: productId,
        variant_title: variantTitle,
        variant_id: variantId,
        currency_code: pricing.currency_code,
        price_minor: pricing.amount_minor
      });
    } else {
      const details = parseErrorDetails(addResponse);
      rows.push({
        success: false,
        failure_type: classifyFailure(details),
        status: details.status,
        error_code: details.error_code,
        error_message: details.message,
        product_title: productTitle,
        product_handle: productHandle,
        product_id: productId,
        variant_title: variantTitle,
        variant_id: variantId,
        currency_code: pricing.currency_code,
        price_minor: pricing.amount_minor
      });
    }

    await request(`/store/carts/${cartId}`, { method: 'DELETE' }).catch(() => null);

    if ((index + 1) % 25 === 0 || index + 1 === targets.length) {
      console.log(`[api-audit] processed ${index + 1}/${targets.length}`);
    }
  }

  const summary = getSummary(rows);
  const topFailures = getTopFailingVariants(rows);
  const generatedAt = new Date().toISOString();

  const payload = {
    generated_at: generatedAt,
    config: {
      backend: MEDUSA_BACKEND_URL,
      region_id: regionId,
      total_products: products.length,
      total_variants_available: variantTargets.length,
      audit_limit_variants: AUDIT_LIMIT_VARIANTS,
      publishable_key_source: process.env.MEDUSA_PUBLISHABLE_KEY ? 'env' : 'commerce.js'
    },
    summary,
    top_failures: topFailures,
    results: rows
  };

  await ensureArtifactsDir();
  await fs.writeFile(
    path.join(ARTIFACTS_DIR, 'cart-add-audit.api.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8'
  );
  await fs.writeFile(
    path.join(ARTIFACTS_DIR, 'cart-add-audit.api.csv'),
    toCsv(rows),
    'utf8'
  );
  await fs.writeFile(
    path.join(ARTIFACTS_DIR, 'cart-add-audit.api.md'),
    `${toMarkdown({
      generatedAt,
      config: payload.config,
      summary,
      topFailures
    })}\n`,
    'utf8'
  );

  console.log('[api-audit] Done.');
  console.log(
    JSON.stringify(
      {
        total_products: payload.config.total_products,
        total_variants_tested: summary.total_variants_tested,
        success_count: summary.success_count,
        failure_count: summary.failure_count,
        failures_by_type: summary.failures_by_type
      },
      null,
      2
    )
  );
};

main().catch(error => {
  console.error('[api-audit] fatal:', error?.stack || error?.message || error);
  process.exitCode = 1;
});
