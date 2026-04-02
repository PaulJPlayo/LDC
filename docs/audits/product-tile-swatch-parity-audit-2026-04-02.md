# Product-Tile Swatch Parity Audit (2026-04-02)

## 1. Scope
- Audit active-swatch highlight parity across Shop, Sale, and Trending product-tile families.
- Cover both primary color swatches and accessory swatches where those swatches exist on product tiles.
- No runtime changes were made in this audit.

## 2. Shop-family source-of-truth swatch implementation
- `MATCH`: the Shop-family selected-state source of truth is split across shared runtime plus page-local active CSS.
- Shared runtime source of truth in `commerce.js`:
  - `buildSwatchElement(...)` creates `.swatch` nodes and adds `.is-active` to the first swatch in each track.
  - `updateCardPriceForSwatch(...)` removes `.is-active` from sibling swatches in the same track and applies it to the clicked swatch.
  - click and keyboard handlers route all `.swatch` interaction through the same shared path.
- Visual source of truth on Shop pages:
  - `tumblers.html`, `cups.html`, and `accessories.html` all define `.swatch.is-active` and `.swatch-slider .swatch.is-active`.
  - Those selectors provide the visible ring/lift treatment:
    - stronger border color
    - 2px outline
    - slight lift/translate
    - track-specific outline offset correction
- Accessory parity source:
  - `accessories.html` uses the same `.swatch.is-active` selector for both color and accessory swatches.
  - Accessory swatches remain standard `.swatch` elements with `data-swatch-type="accessory"`, so they inherit the same active-ring treatment.

## 3. Current Sale-family drift
- `DRIFT`: `sale.html`, `under-25.html`, and `last-chance.html` all define base `.swatch-row` and `.swatch` styling, but none define `.swatch.is-active`.
- Live result:
  - `.swatch.is-active` is already present in the DOM on all three Sale-family pages.
  - active swatches are inside shared `.ldc-home-tile` cards with `[data-swatch-track]` and `[data-swatch-slider]`.
  - computed active state on live Sale-family pages has:
    - `outline: none`
    - default/light border color
    - no transform/lift
- Conclusion:
  - Sale-family drift is not a missing class-toggle problem.
  - Sale-family drift is missing active-state styling on the live card shell.

## 4. Current Trending-family drift
- `DRIFT`: Trending-family pages do not share one identical source file pattern today.
- `new-arrivals.html`
  - uses the shared tile shell in practice
  - does not define a page-local `.swatch.is-active` visual treatment
- `best-sellers.html` and `restock.html`
  - still contain older page-local `.swatch` selectors scoped to `.product-card:not(.ldc-home-tile)`
  - live hydrated cards are `.ldc-home-tile`, so those selectors miss the live swatch UI
  - neither page defines a matching `.swatch.is-active` rule for the live shared tile shell
- Live result across all three Trending pages:
  - `.swatch.is-active` is already present in the DOM
  - computed active state still has:
    - `outline: none`
    - no active ring
    - no lift/transform
- Conclusion:
  - Trending drift is also CSS-side at runtime, but the page-level selector situation differs between `new-arrivals` and `best-sellers` / `restock`.

## 5. Root-cause class
- `E`
- Exact breakdown:
  - `A`: missing active-state CSS on Sale and Trending live card shells
  - `D`: family/page-level selector drift, especially on `best-sellers.html` and `restock.html`, where older `.product-card:not(.ldc-home-tile)` swatch selectors no longer match the hydrated cards
- Not the cause:
  - `B` is not the blocker
  - shared runtime already applies `.is-active`

## 6. Recommended implementation surface(s)
- Primary recommended surface: target-page CSS only.
- Safest parity surface:
  - add the Shop-family `.swatch.is-active` and `.swatch-slider .swatch.is-active` treatment to:
    - `sale.html`
    - `under-25.html`
    - `last-chance.html`
    - `new-arrivals.html`
    - `best-sellers.html`
    - `restock.html`
- Recommended visual source to copy:
  - active-state rules from `tumblers.html` / `cups.html`
  - same active treatment will also cover accessory swatches because accessory swatches remain `.swatch`
- Recommended avoid-for-first-pass surface:
  - `commerce.js`
  - Reason:
    - shared runtime already creates and toggles `.is-active`
    - a runtime CSS injection change would broaden scope across families that are already correct
    - page-local parity is safer for release-hardening
- Special note for `best-sellers.html` and `restock.html`:
  - their stale `.product-card:not(.ldc-home-tile)` swatch selectors should be treated as a cleanup hotspot
  - the active-ring fix itself can still be done with a selector that matches the actual live `.swatch`

## 7. Recommended pilot pages
1. `sale.html`
2. `new-arrivals.html`

Reason:
- `sale.html` is the clean representative Sale-family page with the shared runtime active class already visible.
- `new-arrivals.html` is the clean representative Trending-family page without the extra stale `:not(.ldc-home-tile)` selector baggage.
- If both match after the pilot, roll the same active-state block to:
  - `under-25.html`
  - `last-chance.html`
  - `best-sellers.html`
  - `restock.html`

## 8. Risk notes / regression hotspots
- Risk: copying the Shop-family ring exactly may need small tuning if a page has tighter swatch spacing.
- Risk: `best-sellers.html` and `restock.html` still carry stale non-`.ldc-home-tile` swatch selectors; do not assume those selectors describe the live card shell.
- Risk: accessory-only cards must be checked explicitly after rollout so the same active ring appears on accessory selections, not just primary color selections.
- Low risk:
  - shared class application path in `commerce.js` is already working
  - live DOM already contains `.swatch.is-active` on affected pages

## 9. Final recommendation
- Pilot on `sale.html` and `new-arrivals.html` first.
- Treat this as a CSS-parity fix, not a runtime selection fix.
- Keep the first pass scoped to active-state selectors that match the actual live `.swatch` elements.
