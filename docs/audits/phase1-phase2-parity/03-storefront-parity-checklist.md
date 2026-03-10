# 03 - Storefront Parity Checklist

## Objective
Track storefront parity against repo-defined expectations without changing storefront behavior or executing final checkout verification.

## Repo-expected state
### Route inventory (repo)
- Root storefront routes/files currently present:
  - `index.html`
  - `new-arrivals.html`
  - `best-sellers.html`
  - `restock.html`
  - `sale.html`
  - `under-25.html`
  - `last-chance.html`
  - `tumblers.html`
  - `cups.html`
  - `accessories.html`
  - `customization.html`
  - `checkout.html`
  - `account.html`
  - `favorites.html`
  - `attire.html`
  - `doormats.html`

### Homepage/section inventory (repo)
- `index.html` sections discovered:
  - `section-1` (hero)
  - `section-2` (Tumblers, `data-section-key="home-tumblers"`, `data-medusa-collection="tumblers"`)
  - `section-3` (Cups, `data-section-key="home-cups"`, `data-medusa-collection="cups"`)
  - `section-accessories` (Accessories, `data-section-key="home-accessories"`, `data-medusa-collection="accessories"`)
  - `section-customization` (Design Studio)
  - `section-4` (Instagram)
  - `section-5` (FAQ)
  - `section-6` (Newsletter/footer prelude)

### Collection/tag section-key inventory (repo)
- `new-arrivals.html`: `data-medusa-tag="new-arrivals"`, `data-section-key="new-arrivals"`
- `best-sellers.html`: `data-medusa-tag="best-sellers"`, `data-section-key="best-sellers"`
- `restock.html`: `data-medusa-tag="restock"`, `data-section-key="restock"`
- `sale.html`: `data-medusa-tag="sale"`, `data-section-key="sale"`
- `under-25.html`: `data-medusa-tag="under-25"`, `data-section-key="under-25"`
- `last-chance.html`: `data-medusa-tag="last-chance"`, `data-section-key="last-chance"`
- `tumblers.html`: `data-medusa-collection="tumblers"`, `data-section-key="page-tumblers"`
- `cups.html`: `data-medusa-collection="cups"`, `data-section-key="page-cups"`
- `accessories.html`: `data-medusa-collection="accessories"`, `data-section-key="page-accessories"`

### Storefront build marker location (repo)
- `commerce.js` contains build marker constants:
  - `STOREFRONT_BUILD_SHA`
  - `STOREFRONT_BUILD_UTC`
- Expected runtime marker emission is via `console.info('[storefront-build]', ...)` in `commerce.js`.

### Expected backend URL behavior (repo)
- Storefront pages set `data-medusa-backend="https://api.lovettsldc.com"` on `<body>`.
- `commerce.js` backend resolution order:
  1. `body.dataset.medusaBackend`
  2. `window.LDC_MEDUSA_BACKEND`
  3. (no fallback URL; missing value logs warning and exits)
- Publishable key resolution order in `commerce.js`:
  1. `body.dataset.medusaPublishableKey`
  2. `window.LDC_MEDUSA_PUBLISHABLE_KEY`
  3. hardcoded fallback key

### Safe manual checks to perform later (no final checkout)
- Verify each route loads and renders expected section grid without JS errors.
- Verify `commerce.js` emits `[storefront-build]` marker in console with SHA/UTC.
- Verify product grids hydrate for expected `data-section-key` containers.
- Verify cart add/remove behavior updates UI and cart badge.
- Verify checkout page can hydrate shipping/payment options display without attempting final order completion.
- Verify fallback/static messaging appears if Medusa data is unavailable.

## Manual evidence to capture later
- Per-route screenshots (desktop + mobile breakpoints where possible).
- Browser console captures showing build marker and any commerce warnings/errors.
- Network captures for `/store/*` API calls from `commerce.js` (sanitized, no secrets).
- Local artifact references under `artifacts/phase1-phase2-parity/storefront/`.

## Findings
- Live storefront parity pass completed for the checked routes and behaviors below.
- No confirmed storefront `DRIFT` items were identified in this pass.

### Route results from completed checks
- `MATCH`:
  - `/`
  - `/new-arrivals.html`
  - `/best-sellers.html`
  - `/restock.html`
  - `/sale.html`
  - `/under-25.html` (recapture completed with screenshot, console, and HAR evidence)
  - `/last-chance.html`
  - `/tumblers.html`
  - `/cups.html`
  - `/accessories.html`
  - `/customization.html`
  - `/checkout.html`
  - `/account.html`
- `UNKNOWN`:
  - `/favorites.html` (route loaded with screenshot/HAR/notes, but console recapture was effectively empty and storefront-build evidence remains inconclusive)

### Behavior and integration checks
- Build marker appeared on key routes including `/` and `/checkout.html`: `MATCH`.
- `/store/*` network calls hit `api.lovettsldc.com`: `MATCH`.
- Add-to-cart behavior worked: `MATCH`.
- Checkout hydrated without final completion: `MATCH`.
- Logged-out account page behavior accepted (`401` on `/store/customers/me` in logged-out state): `MATCH`.

## Status
- Repo inventory capture: `MATCH`
- Live storefront checked routes/behaviors: `MATCH`
- Remaining storefront evidence gaps: `UNKNOWN` (`/favorites.html`)
- Confirmed storefront drift items: none in this pass

## Risk
- Residual storefront risk is limited to one route with inconclusive console/build-marker evidence (`/favorites.html`).

## Next action
- Capture a definitive console recapture for `/favorites.html` confirming or disproving storefront-build marker evidence.
- Reclassify `/favorites.html` as `MATCH` or `DRIFT` once that evidence is complete.

## Blockers
- Inconclusive `/favorites.html` console/build-marker evidence prevents full storefront closeout.

## Signoff
- Reviewer:
- Date:
- Decision:
