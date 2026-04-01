# Trending-Family Header Parity Audit

Date: 2026-04-01

## Scope

Verdict: `DRIFT`

Define everything required to move the Trending-family pages onto the same branded header shell used by the completed Shop-family and Sale-family pages, without making runtime changes in this audit.

Audited files:

- `new-arrivals.html`
- `best-sellers.html`
- `restock.html`
- `cups.html`
- `tumblers.html`
- `accessories.html`
- `sale.html`
- `under-25.html`
- `last-chance.html`
- `commerce.js`
- `favorites.js`

## Exact Trending-Family Repo Files Identified

Verdict: `MATCH`

Confirmed route-to-file mapping from repo source:

- `/new-arrivals` -> `new-arrivals.html`
- `/best-sellers` -> `best-sellers.html`
- `/restock` -> `restock.html`

Supporting evidence:

- `index.html` nav/dropdown links point to `new-arrivals.html`, `best-sellers.html`, and `restock.html`
- `scripts/build-ldc-products.js` references `best-sellers.html` and `restock.html`
- the three route pages exist at the repo root and each carries the matching `data-section-key`

## Reference Header Shell Source Of Truth

Verdict: `MATCH`

Use `sale.html` as the rollout template for the Trending-family shell.

Reason:

- it already proves the fully branded sticky shell, utility icon cluster, explicit favorites drawer shell, explicit cart drawer shell, support overlay shell, and mobile `nav-break` behavior
- it already solves the five-link-before-icons density problem with a scoped nav-spacing treatment
- it already matches the category-page shell visually and behaviorally

Secondary reference:

- use `cups.html` to preserve the exact plain-anchor treatment for `Home` and `Account`

## Current Root-Cause Class

Verdict: `DRIFT`

Overall root-cause class: `E` (combined drift)

Why:

- `A` active item order is not fixed in place on `new-arrivals.html` and `best-sellers.html`
- `B` Trending nav styling is still page-local and not aligned to the branded shell pattern
- `C` utility icons use a separate `nav-icon-link` treatment and direct-link destinations instead of branded-shell icon-button hooks
- `D` explicit favorites drawer shell, explicit cart drawer shell, and branded cart-open runtime path are incomplete or absent

## Current Drift By Trending-Family Page

### `new-arrivals.html`

Verdict: `DRIFT`

Current state:

- uses a page-local `.top-bar` variant rather than the proven branded shell block from `sale.html`
- nav order is `Home -> Best Sellers -> Restock -> New Arrivals -> Account`, so the active item is moved instead of staying stationary
- active item is a plain `<span class="nav-link is-active">New Arrivals</span>` without the fixed-order Trending-family nav set around it
- body carries `mauve-mode`, which reintroduces global anchor underline styling unless the branded-shell selectors are ported exactly
- utility icons are `nav-icon-link` anchors:
  - favorites -> `favorites.html`
  - checkout/cart -> `checkout.html`
  - support -> page-local overlay
- no favorites badge hook
- no cart badge hook
- no explicit favorites drawer shell
- no explicit cart drawer shell
- support overlay exists, but it is not the same shell bundle used by the branded pages

### `best-sellers.html`

Verdict: `DRIFT`

Current state:

- nav order is `Home -> New Arrivals -> Restock -> Best Sellers -> Account`, so the active item is reordered to the end of the Trending subset
- active item uses a separate page-local `best-sellers-nav-inline is-active` treatment instead of the branded `nav-link is-active` chip
- utility icons are direct links instead of branded-shell hooks
- no favorites badge hook
- no cart badge hook
- no explicit favorites drawer shell
- no explicit cart drawer shell
- support overlay exists, but it is still a page-local shell

### `restock.html`

Verdict: `DRIFT`

Current state:

- nav order is already logically close to the fixed Trending order, but the active item still uses the separate `best-sellers-nav-inline is-active` treatment
- utility icons are direct links instead of branded-shell hooks
- no favorites badge hook
- no cart badge hook
- no explicit favorites drawer shell
- no explicit cart drawer shell
- support overlay exists, but it is still a page-local shell

## Exact Final Trending-Family Nav Variant Definition

Verdict: `DRIFT`

Required final nav order:

1. `Home` -> `index.html`
2. `New Arrivals` -> `new-arrivals.html`
3. `Best Sellers` -> `best-sellers.html`
4. `Restock` -> `restock.html`
5. `Account` -> `account.html`
6. utility icon cluster

Required placement:

- `Home` must stay left of `New Arrivals`
- `Account` must stay right of `Restock`
- `Account` must stay directly left of the favorites/cart/support icon cluster
- keep the branded-shell `nav-break` immediately before the utility icon cluster

Markup rule:

- `Home` and `Account` should use the same plain `<a class="nav-link" ...>` pattern as `cups.html`
- the three Trending-family items should stay in a fixed order on all three pages
- the active Trending-family item should be a non-link `<span class="nav-link is-active">…</span>`

Responsive rule:

- no `nav-label-full` / `nav-label-short` pattern is required by the current Trending labels
- if mobile density becomes tight during implementation, solve it with a small Trending-family nav-spacing class modeled on `sale.html`, not by reordering links

## Active-State Rules

Verdict: `MATCH`

Required active-state behavior:

- `/new-arrivals` -> `New Arrivals` active in place
- `/best-sellers` -> `Best Sellers` active in place
- `/restock` -> `Restock` active in place
- `Home` remains a normal link on all three pages
- `Account` remains a normal link on all three pages

## Required Parity Dependencies

### Header / Top-Bar Shell

Verdict: `DRIFT`

Required from `sale.html`:

- sticky `.top-bar`
- two-line logo block markup and classes
- branded `.nav-link` / `.nav-link.is-active`
- `.nav-break`
- `.nav-icon-cluster`
- branded `.top-bar .icon-button` treatment
- `.icon-badge`

### Utility Hooks

Verdict: `DRIFT`

Required header hooks:

- favorites opener: `data-favorites-open`
- favorites badge: `data-favorites-count`
- cart opener: `data-open-cart` and `data-cart-open`
- cart badge: `data-cart-count`
- support opener: `data-support-open`

### Favorites Drawer

Verdict: `DRIFT`

Important dependency detail:

- `favorites.js` can auto-create a generic drawer from `[data-favorites-open]`
- that means adding the favorites hook alone is enough for basic open behavior
- however, exact branded parity still requires the explicit shell already used on `sale.html`

Required shell nodes:

- `[data-favorites-drawer]`
- `[data-favorites-overlay]`
- `[data-favorites-panel]`
- `[data-favorites-close]`
- `[data-favorites-items]`
- `[data-favorites-cta]`

### Cart Drawer

Verdict: `DRIFT`

Important dependency detail:

- `commerce.js` does not auto-create the branded mini-cart shell
- current Trending pages have no `[data-cart-drawer]` shell
- `commerce.js` route parity is currently limited to:
  - `/tumblers`
  - `/cups`
  - `/accessories`
  - `/sale`
  - `/under-25`
  - `/last-chance`
- `/new-arrivals`, `/best-sellers`, and `/restock` are not in `CATEGORY_MINI_CART_PATHS`

Required parity dependencies:

- explicit cart drawer shell from `sale.html`
- one shared `commerce.js` route-extension update so the mini cart installs on:
  - `/new-arrivals`
  - `/best-sellers`
  - `/restock`

Required shell nodes:

- `[data-cart-drawer]`
- `[data-cart-overlay]`
- `[data-cart-panel]`
- `[data-cart-close]`
- `[data-cart-items]`
- `[data-cart-total]`
- `[data-cart-checkout]`
- `[data-cart-reset]`

### Support Overlay

Verdict: `DRIFT`

Important dependency detail:

- current Trending pages already have a support overlay and page-local support script
- for exact parity, those should be ported to the same branded-shell structure and styling used on `sale.html`

Required shell and script:

- `[data-support-overlay]`
- `[data-support-card]`
- `[data-support-close]`
- `[data-support-form]`
- page-local support open/close script that toggles `.is-open` and `body.support-open`

### Body / Wrapper Dependencies

Verdict: `DRIFT`

Required wrapper expectations:

- `.page-shell`
- shell-level body background consistent with the branded header pages
- avoid page-local body classes that reintroduce conflicting anchor decoration or icon treatment

Important note:

- `new-arrivals.html` currently uses `mauve-mode`, which is likely to fight the final non-underlined branded nav unless the branded-shell selectors fully replace that local header treatment

## Mobile / Responsive Risk Notes

Verdict: `UNKNOWN`

Main risk:

- moving from the current Trending-family layouts to a fixed five-item nav row before the icon cluster

What is known:

- `sale.html` already proves that a five-link pre-icon layout can work with a small scoped spacing adjustment
- Trending labels are shorter than the Sale-family labels, so the density risk is lower than the Sale-family rollout
- the branded shell already handles mobile icon-row separation with `nav-break`

What is not yet proven:

- whether the Trending-family pages need any nav-specific spacing helper at all, or can reuse the base branded shell without a dedicated `.trending-family-nav` refinement

## Recommended Rollout Order

Verdict: `MATCH`

Recommended sequence:

1. pilot `new-arrivals.html`
2. finish parity there, including the fixed nav order and branded drawer/icon hooks
3. if desktop + mobile parity is clean, roll the same shell pattern to `best-sellers.html`
4. then `restock.html`

Why `new-arrivals.html` first:

- it has the broadest combined drift:
  - reordered active item
  - `mauve-mode` underline risk
  - direct-link utility icons
  - no explicit favorites/cart shell

## Final Recommendation

Verdict: `MATCH`

Use `sale.html` as the implementation template for the Trending-family rollout, with `cups.html` as the reference for plain `Home` / `Account` anchor treatment.

Implementation should be handled as a pilot-first sequence and should:

- port the complete branded shell markup, not just the text links
- keep the Trending-family nav row fixed in place across all three pages
- replace direct-link favorites/cart icons with branded-shell hooks
- port the explicit favorites/cart/support shells from `sale.html`
- extend `commerce.js` mini-cart route eligibility for the three Trending routes in the eventual implementation prompt

This is not a nav-row-only change. The branded drawer and mini-cart behavior will not match the completed Shop-family and Sale-family pages unless the shell dependencies above are ported together.
