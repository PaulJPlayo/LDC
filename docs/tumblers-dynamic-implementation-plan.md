# Tumblers Dynamic Conversion Implementation Plan (Phase 1 Discovery)

## Scope and constraints
- Phase 1 only: discovery and implementation planning.
- No storefront behavior changes in this phase.
- No deploy steps.
- No backend payment/admin/infrastructure configuration changes.

## Current-state findings

### What is static/local in `tumblers.html` today
- The tumbler catalog is currently hardcoded as many inline `<article class="product-card">` entries inside:
  - `<div class="arrivals-grid" data-medusa-collection="tumblers" data-section-key="page-tumblers">`
- Each static card carries page-local swatch data and behavior:
  - swatch image swap (`data-image-target`, `data-image-src`, `data-image-alt`)
  - page-local price swapping (`data-price-target`, `data-price`)
  - limited badge toggles (`data-limited-target`, `data-limited`)
  - hardcoded cart key bindings (`data-product-key="tumbler-*"`)
- The page still contains legacy inline state/runtime logic for cart + favorites + swatches.
  - It reads/writes `ldc:cart` and `ldc:favorites` directly.
  - It has local `renderCart`, `renderFavorites`, `toggleFavorite`, swatch slider/image-swap handlers, and local drawer open/close handlers.
  - Parts are now guarded by `usingSharedFavorites`, but the legacy runtime remains embedded.
- The page still includes in-page favorites/cart drawer markup in addition to shared runtime scripts.

### Tumbler-specific UI/design that must be preserved
- Page-level visual identity:
  - hero layout, gradients, top nav treatment, CTA rhythm, custom/support modal styling.
- Card design language:
  - tumbler card gradients, badge stack placement, swatch slider row, product meta/title/price arrangement, tile action icon placement.
- Card behavior expectations:
  - color/swatch-driven preview updates
  - clear variant signal for user selection
  - favorites heart and add-to-cart controls on each card

### How dynamic collection pages are structured now
Reference patterns in `new-arrivals.html` and `best-sellers.html`:
- A dynamic grid container with section attributes, for example:
  - `data-medusa-tag="new-arrivals" data-section-key="new-arrivals"`
  - `data-medusa-tag="best-sellers" data-section-key="best-sellers"`
- A single `<template data-card-template>` used by `commerce.js`.
- `commerce.js` runs `renderDynamicGrids()` and populates cards from live `/store/products` data + metadata.

### Data sources currently used by `commerce.js`
- `product-map.json` (variant fallback mapping + optional card image fallback).
- Medusa Store API (`/store/products`, region-aware) as the primary dynamic catalog source.
- Product metadata fields used for section assignment/order and tile/swatch details.

## Proposed dynamic architecture for `tumblers.html`

### Target model
- Keep the existing tumbler page shell/hero/support-custom sections static.
- Convert only the catalog grid to a commerce-managed dynamic grid using a tumbler-focused card template.
- Use shared storefront runtime as the source of truth for:
  - product rendering
  - swatch/variant selection
  - add-to-cart wiring
  - favorites heart state and favorites drawer sync

### Section/filter strategy
- Make tumblers a managed dynamic section using section key `tumblers` (not page-local `page-tumblers`).
- Keep `data-medusa-collection="tumblers"` and align `data-section-key="tumblers"` so `commerce.js` managed-section filtering applies consistently.

### Rendering strategy
- Replace the hardcoded card list with a single tumbler card template in `tumblers.html`.
- Let `commerce.js` clone/populate cards per product and variant metadata.
- Preserve tumbler visual design by keeping tumbler-specific card CSS and ensuring template class hooks map cleanly to current styles.

### Favorites/cart compatibility strategy
- Continue using `favorites.js` shared store as canonical favorites state.
- Keep add-to-cart routed through `commerce.js`/`window.LDCCommerce`.
- Remove conflicting page-local favorites/cart mutations from tumbler inline runtime once dynamic cutover is stable.

## Exact files to modify in later phases

### Primary files
- `tumblers.html`
  - convert static card inventory to template-based dynamic grid
  - align section key to managed dynamic section
  - retire/gate obsolete inline cart/favorites/swatch runtime paths
- `commerce.js`
  - only if needed for tumbler-specific parity hooks (e.g., badge/swatch/meta mapping or template field hydration)

### Supporting files (conditional)
- `product-map.json`
  - fallback variant/image mapping only if metadata gaps prevent parity
- `docs/tumblers-dynamic-implementation-plan.md`
  - keep updated as implementation decisions finalize

## Preservation requirements (non-negotiable)
- Preserve tumbler page hero/nav/section visual identity.
- Preserve tumbler card visual language (gradient card shell, badge stack, swatch lane, title/meta/price hierarchy).
- Keep favorites compatibility intact:
  - tile heart behavior
  - shared favorites drawer sync
  - favorites page shared-state compatibility
- Keep mini-cart and checkout hydration compatibility unchanged.
- Keep support/custom modal behavior intact.

## Legacy local/static logic to retire or gate later
- Page-local favorites/cart state mutations in `tumblers.html` inline script.
- Inline listeners that duplicate shared favorites runtime:
  - tile heart toggles
  - local favorites drawer mutation handlers
  - local favorites storage writes
- Page-local swatch/image/price mutation blocks where shared `commerce.js` swatch handling already covers the same behavior.
- Keep only minimal compatibility guards if absolutely necessary and document any retained fallback path.

## Risks and edge cases
- **Section key mismatch risk:** `page-tumblers` is not a managed section key in `commerce.js`; dynamic assignment/sorting can drift if not normalized to `tumblers`.
- **Visual parity risk:** shared/dynamic card hydration may not exactly preserve tumbler-specific card mood without template/CSS parity tuning.
- **Metadata completeness risk:** missing `storefront_sections`, `storefront_order`, swatch metadata, or tile overrides can degrade card quality/order.
- **Variant resolution risk:** products missing clean variant metadata can cause wrong/default variant selection for cart/favorites.
- **Script conflict risk:** legacy inline runtime and shared runtime can double-bind events if not cleanly gated.
- **Badge/price parity risk:** static badge/price swap behavior currently encoded in card HTML may require metadata mapping for dynamic parity.
- **Empty grid risk:** if live product tagging/section metadata is incomplete, tumblers grid can render partially or blank.

## Recommended implementation order
1. **Grid contract alignment**
   - Align tumblers grid attributes to managed dynamic section keys and verify expected product assignment behavior.
2. **Template-first conversion**
   - Replace static tumbler card inventory with one tumbler card template preserving the current design system.
3. **Dynamic hydration parity pass**
   - Ensure `commerce.js` hydrates title, description/meta, image, price, badges, and swatches for tumbler cards.
4. **Legacy runtime deconflict**
   - Gate/remove page-local favorites/cart/swatch handlers that overlap with shared runtime.
5. **Compatibility verification pass**
   - Validate favorites heart + drawer + favorites page sync, mini-cart behavior, and checkout hydration remain intact.
6. **Cleanup/document retained guards**
   - Keep only necessary fallback guards and document any retained legacy path.

## Phase 1 outcome
- Discovery completed for tumbler static/local implementation and shared runtime integration points.
- Dynamic conversion architecture defined with explicit preservation constraints.
- File-by-file execution map and risk-driven implementation sequence prepared.
- No storefront behavior changes made in this phase.
