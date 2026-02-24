#!/usr/bin/env node

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');

const resolvePlaywright = () => {
  try {
    return require('playwright');
  } catch (error) {
    // Continue to fallback lookup.
  }

  const explicitPath = sanitizeText(process.env.PLAYWRIGHT_MODULE_PATH || '');
  if (explicitPath) {
    try {
      return require(explicitPath);
    } catch (error) {
      // Ignore and continue to fallback search.
    }
  }

  const homeDir = process.env.HOME || '';
  const npxRoot = path.join(homeDir, '.npm', '_npx');
  try {
    const candidates = fsSync
      .readdirSync(npxRoot)
      .map(name => path.join(npxRoot, name))
      .filter(dir => fsSync.existsSync(path.join(dir, 'node_modules', 'playwright')))
      .sort((a, b) => {
        const aStat = fsSync.statSync(a);
        const bStat = fsSync.statSync(b);
        return bStat.mtimeMs - aStat.mtimeMs;
      });

    for (const baseDir of candidates) {
      const modulePath = path.join(baseDir, 'node_modules', 'playwright');
      try {
        return require(modulePath);
      } catch (error) {
        // Try next cached module.
      }
    }
  } catch (error) {
    // Ignore lookup errors.
  }

  return null;
};

const sanitizeText = value =>
  String(value == null ? '' : value)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const playwrightModule = resolvePlaywright();
const chromium = playwrightModule?.chromium;

if (!chromium) {
  console.error('[ui-audit] Missing playwright dependency. Run with: npx -y -p playwright node scripts/audit-cart-add-ui.js');
  process.exit(1);
}

const ROOT_DIR = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.join(ROOT_DIR, 'artifacts');

const ROUTES = [
  '/',
  '/tumblers',
  '/cups',
  '/accessories',
  '/new-arrivals',
  '/best-sellers',
  '/restock',
  '/deals',
  '/sale',
  '/under-25',
  '/last-chance'
];

const STOREFRONT_BASE_URL = String(
  process.env.STOREFRONT_BASE_URL || process.env.STOREFRONT_URL || 'https://lovettsldc.com'
).replace(/\/$/, '');

const parsedTileLimit = Number.parseInt(process.env.AUDIT_LIMIT_TILES_PER_ROUTE || '', 10);
const AUDIT_LIMIT_TILES_PER_ROUTE =
  Number.isInteger(parsedTileLimit) && parsedTileLimit > 0 ? parsedTileLimit : null;

const parsedWaitMs = Number.parseInt(process.env.AUDIT_CLICK_WAIT_MS || '', 10);
const AUDIT_CLICK_WAIT_MS = Number.isInteger(parsedWaitMs) && parsedWaitMs > 0 ? parsedWaitMs : 1500;

const SHOULD_TEST_SECOND_SWATCH = process.env.AUDIT_SKIP_SWATCH_SECOND_CLICK !== '1';
const HEADLESS = process.env.AUDIT_HEADLESS === '0' ? false : true;

const ensureArtifactsDir = async () => {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
};

const closeCartUi = async page => {
  await page.evaluate(() => {
    const closeButtons = [
      '[data-cart-close]',
      '[data-cart-dismiss]',
      '.cart-close'
    ];
    closeButtons.forEach(selector => {
      const button = document.querySelector(selector);
      if (button instanceof HTMLElement) button.click();
    });

    const overlay = document.querySelector('[data-cart-overlay], .cart-overlay');
    if (overlay instanceof HTMLElement && overlay.classList.contains('is-open')) {
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    document.body.classList.remove('cart-open');
  });
  await page.waitForTimeout(120);
};

const getAuditSnapshot = async page => {
  return page.evaluate(() => {
    const audit = window.__LDC_CART_AUDIT || {};
    const adds = Array.isArray(audit.adds) ? audit.adds : [];
    const fails = Array.isArray(audit.fails) ? audit.fails : [];
    return {
      addsCount: adds.length,
      failsCount: fails.length,
      lastAdd: adds.length ? adds[adds.length - 1] : null,
      lastFail: fails.length ? fails[fails.length - 1] : null,
      toast: document.querySelector('div[role="status"]')?.textContent?.trim() || ''
    };
  });
};

const classifyOutcome = ({ before, after }) => {
  if (after.failsCount > before.failsCount) {
    const fail = after.lastFail || {};
    return {
      outcome: 'FAILURE',
      failure_type: sanitizeText(fail.failure_type || fail.reason || 'unknown_add_failure'),
      status: Number.isFinite(Number(fail.status)) ? Number(fail.status) : null,
      error_code: sanitizeText(fail.error_code || ''),
      error_message: sanitizeText(fail.error_message || fail.response_detail || ''),
      audit_last_fail: fail,
      audit_last_add: after.lastAdd || null
    };
  }

  if (after.addsCount > before.addsCount) {
    return {
      outcome: 'SUCCESS',
      failure_type: '',
      status: null,
      error_code: '',
      error_message: '',
      audit_last_fail: null,
      audit_last_add: after.lastAdd || null
    };
  }

  return {
    outcome: 'CLICK_NO_EFFECT',
    failure_type: 'click_no_effect',
    status: null,
    error_code: '',
    error_message: 'Click did not increase adds or fails counters.',
    audit_last_fail: after.lastFail || null,
    audit_last_add: after.lastAdd || null
  };
};

const getTileInfo = async tile => {
  return tile.evaluate(node => {
    const titleEl =
      node.querySelector('[data-product-title]') ||
      node.querySelector('.product-title') ||
      node.querySelector('.tile-title') ||
      node.querySelector('h1, h2, h3');
    const addButton = node.querySelector('[data-add-to-cart]');
    const activeSwatch =
      node.querySelector('.swatch.is-active') ||
      node.querySelector('.swatch[aria-pressed="true"]') ||
      node.querySelector('.swatch');

    return {
      product_title: (titleEl?.textContent || '').trim(),
      product_key: node.dataset.productKey || node.querySelector('[data-product-key]')?.dataset?.productKey || '',
      product_handle:
        addButton?.dataset?.productHandle ||
        node.dataset.productHandle ||
        node.querySelector('[data-product-handle]')?.dataset?.productHandle ||
        '',
      has_add_button: Boolean(addButton),
      swatch_count: node.querySelectorAll('.swatch').length,
      active_swatch_label:
        activeSwatch?.getAttribute('aria-label') ||
        activeSwatch?.getAttribute('title') ||
        activeSwatch?.textContent ||
        '',
      active_swatch_variant_id: activeSwatch?.dataset?.variantId || '',
      selected_variant_id: node.dataset.selectedVariantId || '',
      button_variant_id: addButton?.dataset?.variantId || addButton?.dataset?.medusaVariantId || ''
    };
  });
};

const runAddAttempt = async ({ page, tile, route, tileIndex, mode }) => {
  await closeCartUi(page);
  const before = await getAuditSnapshot(page);
  const tileInfoBefore = await getTileInfo(tile);

  try {
    await tile.locator('[data-add-to-cart]').first().scrollIntoViewIfNeeded();
    await tile.locator('[data-add-to-cart]').first().click({ timeout: 5000 });
  } catch (error) {
    return {
      route,
      tile_index: tileIndex,
      mode,
      product_title: sanitizeText(tileInfoBefore.product_title),
      product_key: sanitizeText(tileInfoBefore.product_key),
      product_handle: sanitizeText(tileInfoBefore.product_handle),
      swatch_label: sanitizeText(tileInfoBefore.active_swatch_label),
      swatch_variant_id: sanitizeText(tileInfoBefore.active_swatch_variant_id),
      selected_variant_id: sanitizeText(tileInfoBefore.selected_variant_id),
      button_variant_id: sanitizeText(tileInfoBefore.button_variant_id),
      adds_before: before.addsCount,
      adds_after: before.addsCount,
      fails_before: before.failsCount,
      fails_after: before.failsCount,
      toast: before.toast,
      outcome: 'FAILURE',
      failure_type: 'click_exception',
      status: null,
      error_code: '',
      error_message: sanitizeText(error?.message || 'Unable to click add-to-cart button.').slice(0, 900),
      audit_last_fail: before.lastFail,
      audit_last_add: before.lastAdd
    };
  }

  await page.waitForTimeout(AUDIT_CLICK_WAIT_MS);

  const after = await getAuditSnapshot(page);
  const tileInfoAfter = await getTileInfo(tile);
  const classified = classifyOutcome({ before, after });
  await closeCartUi(page);

  return {
    route,
    tile_index: tileIndex,
    mode,
    product_title: sanitizeText(tileInfoAfter.product_title || tileInfoBefore.product_title),
    product_key: sanitizeText(tileInfoAfter.product_key || tileInfoBefore.product_key),
    product_handle: sanitizeText(tileInfoAfter.product_handle || tileInfoBefore.product_handle),
    swatch_label: sanitizeText(tileInfoAfter.active_swatch_label),
    swatch_variant_id: sanitizeText(tileInfoAfter.active_swatch_variant_id),
    selected_variant_id: sanitizeText(tileInfoAfter.selected_variant_id),
    button_variant_id: sanitizeText(tileInfoAfter.button_variant_id),
    adds_before: before.addsCount,
    adds_after: after.addsCount,
    fails_before: before.failsCount,
    fails_after: after.failsCount,
    toast: sanitizeText(after.toast),
    outcome: classified.outcome,
    failure_type: sanitizeText(classified.failure_type),
    status: classified.status,
    error_code: sanitizeText(classified.error_code),
    error_message: sanitizeText(classified.error_message),
    audit_last_fail: classified.audit_last_fail,
    audit_last_add: classified.audit_last_add
  };
};

const summarize = rows => {
  const summary = {
    total_actions: rows.length,
    success_count: 0,
    failure_count: 0,
    click_no_effect_count: 0,
    failures_by_type: {},
    routes: {}
  };

  rows.forEach(row => {
    const routeKey = row.route || '(unknown)';
    if (!summary.routes[routeKey]) {
      summary.routes[routeKey] = {
        total_actions: 0,
        success_count: 0,
        failure_count: 0,
        click_no_effect_count: 0,
        failures_by_type: {}
      };
    }
    const routeSummary = summary.routes[routeKey];
    routeSummary.total_actions += 1;
    summary.total_actions += 1;

    if (row.outcome === 'SUCCESS') {
      summary.success_count += 1;
      routeSummary.success_count += 1;
      return;
    }

    if (row.outcome === 'CLICK_NO_EFFECT') {
      summary.click_no_effect_count += 1;
      routeSummary.click_no_effect_count += 1;
    }

    summary.failure_count += 1;
    routeSummary.failure_count += 1;

    const key = row.failure_type || 'unknown_add_failure';
    summary.failures_by_type[key] = (summary.failures_by_type[key] || 0) + 1;
    routeSummary.failures_by_type[key] = (routeSummary.failures_by_type[key] || 0) + 1;
  });

  return summary;
};

const topFailures = rows => {
  const grouped = new Map();

  rows
    .filter(row => row.outcome !== 'SUCCESS')
    .forEach(row => {
      const key = `${row.route}::${row.product_title}::${row.failure_type}`;
      const current = grouped.get(key) || {
        route: row.route,
        product_title: row.product_title,
        product_key: row.product_key,
        variant_id: row.selected_variant_id || row.button_variant_id || row.swatch_variant_id,
        failure_type: row.failure_type,
        error_message: row.error_message,
        count: 0
      };
      current.count += 1;
      grouped.set(key, current);
    });

  return Array.from(grouped.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);
};

const toMarkdown = ({ generatedAt, config, summary, topOffenders }) => {
  const routeRows = Object.entries(summary.routes)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([route, stats]) =>
        `| ${route} | ${stats.total_actions} | ${stats.success_count} | ${stats.failure_count} | ${stats.click_no_effect_count} |`
    )
    .join('\n');

  const failureRows = Object.entries(summary.failures_by_type)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `| ${type} | ${count} |`)
    .join('\n');

  const offenderRows = topOffenders
    .slice(0, 20)
    .map(
      entry =>
        `| ${entry.route} | ${entry.product_title} | ${entry.variant_id || ''} | ${entry.failure_type} | ${entry.count} | ${entry.error_message || ''} |`
    )
    .join('\n');

  return [
    '# Cart Add UI Audit',
    '',
    `Generated: ${generatedAt}`,
    '',
    '## Config',
    '',
    `- storefront_base_url: ${config.storefront_base_url}`,
    `- routes_tested: ${config.routes_tested}`,
    `- audit_limit_tiles_per_route: ${config.audit_limit_tiles_per_route || 'none'}`,
    `- click_wait_ms: ${config.click_wait_ms}`,
    `- test_second_swatch: ${config.test_second_swatch}`,
    '',
    '## Summary',
    '',
    `- total_actions: ${summary.total_actions}`,
    `- success_count: ${summary.success_count}`,
    `- failure_count: ${summary.failure_count}`,
    `- click_no_effect_count: ${summary.click_no_effect_count}`,
    '',
    '## Route Breakdown',
    '',
    '| route | actions | success | failure | click_no_effect |',
    '| --- | ---: | ---: | ---: | ---: |',
    routeRows || '| (none) | 0 | 0 | 0 | 0 |',
    '',
    '## Failures By Type',
    '',
    '| failure_type | count |',
    '| --- | ---: |',
    failureRows || '| (none) | 0 |',
    '',
    '## Top Offenders',
    '',
    '| route | product | variant_id | failure_type | count | message |',
    '| --- | --- | --- | --- | ---: | --- |',
    offenderRows || '| (none) | | | | | |',
    ''
  ].join('\n');
};

const main = async () => {
  console.log('[ui-audit] Starting UI add-to-cart audit.');
  console.log('[ui-audit] storefront=', STOREFRONT_BASE_URL);
  console.log('[ui-audit] limit_tiles_per_route=', AUDIT_LIMIT_TILES_PER_ROUTE || 'none');

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();

  const rows = [];

  try {
    for (const route of ROUTES) {
      const routeUrl = `${STOREFRONT_BASE_URL}${route}?cb=${Date.now()}`;
      console.log(`[ui-audit] route ${route}`);

      try {
        await page.goto(routeUrl, { waitUntil: 'networkidle', timeout: 45000 });
      } catch (error) {
        rows.push({
          route,
          tile_index: -1,
          mode: 'route',
          product_title: '',
          product_key: '',
          product_handle: '',
          swatch_label: '',
          swatch_variant_id: '',
          selected_variant_id: '',
          button_variant_id: '',
          adds_before: 0,
          adds_after: 0,
          fails_before: 0,
          fails_after: 0,
          toast: '',
          outcome: 'FAILURE',
          failure_type: 'route_load_failed',
          status: null,
          error_code: '',
          error_message: sanitizeText(error?.message || 'Unable to load route'),
          audit_last_fail: null,
          audit_last_add: null
        });
        continue;
      }

      await page.evaluate(() => {
        try {
          localStorage.removeItem('LDC_CART_ADD_FAILS');
          localStorage.removeItem('ldc:medusa:cart_id');
          localStorage.removeItem('ldc:cart');
        } catch (error) {
          // Ignore storage failures.
        }
        window.__LDC_CART_AUDIT = { adds: [], fails: [] };
      });

      await page.reload({ waitUntil: 'networkidle', timeout: 45000 });
      await closeCartUi(page);

      const tiles = page.locator('.product-card.ldc-home-tile');
      const tileCount = await tiles.count();
      const maxTiles = AUDIT_LIMIT_TILES_PER_ROUTE
        ? Math.min(tileCount, AUDIT_LIMIT_TILES_PER_ROUTE)
        : tileCount;

      if (!tileCount) {
        rows.push({
          route,
          tile_index: -1,
          mode: 'route',
          product_title: '',
          product_key: '',
          product_handle: '',
          swatch_label: '',
          swatch_variant_id: '',
          selected_variant_id: '',
          button_variant_id: '',
          adds_before: 0,
          adds_after: 0,
          fails_before: 0,
          fails_after: 0,
          toast: '',
          outcome: 'FAILURE',
          failure_type: 'no_tiles_found',
          status: null,
          error_code: '',
          error_message: 'No .product-card.ldc-home-tile elements found on route.',
          audit_last_fail: null,
          audit_last_add: null
        });
        continue;
      }

      for (let tileIndex = 0; tileIndex < maxTiles; tileIndex += 1) {
        const tile = tiles.nth(tileIndex);
        await tile.scrollIntoViewIfNeeded();

        const info = await getTileInfo(tile);
        if (!info.has_add_button) {
          rows.push({
            route,
            tile_index: tileIndex,
            mode: 'default',
            product_title: sanitizeText(info.product_title),
            product_key: sanitizeText(info.product_key),
            product_handle: sanitizeText(info.product_handle),
            swatch_label: sanitizeText(info.active_swatch_label),
            swatch_variant_id: sanitizeText(info.active_swatch_variant_id),
            selected_variant_id: sanitizeText(info.selected_variant_id),
            button_variant_id: sanitizeText(info.button_variant_id),
            adds_before: 0,
            adds_after: 0,
            fails_before: 0,
            fails_after: 0,
            toast: '',
            outcome: 'FAILURE',
            failure_type: 'missing_add_to_cart_button',
            status: null,
            error_code: '',
            error_message: 'Tile does not contain [data-add-to-cart] button.',
            audit_last_fail: null,
            audit_last_add: null
          });
          continue;
        }

        const defaultAttempt = await runAddAttempt({
          page,
          tile,
          route,
          tileIndex,
          mode: 'default'
        });
        rows.push(defaultAttempt);

        if (!SHOULD_TEST_SECOND_SWATCH || Number(info.swatch_count || 0) < 2) {
          continue;
        }

        try {
          const secondSwatch = tile.locator('.swatch').nth(1);
          await secondSwatch.scrollIntoViewIfNeeded();
          await secondSwatch.click({ timeout: 5000 });
          await page.waitForTimeout(300);
          const swatchAttempt = await runAddAttempt({
            page,
            tile,
            route,
            tileIndex,
            mode: 'second_swatch'
          });
          rows.push(swatchAttempt);
        } catch (error) {
          const snapshot = await getAuditSnapshot(page);
          const updatedInfo = await getTileInfo(tile);
          rows.push({
            route,
            tile_index: tileIndex,
            mode: 'second_swatch',
            product_title: sanitizeText(updatedInfo.product_title || info.product_title),
            product_key: sanitizeText(updatedInfo.product_key || info.product_key),
            product_handle: sanitizeText(updatedInfo.product_handle || info.product_handle),
            swatch_label: sanitizeText(updatedInfo.active_swatch_label || info.active_swatch_label),
            swatch_variant_id: sanitizeText(updatedInfo.active_swatch_variant_id),
            selected_variant_id: sanitizeText(updatedInfo.selected_variant_id),
            button_variant_id: sanitizeText(updatedInfo.button_variant_id),
            adds_before: snapshot.addsCount,
            adds_after: snapshot.addsCount,
            fails_before: snapshot.failsCount,
            fails_after: snapshot.failsCount,
            toast: sanitizeText(snapshot.toast),
            outcome: 'FAILURE',
            failure_type: 'swatch_click_failed',
            status: null,
            error_code: '',
            error_message: sanitizeText(error?.message || 'Unable to click second swatch.').slice(0, 900),
            audit_last_fail: snapshot.lastFail,
            audit_last_add: snapshot.lastAdd
          });
        }
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const summary = summarize(rows);
  const generatedAt = new Date().toISOString();
  const offenders = topFailures(rows);

  const payload = {
    generated_at: generatedAt,
    config: {
      storefront_base_url: STOREFRONT_BASE_URL,
      routes_tested: ROUTES.length,
      audit_limit_tiles_per_route: AUDIT_LIMIT_TILES_PER_ROUTE,
      click_wait_ms: AUDIT_CLICK_WAIT_MS,
      test_second_swatch: SHOULD_TEST_SECOND_SWATCH,
      headless: HEADLESS
    },
    summary,
    top_failures: offenders,
    results: rows
  };

  await ensureArtifactsDir();
  await fs.writeFile(
    path.join(ARTIFACTS_DIR, 'cart-add-audit.ui.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8'
  );
  await fs.writeFile(
    path.join(ARTIFACTS_DIR, 'cart-add-audit.ui.md'),
    `${toMarkdown({
      generatedAt,
      config: payload.config,
      summary,
      topOffenders: offenders
    })}\n`,
    'utf8'
  );

  console.log('[ui-audit] Done.');
  console.log(
    JSON.stringify(
      {
        total_actions: summary.total_actions,
        success_count: summary.success_count,
        failure_count: summary.failure_count,
        click_no_effect_count: summary.click_no_effect_count,
        failures_by_type: summary.failures_by_type
      },
      null,
      2
    )
  );
};

main().catch(error => {
  console.error('[ui-audit] fatal:', error?.stack || error?.message || error);
  process.exitCode = 1;
});
