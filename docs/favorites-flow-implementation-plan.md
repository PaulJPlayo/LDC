# Favorites Flow Implementation Plan (Phase 1 Discovery)

## Scope and Constraints
- This plan covers storefront favorites flow architecture and implementation sequencing only.
- No backend/payment/admin/infrastructure changes are included.
- No deployment steps are included.
- Target behavior: one shared favorites source of truth for tile hearts, favorites drawer, `favorites.html`, and move-to-cart.

## Current-State Findings

### 1) Product tile source locations
There are currently two tile rendering patterns:

1. Commerce-managed dynamic grids (rendered by `commerce.js`):
- `index.html` (home section grids)
- `best-sellers.html`
- `restock.html`
- `sale.html`
- `under-25.html`
- `last-chance.html`
- `new-arrivals.html`
- `cups.html` (also contains inline page logic)
- `accessories.html` (also contains inline page logic)

2. Page-local static card markup:
- `tumblers.html` (many static `.product-card` entries)

### 2) Heart icon coverage and behavior today
- Heart button markup (`.tile-action-favorite`) exists on most tile templates/cards.
- `new-arrivals.html` tile template (`.arrival-card`) currently has no heart/cart action area, so it cannot satisfy "every tile has favorites" in its current markup.
- `commerce.js` includes heart icon HTML in its shared homepage card template, but does **not** implement shared favorites state/handlers.
- Some pages implement their own favorites JS inline (`index.html`, `cups.html`, `accessories.html`, `tumblers.html`), creating divergent behavior and duplicated logic.

### 3) Mini cart drawer and favorites drawer locations
- `index.html`, `tumblers.html`, `cups.html`, `accessories.html` contain local cart drawer + favorites drawer markup and local JS state managers.
- Collection pages (`best-sellers.html`, `restock.html`, `sale.html`, `under-25.html`, `last-chance.html`, `new-arrivals.html`) load `commerce.js` but do not carry full drawer logic.
- `checkout.html` has its own checkout/cart UI flow (not a favorites drawer).

### 4) Product/variant data available at click time
Data availability is good but fragmented:
- `commerce.js` already resolves variant/cart context via:
  - `resolveVariantId(button)`
  - swatch selection helpers
  - per-card dataset fields (`data-product-handle`, `data-product-id`, `data-selected-variant-id`)
- Inline page scripts (`index.html`, `cups.html`, `accessories.html`, `tumblers.html`) independently build favorite items from card DOM:
  - title, price, image/preview style
  - selected swatch/accessory labels and styles
  - custom ID/favoriteId composition

### 5) `favorites.html` implementation summary
- `favorites.html` uses standalone inline JS and reads `localStorage['ldc:favorites']`.
- It currently renders only:
  - preview
  - title
  - price
  - remove
  - clear all
- It does **not** currently provide move-to-cart.
- It normalizes and re-saves a reduced item shape, which can discard richer metadata/options from other pages.

### 6) Major architecture gap
- There is no shared favorites module that all storefront pages use.
- Current favorites behavior is duplicated and inconsistent across pages.

## Recommended Shared Favorites Architecture

## A) Core module (single source of truth)
Create one shared JS module (recommended path: `favorites.js` at repo root to match current static script loading patterns).

Responsibilities:
- Own state in one key (`ldc:favorites`, optionally versioned migration to `ldc:favorites:v2`).
- Deduplicate items by stable favorite key (product + variant/options identity), not timestamp IDs.
- Expose stable API:
  - `add(product)`
  - `remove(id)`
  - `toggle(product)`
  - `has(id)`
  - `all()`
  - `clear()`
  - `subscribe(listener)`
- Persist and broadcast updates (custom event + subscriptions).

Recommended item shape:
- `id` (stable favorite identity)
- `product_id`
- `product_handle`
- `variant_id` (if available)
- `title`
- `short_description`
- `price`
- `currency_code`
- `preview_image`
- `preview_style`
- `options` (color/accessory/etc)
- `source_path`
- `updated_at`

## B) Shared tile integration
- Use delegated click handling for `.tile-action-favorite` so dynamically rendered cards work without per-page rebinding.
- Hook refresh to `window` event already emitted by commerce rendering: `ldc:products:rendered`.
- On refresh, sync heart active state (`is-active` + `aria-pressed`) from shared favorites state.

## C) Shared favorites drawer
- One drawer renderer driven by shared favorites state.
- Drawer item UI should include:
  - image
  - title
  - variant/options summary
  - short description
  - price
  - per-item move-to-cart action
- Drawer actions:
  - remove item
  - go to `favorites.html`
  - optionally clear all

## D) Shared favorites page renderer
- `favorites.html` should render from the same shared module/state.
- Move-to-cart on page should use same cart bridge as drawer.

## E) Cart bridge strategy
- Preferred: use `window.ldcCart.addProduct` if present.
- Fallback: dispatch existing cart events (`cart:add`) or call `window.LDCCommerce` cart methods if required.
- Keep this adapter in one place (shared module), not duplicated in each page.

## Best Hook Points Identified
- `commerce.js` dynamic render lifecycle:
  - `renderDynamicGrids()`
  - emitted event: `ldc:products:rendered`
- Existing global API from `commerce.js`:
  - `window.LDCCommerce.resolveVariantId(...)`
  - add-to-cart helpers and cart sync methods
- Existing drawer/heart selectors across pages:
  - `.tile-action-favorite`
  - `[data-favorites-open]`
  - `[data-favorites-drawer]`

## Exact Files to Modify in Later Phases

## New files (recommended)
- `favorites.js` (shared favorites state + tile hooks + drawer/page renderer + cart bridge)

## Primary integration files
- `commerce.js`
  - add shared hook calls (or safe integration points) for favorites button state sync after dynamic grid renders
  - avoid duplicating favorites business logic in `commerce.js`

## Storefront pages to integrate shared module and remove divergence
- `index.html`
- `tumblers.html`
- `cups.html`
- `accessories.html`
- `new-arrivals.html`
- `best-sellers.html`
- `restock.html`
- `sale.html`
- `under-25.html`
- `last-chance.html`
- `favorites.html`

## Pages to verify only (likely no core favorites implementation work)
- `checkout.html` (no final checkout work in this initiative)
- `account.html`

## Likely Risks and Edge Cases
- Dynamic content replacement can invalidate direct-bound listeners if not delegated.
- `new-arrivals.html` lacks heart action markup in its current card template.
- Existing duplicated inline scripts can conflict with a shared module if not retired/isolated.
- Item identity collisions if IDs include unstable timestamp fragments.
- Loss of metadata on `favorites.html` if reduced-shape serialization remains.
- Missing/unknown variant IDs on some cards and swatch combinations.
- LocalStorage unavailability/private mode.
- Pages without drawer markup need either shared injected drawer markup or standardized static markup.
- Accessibility and focus management across multiple drawer implementations.

## Recommended Implementation Order
1. Establish shared favorites core module and canonical item schema, including migration from existing `ldc:favorites` payloads.
2. Implement delegated tile-heart handling and heart-state syncing, including `ldc:products:rendered` integration.
3. Add/standardize drawer rendering from shared state and connect per-item move-to-cart.
4. Migrate `favorites.html` to shared renderer and add move-to-cart behavior.
5. Remove/retire duplicated inline favorites logic from `index.html`, `tumblers.html`, `cups.html`, and `accessories.html`.
6. Add missing heart action support for `new-arrivals.html` tiles and run cross-route parity verification.

## Phase 1 Outcome
- Discovery completed.
- Shared architecture selected.
- Concrete file map and phased execution order prepared.
- No storefront behavior changes made in this phase.
