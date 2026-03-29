# Legacy Favorites Fallback Audit - 2026-03-29

## Objective
Audit the remaining inline favorites fallback code on legacy storefront pages, compare it to the shared `favorites.js` runtime, and determine whether a cleanup prompt can safely retire the fallback path without changing unrelated behavior.

## Scope

- Files audited:
  - `favorites.js`
  - `docs/favorites-flow-verification.md`
  - `index.html`
  - `cups.html`
  - `accessories.html`
  - `tumblers.html`
- Audit mode:
  - Documentation-only
  - No storefront, admin, backend, or workflow edits
  - No `npm run build`

## Current State Summary

- `favorites.js` is the canonical favorites implementation: `MATCH`.
  - It exposes `window.ldcFavorites` with `__sharedStore` (`favorites.js:1076-1085`).
  - It normalizes legacy payload shapes into one canonical record shape (`favorites.js:368-430`).
  - It owns add/remove/toggle behavior (`favorites.js:744-806`).
  - It owns move-to-cart semantics and removes favorites only after add succeeds (`favorites.js:999-1048`).
  - It owns cross-tab sync through the `storage` event (`favorites.js:1060-1073`).
  - It owns drawer structure, drawer rendering, badge/openers sync, and heart-state sync (`favorites.js:1239-1267`, `favorites.js:1437-1478`, `favorites.js:1596-1640`, `favorites.js:1860-1950`).
- All four audited storefront pages still contain page-local favorites code: `MATCH`.
  - Each page computes `usingSharedFavorites = Boolean(window.ldcFavorites && window.ldcFavorites.__sharedStore)`.
  - Each page still defines local favorites state, local drawer rendering, and local heart toggle logic.
  - Most local favorites mutations/listeners are explicitly gated behind `if (!usingSharedFavorites)`.
- The fallback path is not behaviorally identical to the shared path: `DRIFT`.
  - Shared move-to-cart removes favorites only after a successful add.
  - Legacy inline drawer handlers add favorites to cart but do not remove them afterward.
  - Shared storage normalizes canonical product/variant metadata; legacy page-local payloads are flatter and page-specific.
- No audited page implements page-local favorites cross-tab sync: `MATCH`.
  - Only `favorites.js` listens for favorites storage changes.
  - `tumblers.html` has a `storage` listener for cart state only (`tumblers.html:1756-1760`).

## Repo Search Evidence

### Search 1

Command:

```bash
rg -n "usingSharedFavorites|FAVORITES_STORAGE_KEY|sharedFavoritesApi|loadFavoritesState|saveFavorites|renderFavorites|toggleFavorite|window\.ldcFavorites|data-fav-add-cart|data-fav-remove" index.html cups.html accessories.html tumblers.html
```

Results summary:

- `usingSharedFavorites`, `FAVORITES_STORAGE_KEY`, `loadFavoritesState`, `saveFavorites`, `renderFavorites`, and `toggleFavorite` exist in all four audited pages.
- `window.ldcFavorites = favoritesApi` only appears in `index.html:5063-5064`.
- `data-fav-add-cart` and `data-fav-remove` remain in `cups.html`, `accessories.html`, and `tumblers.html`.
- `index.html` uses `data-favorite-add-cart` and `data-favorite-remove` instead.

### Search 2

Command:

```bash
rg -n "addEventListener\('storage'|window\.addEventListener\('storage'|storage_sync|ldc:favorites:change|subscribe\(|reloadFromStorage|__sharedStore" index.html cups.html accessories.html tumblers.html favorites.js
```

Results summary:

- `favorites.js` owns the only favorites storage listener and emits `storage_sync` (`favorites.js:1060-1073`).
- No audited storefront page has a page-local favorites storage sync listener.
- All four audited pages only inspect `window.ldcFavorites.__sharedStore`.

### Search 3

Command:

```bash
rg -n "<script src=\"favorites.js\"|<script src=\"commerce.js\"|data-favorites-managed|data-favorites-cta|data-favorites-open|data-favorites-close|data-favorites-items|data-fav-add-cart|data-fav-remove|data-favorite-add-cart|data-favorite-remove" index.html cups.html accessories.html tumblers.html
```

Results summary:

- All four audited pages load `favorites.js` before their inline script and `commerce.js` after it.
- All four pages still ship legacy drawer markup (`data-favorites-open`, `data-favorites-close`, `data-favorites-items`, `data-favorites-cta`).
- None of the pages ship `data-favorites-managed`, so shared `favorites.js` is free to rewrite drawer markup into the canonical shared structure (`favorites.js:1245-1260`).
- Shared `favorites.js` explicitly supports both legacy drawer control shapes:
  - `data-fav-add-cart` / `data-fav-remove`
  - `data-favorite-add-cart` / `data-favorite-remove`
  - Evidence: `favorites.js:1811-1817`, `favorites.js:1885-1903`

## Inventory Of Remaining Legacy Inline Favorites Code By File

| File | Remaining inline favorites inventory | Notes | Readiness |
| --- | --- | --- | --- |
| `index.html` | Local favorites storage loader/saver, local drawer renderer, local favorites badge sync, local heart sync, local `favoritesApi`, local drawer click handlers, guarded tile-heart/open-close listeners | Unique file because it exposes fallback `window.ldcFavorites = favoritesApi` when shared store is absent | `MATCH` |
| `cups.html` | Local favorites storage loader/saver, local `syncBadges`, local `openFavorites` / `closeFavorites`, local drawer renderer, local drawer add/remove handlers, local `toggleFavorite`, guarded opener/close/heart listeners | Cleanest legacy page; no extra dynamic-grid branch | `MATCH` |
| `accessories.html` | Same fallback structure as `cups.html`, plus accessory-only and swatch-detail formatting inside local drawer renderer and local payload builder | More option-formatting detail, but same fallback pattern | `MATCH` |
| `tumblers.html` | Same fallback structure as `cups.html`, plus `usingDynamicTumblersGrid` guard around local card/cart/favorites binding | Fallback favorites code is still source-present even though dynamic shared rendering is the current direction | `MATCH` |

## Responsibility Matrix

| Concern | Shared favorites.js | Remaining inline fallback | Classification | Audit note |
| --- | --- | --- | --- | --- |
| Favorites drawer open/close | `openDrawer` / `closeDrawer`, click capture (`favorites.js:1642-1669`, `favorites.js:1860-1883`) | `openFavorites` / `closeFavorites` on all four pages, listeners only inside `if (!usingSharedFavorites)` | `both` | Shared path is canonical; fallback listeners are already retired in shared mode |
| Favorites badge/count | `updateBadgesAndOpeners` (`favorites.js:1458-1478`) | `syncFavoritesBadge` in `index.html`; `syncBadges` in `cups.html`, `accessories.html`, `tumblers.html` | `both` | Inline badge code is still source-present and shared-aware, but redundant in shared mode |
| Tile heart state | `syncHeartButtons` and delegated heart click handling (`favorites.js:1437-1455`, `favorites.js:1907-1934`) | `syncFavoriteButtons` in `index.html`; guarded tile-heart listeners in all four pages | `both` | Page-local heart listeners are off when shared store is present |
| Add/remove favorite | `toggleFavorite`, `removeFavorite` (`favorites.js:744-806`, `favorites.js:1885-1929`) | Local `toggleFavorite` and local remove handlers on all four pages | `both` | Local mutations remain only as fallback behavior |
| Drawer rendering | `ensureDrawerStructure`, `renderDrawerItems` (`favorites.js:1239-1267`, `favorites.js:1596-1640`) | Local `renderFavorites` on all four pages | `both` | Shared runtime rewrites drawer markup if needed and renders canonical content |
| Move-to-cart handling | `moveFavoriteToCart` and shared adapter (`favorites.js:999-1048`, `favorites.js:1719-1808`) | Local drawer add-to-cart handlers on all four pages | `both` | `DRIFT`: local fallback adds to cart but does not remove the favorite after success |
| Favorites CTA behavior | Shared drawer footer anchor to `favorites.html` (`favorites.js:1248-1256`) | Local CTA close/redirect handlers on all four pages | `both` | Shared runtime supersedes page-local CTA markup and click behavior |
| Persistence/storage | Canonical normalized store on `ldc:favorites` (`favorites.js:368-430`, `favorites.js:730-806`) | Local `loadFavoritesState` / `saveFavorites` on all four pages | `both` | `DRIFT`: local payload shapes are page-specific and less canonical |
| Cross-tab sync | `storage` listener and `storage_sync` emission (`favorites.js:1060-1073`) | No page-local favorites storage sync found | `shared favorites.js` | Shared runtime is the only implemented cross-tab path |

## Exact Findings Per File

### `index.html`

- Shared/fallback split starts at `index.html:4781-4783`.
- Local fallback storage path:
  - `loadFavoritesState` at `index.html:4793-4822`
  - `saveFavorites` at `index.html:4836-4840`
- Local fallback drawer renderer and item actions:
  - `renderFavorites` at `index.html:4875-4948`
  - drawer actions use `data-favorite-add-cart` and `data-favorite-remove` (`index.html:4935-4940`, `index.html:5067-5086`)
- Local fallback heart sync:
  - `syncFavoriteButtons` at `index.html:4952-4966`
- Local fallback drawer open/close listeners:
  - `openFavorites` / `closeFavorites` at `index.html:4989-5006`
  - guarded listeners at `index.html:5008-5028`
- Local fallback API object:
  - `favoritesApi` at `index.html:5035-5060`
  - fallback global exposure at `index.html:5063-5064`
- Local fallback heart binding:
  - `wireFavoriteButtons` at `index.html:5102-5119`
- Verdict: `MATCH`
  - Safe candidate for retirement of the favorites-specific fallback blocks.
  - Cleanup prompt must not assume adjacent cart helpers are removable just because they sit nearby.

### `cups.html`

- Shared/fallback split starts at `cups.html:1502-1504`.
- Local fallback storage path:
  - `loadFavoritesState` at `cups.html:1552-1558`
  - `saveFavorites` at `cups.html:1583-1586`
- Mixed shared-aware badge path:
  - `syncBadges` at `cups.html:1607-1625`
  - still updates cart and favorites badges, using shared count when present
- Local fallback drawer behavior:
  - `openFavorites` / `closeFavorites` at `cups.html:1763-1775`
  - `renderFavorites` at `cups.html:1777-1829`
  - local drawer buttons use `data-fav-add-cart` and `data-fav-remove` (`cups.html:1803-1804`)
- Local fallback add/remove path:
  - `toggleFavorite` at `cups.html:1831-1844`
  - guarded listeners at `cups.html:1846-1863`
  - guarded tile-heart listeners at `cups.html:1935-1945`
- Verdict: `MATCH`
  - Cleanest first deletion target.
  - `syncBadges` and `getProductDetails` are mixed-use with cart behavior and should not be blanket-deleted without review.

### `accessories.html`

- Shared/fallback split starts at `accessories.html:1419-1421`.
- Local fallback storage path:
  - `loadFavoritesState` at `accessories.html:1470-1476`
  - `saveFavorites` at `accessories.html:1502-1505`
- Mixed shared-aware badge path:
  - `syncBadges` at `accessories.html:1525-1543`
- Local fallback drawer behavior:
  - `openFavorites` / `closeFavorites` at `accessories.html:1686-1698`
  - `renderFavorites` at `accessories.html:1700-1787`
  - local drawer buttons use `data-fav-add-cart` and `data-fav-remove` (`accessories.html:1761-1762`)
- Local fallback add/remove path:
  - `toggleFavorite` at `accessories.html:1789-1802`
  - guarded listeners at `accessories.html:1804-1821`
  - guarded tile-heart listeners at `accessories.html:1945-1955`
- Accessory-specific note:
  - local fallback renderer and payload builder still contain accessory-only formatting and swatch detail logic (`accessories.html:1720-1752`, `accessories.html:1846-1933`)
  - this is not evidence that shared runtime still needs the fallback; shared runtime already reads active swatches and selected dataset state from the card DOM
- Verdict: `MATCH`
  - Safe candidate for retirement of favorites-only fallback blocks.
  - Preserve mixed-use swatch/cart helpers unless they are separately proven unused.

### `tumblers.html`

- Shared/fallback split starts at `tumblers.html:1438-1440`.
- Local fallback storage path:
  - `loadFavoritesState` at `tumblers.html:1493-1499`
  - `saveFavorites` at `tumblers.html:1517-1520`
- Mixed shared-aware badge path:
  - `syncBadges` at `tumblers.html:1576-1594`
- Local fallback drawer behavior:
  - `openFavorites` / `closeFavorites` at `tumblers.html:1762-1774`
  - `renderFavorites` at `tumblers.html:1776-1828`
  - local drawer buttons use `data-fav-add-cart` and `data-fav-remove` (`tumblers.html:1802-1803`)
- Local fallback add/remove path:
  - `toggleFavorite` at `tumblers.html:1830-1843`
  - guarded listeners at `tumblers.html:1845-1862`
  - guarded tile-heart listeners only when `!usingDynamicTumblersGrid && !usingSharedFavorites` (`tumblers.html:1925-1945`)
- Dynamic-grid note:
  - `usingDynamicTumblersGrid` only changes whether local page bindings are added (`tumblers.html:1441-1445`, `tumblers.html:1925-1946`)
  - It does not add a second inline favorites store; shared `favorites.js` remains the intended active path.
- Verdict: `MATCH`
  - Safe candidate for retirement of favorites-only fallback blocks.
  - Cleanup must preserve the separate dynamic-grid/cart logic and not treat the entire script block as disposable.

## Recommended Cleanup Plan

### Smallest safe next-step deletion target

- Start with `cups.html`.
  - It has the simplest fallback shape.
  - It does not have the extra accessory formatting branches from `accessories.html`.
  - It does not have the `usingDynamicTumblersGrid` branch from `tumblers.html`.
- After `cups.html`, apply the same deletion pattern to `accessories.html`, then `tumblers.html`, then `index.html`.
- Treat `index.html` last because it contains the unique fallback `window.ldcFavorites` shim.

### Delete-first targets

- Favorites-only fallback state and persistence:
  - `loadFavoritesState`
  - `favoritesState`
  - `saveFavorites`
- Favorites-only fallback UI/render logic:
  - `renderFavorites`
  - `openFavorites`
  - `closeFavorites`
  - local drawer click handlers for add/remove
  - local `toggleFavorite`
  - guarded `[data-favorites-open]`, `[data-favorites-close]`, overlay, CTA, and tile-heart listeners
- `index.html` only:
  - local `favoritesApi`
  - `window.ldcFavorites = favoritesApi`

### Dependencies / Risks

- `MATCH`: shared `favorites.js` already covers the active supported behavior for:
  - drawer open/close
  - badge/openers state
  - heart state
  - canonical persistence
  - drawer rendering
  - remove and move-to-cart behavior
- `DRIFT`: local fallback move-to-cart semantics differ from shared behavior and should not be preserved accidentally.
- `UNKNOWN` for blanket deletion of adjacent helpers:
  - `syncBadges` in `cups.html`, `accessories.html`, and `tumblers.html` is mixed cart+favorites logic.
  - `syncFavoriteButtons` / `syncFavoritesBadge` in `index.html` sit beside cart/page helpers.
  - `getProductDetails` is shared between fallback favorites and local cart/add-to-cart paths.
  - Swatch dataset setters still matter because shared `favorites.js` reads the live card DOM and dataset state.
- Because of those mixed-use helpers, the cleanup prompt should remove favorites-only fallback code, not large undifferentiated inline script blocks.

### Manual Verification Required After Cleanup

- On each cleaned page:
  - heart toggles still work
  - favorites drawer opens from page header
  - favorites badge count updates
  - drawer remove works
  - drawer move-to-cart works and removes the favorite only after success
  - favorites CTA still reaches `favorites.html`
- Cross-page:
  - favorites added on one audited page appear on `favorites.html`
  - checkout still hydrates normally after drawer move-to-cart
  - no duplicate click handling or console errors
- Tumblers-specific:
  - verify both static and dynamic-grid cases still reflect shared heart state correctly

## Final Overall Verdict

- Cleanup readiness for a scoped Prompt 3: `MATCH`
- Cleanup readiness for a blanket "delete all nearby inline helpers" prompt: `UNKNOWN`

Decision:

- A cleanup prompt may proceed now if it is explicitly scoped to retiring favorites-only fallback code.
- A cleanup prompt should stop if it intends to delete mixed-use cart/swatch helpers or large script regions without first proving those helpers are unused outside the fallback path.
