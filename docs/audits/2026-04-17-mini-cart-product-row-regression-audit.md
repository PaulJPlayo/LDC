# Mini Cart Product Row Regression Audit (2026-04-17)

## 1. Files and routes read

### Controlling docs
- `README.md`
- `AGENTS.md`
- `docs/cart-audit.md`
- `docs/favorites-flow-verification.md`
- `docs/audits/product-tile-swatch-parity-audit-2026-04-02.md`

### Shared storefront runtime
- `commerce.js`
- `favorites.js`
- `checkout.html`

### Route files inspected for cart/favorites ownership and drift surface
- `tumblers.html`
- `cups.html`
- `accessories.html`
- `sale.html`
- `under-25.html`
- `last-chance.html`
- `new-arrivals.html`
- `best-sellers.html`
- `restock.html`
- `index.html` (inventory only; out of target scope)

### Exact code surfaces traced
- `commerce.js:2971-2982` `isMedusaBackedLegacyCartItem`
- `commerce.js:3045-3308` `formatLegacyItem`
- `commerce.js:3396-3409` `syncLegacyCart`
- `commerce.js:3756-3800` `normalizeLegacyCartItemForDrawer`
- `commerce.js:3808-3825` `getLegacyDrawerDisplayOptions`
- `commerce.js:4216-4305` `renderCategoryMiniCart`
- `commerce.js:4333-4419` cart mutation routing
- `commerce.js:4815-4843` tile add-to-cart path
- `commerce.js:2849-2933` `buildLineItemMetadata`
- `commerce.js:2298-2352` `resolveVariantIdForFavorite`
- `favorites.js:873-997` `buildCommerceMetadataFromFavorite`
- `favorites.js:999-1058` `moveFavoriteToCart`
- `favorites.js:1719-1808` `defaultMoveToCartAdapter`

## 2. Live URLs tested

- `https://lovettsldc.com/tumblers?cb=1776446615909`
- `https://lovettsldc.com/new-arrivals?cb=1776446626936`
- `https://lovettsldc.com/sale?cb=1776446637482`
- `https://lovettsldc.com/new-arrivals?cb=1776446648933` (favorites drawer move-to-cart path)
- `https://lovettsldc.com/checkout?cb=<per-flow cache buster>` as the control surface after each flow
- `https://lovettsldc.com/commerce.js?cb=20260417a`
- `https://lovettsldc.com/favorites.js?cb=20260417a`

## 3. Route/flow inventory audited

### Live-reproduced flows
- `/tumblers` tile add-to-cart
- `/new-arrivals` tile add-to-cart
- `/sale` tile add-to-cart
- `/new-arrivals` favorites drawer move-to-cart
- `/checkout` cart display after each of the above

### Static route inventory on the same shared mini-cart path

`commerce.js:3508` defines the shared category mini-cart path set:

- `/tumblers`
- `/cups`
- `/accessories`
- `/attire`
- `/sale`
- `/under-25`
- `/last-chance`
- `/new-arrivals`
- `/best-sellers`
- `/restock`

### Route-local cart ownership findings

- `tumblers.html`, `cups.html`, and `accessories.html` still ship route-local cart state helpers (`loadCartState`, `normalizeCartItem`, `saveCart`, `renderCart`, `window.ldcCart` bridge).
- `sale.html`, `under-25.html`, `last-chance.html`, `new-arrivals.html`, `best-sellers.html`, and `restock.html` do not ship route-local `ldc:cart` writers; they rely on shared `commerce.js` cart runtime plus drawer shell markup.
- On Shop-family routes, `commerce.js` still installs the shared category mini cart after the page-local script. Live `/tumblers` evidence shows the rendered broken row is the shared category renderer (`cart-item-name`, `cart-item-price`, `cart-item-preview`), not the page-local renderer. That makes the reproduced defect shared-global, not Shop-only.

## 4. Source-of-truth item/row shape

### Source of truth

For this regression, the correct storefront mini-cart row shape is the formatted row produced by:

- raw Medusa line item
- `formatLegacyItem(...)`
- then persisted by `syncLegacyCart(...)`
- then rendered without another shape conversion

### Canonical stored row shape

Observed live after tile add and after favorites move:

```json
{
  "id": "cali_...",
  "name": "Autumn Leaves",
  "price": 0.45,
  "price_minor": 45,
  "currency_code": "USD",
  "quantity": 1,
  "previewStyle": "background-color: #ffffff; background-image: url(\"https://ldc-8kg.pages.dev/assets/ldc-tumbler-8.jpeg\"); background-size: cover; background-position: center; background-repeat: no-repeat;",
  "description": "40oz | Stainless Steel",
  "options": [
    { "label": "Variant", "value": "Autumn Leaves - Chocolate brown" },
    {
      "label": "Color",
      "value": "Chocolate brown",
      "swatchStyle": "background: radial-gradient(...);",
      "swatchGlyph": ""
    }
  ],
  "isDesignSubmitted": false
}
```

That shape matches the checkout control surface and is the correct mini-cart row source of truth for the audited flows.

## 5. Actual failing item/row shape(s)

### Shared failing rendered row shape

Observed on `/tumblers`, `/new-arrivals`, `/sale`, and `/new-arrivals` favorites move-to-cart:

```text
ITEM
$0.00
DESCRIPTION
40OZ | STAINLESS STEEL
```

Shared DOM evidence:

- title collapses to `Item`
- price collapses to `$0.00`
- preview falls back to the gradient placeholder
- color/variant options disappear
- description survives

### Per-flow evidence

#### `/tumblers` tile add
- Request payload metadata: correct
- Stored `ldc:cart`: correct
- Drawer row: `Item / $0.00 / Description only`
- Checkout row: `Gold Trim Tumbler / $0.40 / Description + Color / real preview`

#### `/new-arrivals` tile add
- Request payload metadata: correct
- Stored `ldc:cart`: correct
- Drawer row: `Item / $0.00 / Description only`
- Checkout row: `Autumn Leaves / $0.45 / Description + Color / real preview`

#### `/sale` tile add
- Request payload metadata: correct
- Stored `ldc:cart`: correct
- Drawer row: `Item / $0.00 / Description only`
- Checkout row: `Autumn Leaves / $0.45 / Description + Color / real preview`

#### `/new-arrivals` favorites drawer move-to-cart
- Favorites drawer before move: correct title, price, description, color
- Move-to-cart POST metadata: correct
- Stored `ldc:cart`: correct
- Drawer row after move: `Item / $0.00 / Description only`
- Checkout row: `Autumn Leaves / $0.45 / Description + Color / real preview`

## 6. Root-cause class

`DRIFT`: shared `commerce.js` normalization/rendering drift.

### Exact failure mechanism

1. `syncLegacyCart` stores already-formatted display rows:
   - `commerce.js:3396-3409`
   - it maps raw Medusa line items through `formatLegacyItem(...)`
   - those stored rows include `price_minor`

2. `normalizeLegacyCartItemForDrawer` decides whether to run `formatLegacyItem(...)` again:
   - `commerce.js:3756-3800`
   - it calls `formatLegacyItem(item, currencyCode)` whenever `isMedusaBackedLegacyCartItem(item)` is truthy

3. `isMedusaBackedLegacyCartItem` classifies any item with `price_minor` as Medusa-backed:
   - `commerce.js:2971-2982`
   - that catches the already-formatted rows emitted by `syncLegacyCart`

4. The already-formatted row is therefore double-normalized as if it were a raw Medusa line item:
   - second `formatLegacyItem(...)` call looks for raw fields such as `unit_price`, `product_title`, `title`, `metadata`, and variant/product objects
   - those fields are mostly absent on the formatted storage row
   - result:
     - title falls back to `Item`
     - price recomputes from missing `unit_price` to `0`
     - preview falls back because `previewStyle` is not re-read by `getLineItemDisplayPreviewStyle(...)`
     - options collapse because the second pass rebuilds options from missing metadata instead of using the stored `options` array
     - description survives because `getLineItemDisplayDescription(...)` still sees `item.description`

### Plain statement

This is a double-normalization bug. The offending classification is the `price_minor` branch inside `isMedusaBackedLegacyCartItem(...)`, as consumed by `normalizeLegacyCartItemForDrawer(...)`.

## 7. Exact helper/dependency map

### Direct tile add path

1. Tile click on `[data-add-to-cart]`
2. `commerce.js:4815-4843` `handleAddToCart`
3. `commerce.js:2511-2550` `resolveVariantId`
4. `commerce.js:2849-2933` `buildLineItemMetadata`
5. `commerce.js:3428-3441` `addLineItem`
6. `commerce.js:3414-3426` `syncBadges`
7. `commerce.js:2700-2708` `getCart`
8. `commerce.js:2739-2747` `applyCartUpdate`
9. `commerce.js:3396-3409` `syncLegacyCart`
10. `commerce.js:3045-3308` `formatLegacyItem`
11. localStorage write to `ldc:cart`
12. `cart:set`
13. `commerce.js:4216-4305` `renderCategoryMiniCart`
14. `commerce.js:3756-3800` `normalizeLegacyCartItemForDrawer`
15. `commerce.js:3808-3825` `getLegacyDrawerDisplayOptions`
16. broken shared drawer row

### Favorites drawer move-to-cart path

1. Heart click on `.tile-action-favorite`
2. `favorites.js:1907-1945` shared favorites toggle path
3. Favorites drawer renders canonical favorite row
4. Drawer click on `[data-favorite-add-cart]`
5. `favorites.js:1827-1848` `handleMoveToCart`
6. `favorites.js:999-1058` `moveFavoriteToCart`
7. `favorites.js:1719-1808` `defaultMoveToCartAdapter`
8. `commerce.js:2298-2352` `resolveVariantIdForFavorite`
9. `favorites.js:873-997` `buildCommerceMetadataFromFavorite`
10. `commerce.js:3428-3441` `addLineItem`
11. then the exact same shared `syncLegacyCart -> ldc:cart -> renderCategoryMiniCart` path above

## 8. Shared-vs-route-specific verdict

### Verdict

Shared-global.

### Why

- The defect reproduces on all three required representative families:
  - Shop: `/tumblers`
  - Trending: `/new-arrivals`
  - Sale: `/sale`
- It also reproduces on favorites drawer move-to-cart.
- All reproduced failures converge on the same shared renderer and the same stored row shape.
- Live `/tumblers` proves the broken DOM is the shared category renderer, not the route-local fallback renderer.
- Checkout stays correct on those same flows, so payload truth survives past add-to-cart and favorites move-to-cart.

### Explicitly ruled out

- Route-level product-tile payload shaping drift as primary cause: ruled out by correct POST metadata and correct stored `ldc:cart` rows on all reproduced tile routes.
- Favorites-to-cart handoff drift as primary cause: ruled out by correct move-to-cart metadata and correct stored `ldc:cart` row after move.
- Stale production as primary cause: ruled out for the audited helper chain. Live `favorites.js` matched byte-for-byte, and the relevant live `commerce.js` snippets matched local `main` for:
  - `isMedusaBackedLegacyCartItem`
  - `syncLegacyCart`
  - `normalizeLegacyCartItemForDrawer`
  - `renderCategoryMiniCart`

## 9. Recommended narrow implementation surface

### Safest Phase 2 surface

`commerce.js` only, inside the mini-cart normalization/rendering path:

- primary target: `normalizeLegacyCartItemForDrawer(...)`
- likely add a dedicated helper such as `isFormattedLegacyDrawerItem(...)` or `hasLegacyDrawerDisplayShape(...)`

### Why this is safer than changing the shared predicate globally

Do **not** make the first fix a broad change to `isMedusaBackedLegacyCartItem(...)`.

That predicate is also used for:

- remove / increase / decrease routing (`commerce.js:4333-4361`)
- reset path split between Medusa-backed and legacy-only items (`commerce.js:4409-4425`)
- attire legacy checkout conversion checks (`checkout.html:966-978`)

If Phase 2 makes formatted stored rows no longer count as Medusa-backed everywhere, the mini-cart mutation path can regress into local-only mutations instead of the Medusa API.

### Narrow fix shape

Keep the existing mutation routing semantics. Only stop the drawer normalizer from re-formatting rows that are already formatted for drawer/storage display.

## 10. Recommended pilot page/flow

`/sale` tile add-to-cart.

### Reason

- It reproduces the bug cleanly.
- It uses the shared category mini cart without Shop-family route-local cart coexistence.
- It gives the narrowest proof that the shared renderer fix works before touching pages that still carry legacy local cart helpers.

## 11. Recommended rollout order

1. `/sale` tile add-to-cart pilot
2. `/new-arrivals` tile add-to-cart
3. `/tumblers` tile add-to-cart
4. `/new-arrivals` favorites drawer move-to-cart
5. Sale-family siblings by shared-path equivalence:
   - `/under-25`
   - `/last-chance`
6. Trending-family siblings by shared-path equivalence:
   - `/best-sellers`
   - `/restock`
7. Shop-family siblings by shared-path equivalence:
   - `/cups`
   - `/accessories`

Implementation guardrails for Phase 2:

- do not rewrite `syncLegacyCart` storage schema in the first pass
- do not patch route files one by one unless the shared fix fails a specific page
- do not reopen Attire pricing/order-path work without new evidence

## 12. MATCH / DRIFT / UNKNOWN matrix by route/flow

| Route / flow | Verdict | Basis |
| --- | --- | --- |
| `/tumblers` tile add | `DRIFT` | Live reproduced. Shared drawer renders `Item / $0.00 / Description only`; checkout remains correct. |
| `/new-arrivals` tile add | `DRIFT` | Live reproduced. Same broken shared drawer output; checkout remains correct. |
| `/sale` tile add | `DRIFT` | Live reproduced. Same broken shared drawer output; checkout remains correct. |
| `/new-arrivals` favorites drawer move-to-cart | `DRIFT` | Live reproduced. Favorites drawer row is correct before move; cart drawer breaks after shared cart sync; checkout remains correct. |
| `/checkout` control surface after the above flows | `MATCH` | Live reproduced. Title, price, preview, and color all remain correct. |
| `commerce.js` live helper chain | `MATCH` | Live cache-busted helper snippets match local `main` for the audited cart path. |
| `favorites.js` live file | `MATCH` | Byte-for-byte match against local `main`. |
| `/under-25` tile add | `DRIFT` | Shared-path inference from `/sale` plus same route shell/runtime pattern. Not live-clicked in this audit. |
| `/last-chance` tile add | `DRIFT` | Shared-path inference from `/sale` plus same route shell/runtime pattern. Not live-clicked in this audit. |
| `/best-sellers` tile add | `DRIFT` | Shared-path inference from `/new-arrivals` plus same route shell/runtime pattern. Not live-clicked in this audit. |
| `/restock` tile add | `DRIFT` | Shared-path inference from `/new-arrivals` plus same route shell/runtime pattern. Not live-clicked in this audit. |
| `/cups` tile add | `DRIFT` | Shared-path inference from `/tumblers` plus same Shop-family local-cart coexistence pattern. Not live-clicked in this audit. |
| `/accessories` tile add | `DRIFT` | Shared-path inference from `/tumblers` plus same Shop-family local-cart coexistence pattern. Not live-clicked in this audit. |
| `/favorites.html` page move-to-cart | `UNKNOWN` | Out of requested live reproduction scope for this audit. Shared adapter suggests the same risk class, but it was not executed here. |

## 13. Validation performed

- `git status --short --branch`
- `git switch main`
- `git pull --ff-only`
- `git switch -c audit/minicart-product-row-regression`
- Cache-busted live checks for:
  - `commerce.js`
  - `favorites.js`
  - `/tumblers`
  - `/new-arrivals`
  - `/sale`
  - `/checkout`
- Playwright-based non-mutating live reproduction captured:
  - exact POST payloads to `/store/carts/{id}/line-items`
  - exact `ldc:cart` payloads
  - exact shared drawer row text
  - exact checkout row text
- `git diff --check`

## 14. Audit note path, commit SHA, and push status

- Audit note path: `docs/audits/2026-04-17-mini-cart-product-row-regression-audit.md`
- Commit SHA: pending at audit-write time
- Push status: pending at audit-write time

## 15. Blockers / follow-up notes

- No blocker to Phase 2 discovery closeout.
- The fix should stay inside shared `commerce.js` mini-cart normalization unless the pilot proves an additional page-local renderer still leaks into runtime on a non-reproduced route.
- Do not use a production retrigger as a substitute for the code fix. The audited live helper chain already matches `main` on the relevant path.
