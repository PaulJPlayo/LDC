# Tumblers Dynamic Verification (Phase 3)

## Implemented scope
- Hardened the dynamic tumblers card path in `commerce.js` while keeping the active grid dynamic (`data-medusa-collection="tumblers"` + `data-section-key="tumblers"` + local template preference).
- Added tumbler-focused swatch fallback styling so dynamic swatches preserve visual parity when variant swatch metadata is incomplete.
- Added product-map-aware variant image fallback for swatch selection and default card image hydration.
- Added tumbler-specific limited badge parity fallback for known tumbler product/variant cases when metadata does not explicitly provide a badge.
- Kept heart/favorites behavior on shared `favorites.js` state, drawer rendering, and move-to-cart bridge.
- Hardened tumbler mini-cart parity by syncing page cart drawer state from shared commerce cart events (`cart:set`, `cart:reset`) and cross-tab storage updates.

## Dynamic parity hardening details
- Swatches:
  - Dynamic swatches now use canonical metadata style when present.
  - If metadata style is missing, a tumbler-safe fallback style map is applied by normalized swatch label.
- Image swap:
  - On swatch selection, image resolution now falls back to product-map variant image records when variant/product image fields are incomplete.
- Price and badge parity:
  - Price continues to resolve from selected variant pricing.
  - Badge rendering now supports tumbler parity fallback (`Limited Edition`) where explicit metadata badge is absent.
- Variant resolution:
  - Dynamic cards carry variant IDs through swatch selection and add-to-cart dataset updates.
  - Product-map + store-product lookup remains the shared resolution path.

## Old/local tumbler behavior retired vs retained
- Retired or gated from active dynamic path:
  - old static/local tumbler catalog card inventory (no longer active renderer)
  - page-local add-to-cart card listeners (gated by `!usingDynamicTumblersGrid`)
  - page-local favorites mutation listeners (gated by `!usingSharedFavorites` and dynamic path guards)
  - page-local swatch/image swap runtime for static cards (gated by `!usingDynamicTumblersGrid`)
- Retained intentionally:
  - support/custom modal runtime and shell behavior
  - conservative fallback local handlers behind dynamic/shared guards for resilience if dynamic/shared runtime is unavailable
  - local cart drawer UI shell, now synchronized to shared commerce cart events

## Known limitations
- Tumbler limited-badge parity fallback uses explicit handle/variant maps in `commerce.js`; future catalog additions should move into product metadata where possible to avoid code-map maintenance.
- Swatch fallback styles are label-driven and may need extension if new tumbler color labels are introduced without metadata styles.
- Validation in this phase is repository/runtime hardening only; live visual parity still requires manual QA.

## Manual QA checklist (post-deploy)
- Verify tumblers product grid loads dynamically on `tumblers.html` (no static fallback cards as active path).
- Verify swatches work on tumbler cards:
  - active swatch changes visual state
  - selected swatch updates variant selection
- Verify image/price/badge parity:
  - swatch changes update image where expected
  - price reflects selected/default variant
  - limited badge behavior matches intended tumbler cases
- Verify heart/favorites behavior:
  - tile heart toggles correctly
  - favorites drawer opens and renders canonical item data
- Verify mini-cart behavior:
  - add-to-cart updates cart badge and cart drawer item list
  - reset/remove behavior still works in drawer
- Verify move-to-cart still works:
  - from favorites drawer/page, moved items are added to cart and removed from favorites only on success
- Verify checkout still hydrates normally:
  - cart lines present on `checkout.html`
  - no final checkout completion required in this phase
