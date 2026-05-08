'use strict';

const { getE2EEnv } = require('./helpers/e2eEnv');

let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch (error) {
  throw new Error('Missing playwright-core. Install or restore the local Playwright runtime before running this check.');
}

const ACCOUNT_PATH = '/account.html';
const CHECKOUT_ROUTE_PATTERN = /\/(checkout|payment|order-confirmation|admin)(\/|$|\?)/i;
const WIDTHS = [
  { width: 360, height: 1100 },
  { width: 375, height: 1100 },
  { width: 390, height: 1100 },
  { width: 768, height: 1100 },
  { width: 1280, height: 900 }
];

const results = [];

const accountUrlFrom = publicUrl => new URL(ACCOUNT_PATH, publicUrl).toString();

const mark = (name, passed, detail = '') => {
  const line = `${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`;
  results.push({ name, passed, detail });
  console.log(line);
};

const assertCheck = (name, passed, detail = '') => {
  mark(name, passed, detail);
  if (!passed) {
    throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`);
  }
};

const isVisible = async (page, selector) =>
  page.locator(selector).isVisible().catch(() => false);

const waitForAccountState = async page => {
  await page.waitForFunction(() => {
    const auth = document.querySelector('[data-account-auth]');
    const details = document.querySelector('[data-account-details]');
    return Boolean((auth && !auth.hidden) || (details && !details.hidden));
  }, undefined, { timeout: 20000 });
};

const waitForSignedIn = async page => {
  await page.waitForFunction(() => {
    const details = document.querySelector('[data-account-details]');
    const workspace = document.querySelector('.account-workspace');
    return Boolean(details && !details.hidden && workspace);
  }, undefined, { timeout: 30000 });
};

const collectLayout = async (page, size) => {
  await page.setViewportSize(size);
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const clientWidth = doc.clientWidth;
    const scrollWidth = Math.max(doc.scrollWidth, body ? body.scrollWidth : 0);
    return {
      clientWidth,
      scrollWidth,
      overflowX: scrollWidth > clientWidth + 1
    };
  });
};

const collectStorageSummary = async page =>
  page.evaluate(() => {
    const rawUploadStoragePattern = /data:(image|application|text|video|audio)\//i;
    const rawBinaryStoragePattern = /\b(base64|blob:|File\b|Blob\b)\b/i;
    const paymentStoragePattern = /\b(card|cardNumber|cvv|cvc|stripe|payment|billing|paypal|expiration)\b/i;

    const collect = storage => {
      const entries = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) || '';
        entries.push(`${key}\n${storage.getItem(key) || ''}`);
      }
      return entries;
    };

    const entries = [
      ...collect(window.localStorage),
      ...collect(window.sessionStorage)
    ];

    return {
      localStorageEntryCount: window.localStorage.length,
      sessionStorageEntryCount: window.sessionStorage.length,
      rawUploadLikeCount: entries.filter(entry =>
        rawUploadStoragePattern.test(entry) || rawBinaryStoragePattern.test(entry)
      ).length,
      paymentLikeCount: entries.filter(entry => paymentStoragePattern.test(entry)).length
    };
  });

const checkAnchorTarget = async (page, href, expectedHash) => {
  await page.locator(`.account-workspace a[href="${href}"]`).click();
  await page.waitForTimeout(150);
  const hash = await page.evaluate(() => window.location.hash);
  return hash === expectedHash;
};

const run = async () => {
  const { target, publicUrl, publicCredentials } = getE2EEnv();
  const accountUrl = accountUrlFrom(publicUrl);
  const headed = process.argv.includes('--headed');
  let blockedCheckoutRoute = false;
  let browser;

  console.log(`Account workspace credentialed check target=${target}`);
  console.log(`Account URL=${accountUrl}`);

  browser = await chromium.launch({
    channel: 'chrome',
    headless: !headed
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 }
    });

    await context.route(CHECKOUT_ROUTE_PATTERN, route => {
      blockedCheckoutRoute = true;
      return route.abort();
    });

    const page = await context.newPage();
    await page.goto(accountUrl, { waitUntil: 'domcontentloaded' });
    await waitForAccountState(page);

    const signedOutAuthVisible = await isVisible(page, '[data-account-auth]');
    const signedOutWorkspaceVisible = await isVisible(page, '.account-workspace');
    const signedOutSavedCartsVisible = await isVisible(page, '[data-saved-carts-section]');
    const signedOutOrderHistoryVisible = await isVisible(page, '[data-order-history]');

    assertCheck('signed-out auth UI visible', signedOutAuthVisible);
    assertCheck('signed-out Account Workspace hidden', !signedOutWorkspaceVisible);
    assertCheck('signed-out saved carts hidden', !signedOutSavedCartsVisible);
    assertCheck('signed-out order history hidden', !signedOutOrderHistoryVisible);

    await page.locator('#signInEmail').fill(publicCredentials.email);
    await page.locator('#signInPassword').fill(publicCredentials.password);
    await page.locator('[data-signin-form]').evaluate(form => form.requestSubmit());
    await waitForSignedIn(page);

    const signedInChecks = await page.evaluate(() => ({
      accountSummary: Boolean(document.querySelector('#account-summary')?.getClientRects().length),
      accountWorkspaceVisible: Boolean(document.querySelector('[data-account-details]:not([hidden]) .account-workspace')?.getClientRects().length),
      savedCartsSection: Boolean(document.querySelector('#saved-carts[data-saved-carts-section]')?.getClientRects().length),
      orderHistorySection: Boolean(document.querySelector('#order-history[data-order-history]')?.getClientRects().length),
      accountActions: Boolean(document.querySelector('#account-actions [data-account-logout]')?.getClientRects().length),
      savedWorkspaceHref: document.querySelector('.account-workspace a[href="favorites.html"]')?.getAttribute('href') || '',
      accountSummaryHref: Boolean(document.querySelector('.account-workspace a[href="#account-summary"]')),
      savedCartsHref: Boolean(document.querySelector('.account-workspace a[href="#saved-carts"]')),
      orderHistoryHref: Boolean(document.querySelector('.account-workspace a[href="#order-history"]')),
      accountActionsHref: Boolean(document.querySelector('.account-workspace a[href="#account-actions"]'))
    }));

    assertCheck('signed-in Account Workspace visible', signedInChecks.accountWorkspaceVisible);
    assertCheck('Account Summary present', signedInChecks.accountSummary);
    assertCheck('Saved Carts section present', signedInChecks.savedCartsSection);
    assertCheck('Order History section present', signedInChecks.orderHistorySection);
    assertCheck('Account Actions logout present', signedInChecks.accountActions);
    assertCheck('Saved Workspace link points to favorites.html', signedInChecks.savedWorkspaceHref === 'favorites.html');
    assertCheck('Account Details anchor present', signedInChecks.accountSummaryHref);
    assertCheck('Saved Carts anchor present', signedInChecks.savedCartsHref);
    assertCheck('Order History anchor present', signedInChecks.orderHistoryHref);
    assertCheck('Account Actions anchor present', signedInChecks.accountActionsHref);

    for (const size of WIDTHS) {
      const layout = await collectLayout(page, size);
      assertCheck(
        `${size.width}px no horizontal overflow`,
        !layout.overflowX,
        `clientWidth=${layout.clientWidth}, scrollWidth=${layout.scrollWidth}`
      );
    }

    assertCheck(
      'Account Details anchor targets summary',
      await checkAnchorTarget(page, '#account-summary', '#account-summary')
    );
    assertCheck(
      'Saved Carts anchor targets saved carts',
      await checkAnchorTarget(page, '#saved-carts', '#saved-carts')
    );
    assertCheck(
      'Order History anchor targets order history',
      await checkAnchorTarget(page, '#order-history', '#order-history')
    );
    assertCheck(
      'Account Actions anchor targets logout panel',
      await checkAnchorTarget(page, '#account-actions', '#account-actions')
    );

    const storageSummary = await collectStorageSummary(page);
    assertCheck('no raw upload-like storage found', storageSummary.rawUploadLikeCount === 0);
    assertCheck('no payment-like storage found', storageSummary.paymentLikeCount === 0);
    console.log(
      `Storage summary: localStorageEntries=${storageSummary.localStorageEntryCount}, sessionStorageEntries=${storageSummary.sessionStorageEntryCount}`
    );

    await page.locator('[data-account-logout]').click();
    await page.waitForFunction(() => {
      const auth = document.querySelector('[data-account-auth]');
      const details = document.querySelector('[data-account-details]');
      const savedCarts = document.querySelector('[data-saved-carts-section]');
      const orderHistory = document.querySelector('[data-order-history]');
      return Boolean(
        auth && !auth.hidden &&
        details && details.hidden &&
        savedCarts && savedCarts.hidden &&
        orderHistory && orderHistory.hidden
      );
    }, undefined, { timeout: 20000 });

    assertCheck('logout hides private account UI', true);
    assertCheck('checkout/payment/order/admin routes not entered', !blockedCheckoutRoute);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  const failed = results.filter(result => !result.passed);
  if (failed.length) {
    process.exitCode = 1;
    return;
  }

  console.log('Account workspace credentialed check complete.');
};

run().catch(error => {
  console.error(`FAIL account workspace credentialed check - ${error.message}`);
  process.exitCode = 1;
});
