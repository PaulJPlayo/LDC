# Cart Add Audit

This document explains how to run the Phase 2 add-to-cart audits and interpret the output.

## Scripts

- `scripts/audit-cart-add-api.js`
  - Exhaustive Store API audit across products and variants.
  - Validates whether each variant can be added to cart through Medusa Store API.

- `scripts/audit-cart-add-ui.js`
  - Playwright crawl of live storefront routes.
  - Validates tile add-to-cart click behavior through the same UI path users use.

## Output Artifacts

Artifacts are written to `artifacts/` (gitignored):

- `artifacts/cart-add-audit.api.json`
- `artifacts/cart-add-audit.api.csv`
- `artifacts/cart-add-audit.api.md`
- `artifacts/cart-add-audit.ui.json`
- `artifacts/cart-add-audit.ui.md`

## Run API Audit

```bash
node scripts/audit-cart-add-api.js
```

### API audit environment variables

- `MEDUSA_BACKEND_URL` (default: `https://api.lovettsldc.com`)
- `MEDUSA_PUBLISHABLE_KEY` (optional; script falls back to publishable key found in `commerce.js`)
- `AUDIT_LIMIT_VARIANTS` (optional sample mode)

Example sample run:

```bash
AUDIT_LIMIT_VARIANTS=25 node scripts/audit-cart-add-api.js
```

## Run UI Audit

Run with Playwright without modifying repo dependencies:

```bash
npx -y -p playwright node scripts/audit-cart-add-ui.js
```

### UI audit environment variables

- `STOREFRONT_BASE_URL` (default: `https://lovettsldc.com`)
- `AUDIT_LIMIT_TILES_PER_ROUTE` (optional sample mode)
- `AUDIT_CLICK_WAIT_MS` (default: `1500`)
- `AUDIT_SKIP_SWATCH_SECOND_CLICK=1` to disable second swatch test
- `AUDIT_HEADLESS=0` to run headed

Example sample run:

```bash
AUDIT_LIMIT_TILES_PER_ROUTE=6 npx -y -p playwright node scripts/audit-cart-add-ui.js
```

## Failure Types

Both scripts use consistent failure buckets:

- `unavailable_stock_location`
- `out_of_stock`
- `missing_price`
- `unavailable_variant`
- `server_error`
- `unknown_add_failure`

UI audit can also record interaction-specific issues:

- `missing_add_to_cart_button`
- `click_no_effect`
- `swatch_click_failed`
- `route_load_failed`
- `no_tiles_found`

## Admin Interpretation Checklist

For failures, check the variant in Medusa Admin / Admin Studio:

1. Sales Channel to Stock Location mapping
- Confirm the storefront sales channel is associated with a stock location that contains this variant inventory.

2. Inventory state
- Confirm `manage_inventory` and available quantity/backorder settings are consistent with expected availability.

3. Price coverage
- Confirm variant has price for the active region/currency used by storefront checkout.

4. Publish state
- Confirm product/variant is published to the storefront sales channel.

5. Variant metadata consistency
- Confirm variant data needed for storefront selection is present and not hidden by metadata flags.

## Suggested Workflow

1. Run API audit first to generate the canonical backend failure list.
2. Run UI audit to detect click-path issues (`CLICK_NO_EFFECT`, missing buttons, route-specific behavior).
3. Prioritize fixes by failure count and business impact.
