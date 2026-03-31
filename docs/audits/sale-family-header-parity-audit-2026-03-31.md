# Sale-Family Header Parity Audit

Date: 2026-03-31

## Scope

Audited files:

- `sale.html`
- `under-25.html`
- `last-chance.html`
- `tumblers.html`
- `cups.html`
- `accessories.html`
- `commerce.js`
- `favorites.js`

Objective:

- identify everything required to give `sale.html`, `under-25.html`, and `last-chance.html` the same category-page header shell, styling, placement, and behavior as the reference category pages
- define the sale-family nav variant that replaces the existing category-page nav set

## Reference Header Shell Source Of Truth

Verdict: `MATCH`

Use `cups.html` as the source-of-truth shell.

Reason:

- the three reference pages already share the same structural header pattern: sticky `.top-bar`, two-line logo block, nav wrapper, active-chip treatment, utility icon cluster, favorites/cart badges, explicit favorites drawer markup, explicit cart drawer markup, and support overlay shell
- `cups.html` is the closest fit for the sale-family variant because it already uses the `nav-label-full` / `nav-label-short` pattern for a longer label (`Cups & Mugs`), which is the same pattern the sale-family links will likely need on mobile

Important note:

- `tumblers.html`, `cups.html`, and `accessories.html` are structurally equivalent for the header shell
- their page themes differ slightly, but the parity work should copy one full shell consistently rather than mixing fragments

## Sale-Family Nav Variant Definition

Verdict: `DRIFT`

Replace the category-page text-link set with this sale-family nav set:

| Page | Active item | Inactive items |
| --- | --- | --- |
| `sale.html` | `Deals for the Steal` | `Under $25 Items`, `Last Chance - Seasonal` |
| `under-25.html` | `Under $25 Items` | `Deals for the Steal`, `Last Chance - Seasonal` |
| `last-chance.html` | `Last Chance - Seasonal` | `Deals for the Steal`, `Under $25 Items` |

Exact hrefs:

- `Deals for the Steal` -> `sale.html`
- `Under $25 Items` -> `under-25.html`
- `Last Chance - Seasonal` -> `last-chance.html`

Recommended mobile label treatment:

- keep the exact full labels above as the desktop-facing labels
- reuse the category-page `nav-label-full` / `nav-label-short` pattern on mobile because these labels are longer than the current category labels
- recommended short labels:
  - `Deals`
  - `Under $25`
  - `Last Chance`

Active-state rule:

- match category-page behavior by rendering the active item as a non-link `<span class="nav-link is-active">…</span>`
- render inactive sale-family items as `<a class="nav-link" href="…">…</a>`

## Current Differences On Each Sale-Family Page

### `sale.html`

Verdict: `DRIFT`

Current state:

- uses a simple `header` + `.header-inner` shell instead of `.top-bar`
- uses a link-wrapped `.brand-mark` instead of the category-page two-line logo block
- uses a single `Back Home` pill instead of category-style nav links
- has no utility icon cluster
- has no favorites badge hook
- has no cart badge hook
- has no support opener hook
- has no explicit favorites drawer shell
- has no explicit cart drawer shell
- has no support overlay shell
- has no page-local support opener wiring

What is already present:

- `body[data-medusa-*]` attributes
- `.page-shell`
- managed commerce collection markup: `data-medusa-tag="sale"` and `data-section-key="sale"`
- `favorites.js` and `commerce.js`

### `under-25.html`

Verdict: `DRIFT`

Current state matches the same header-shell drift as `sale.html`.

What is already present:

- `body[data-medusa-*]` attributes
- `.page-shell`
- managed commerce collection markup: `data-medusa-tag="under-25"` and `data-section-key="under-25"`
- `favorites.js` and `commerce.js`

### `last-chance.html`

Verdict: `DRIFT`

Current state matches the same header-shell drift as `sale.html`.

What is already present:

- `body[data-medusa-*]` attributes
- `.page-shell`
- managed commerce collection markup: `data-medusa-tag="last-chance"` and `data-section-key="last-chance"`
- `favorites.js` and `commerce.js`

## Required Parity Dependencies

### Shell Markup

Verdict: `DRIFT`

Required port from the category-page source shell:

- sticky `.top-bar` header wrapper
- category-page logo block markup and classes
- nav wrapper markup and classes
- active-link span treatment
- utility icon cluster markup

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

- `favorites.js` can auto-create a generic shared drawer if a page has no `[data-favorites-drawer]`
- that means sale-family favorites buttons are not fully blocked today
- however, true parity with the category pages still requires the explicit category-page favorites drawer shell so the drawer markup, CTA placement, and page-local styling match exactly

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

- `commerce.js` does not auto-create the category mini-cart shell
- the sale-family pages do not currently contain `[data-cart-drawer]` or its required children
- if the category-style cart icon is added without this shell, category-page mini-cart parity will not exist

Required shell nodes:

- `[data-cart-drawer]`
- `[data-cart-overlay]`
- `[data-cart-panel]`
- `[data-cart-close]`
- `[data-cart-items]`
- `[data-cart-total]`
- `[data-cart-checkout]`
- `[data-cart-reset]`

### Support Modal / Sheet

Verdict: `DRIFT`

Important dependency detail:

- support behavior is page-local on the category pages
- it is not provided by `commerce.js`
- adding the contact icon alone is not enough

Required shell and wiring:

- `body.support-open` support state styling
- `[data-support-overlay]`
- `[data-support-card]`
- `[data-support-close]`
- `[data-support-form]`
- the page-local opener/closer script that toggles `.is-open` and `body.support-open`

### Custom Overlay

Verdict: `MATCH` for “not required by this parity task”

Notes:

- category pages include `[data-custom-overlay]` and `body.custom-open`, but that is tied to page hero CTAs, not the header buttons
- it should stay out of scope for the sale-family header implementation unless a separate prompt explicitly asks to port the category-page hero CTA behavior too

### CSS Needed For Parity

Verdict: `DRIFT`

Required category-shell selectors include at minimum:

- `.top-bar`
- `.nav-link`
- `.nav-link.is-active`
- `.nav-break`
- `.nav-label-full`
- `.nav-label-short`
- `.nav-icon-cluster`
- `.nav-icon-link`
- `.icon-badge`
- `.favorites-*` drawer selectors
- `.cart-*` drawer selectors
- `.support-*` overlay selectors
- the responsive `@media (max-width: 767px)` nav/icon rules used by the category pages

### Body / Wrapper Dependencies

Verdict: `MATCH` with one caveat

Already present:

- `.page-shell`
- `body[data-medusa-enabled]`
- `body[data-medusa-backend]`
- `body[data-medusa-publishable-key]`

Caveat:

- `body.support-open` is not present on the sale-family pages today and must be added if the category support icon is ported

## Risks / Regression Hotspots

- adding only the visible header markup without the cart drawer shell will create a dead or degraded cart button
- adding the support icon without the overlay shell and page-local support script will create a dead contact button
- relying on the `favorites.js` auto-created drawer will produce functional favorites behavior but not true category-page shell parity
- the sale-family labels are wider than the current category labels, so mobile wrapping should be verified on the pilot page before cloning the change across all three pages
- the active sale-family item should remain a non-link span to match category-page behavior
- the category-page custom-order overlay is adjacent to the shell in the source pages, but porting it into the sale-family pages would widen scope unnecessarily

## Recommended Rollout Order

Verdict: `MATCH`

Use a pilot-first sequence:

1. `sale.html`
2. `under-25.html`
3. `last-chance.html`

Why:

- all three sale-family pages currently share the same simpler header pattern, so a pilot on `sale.html` can prove the shell transplant and mobile nav variant before duplicating the work
- `sale.html` is the cleanest place to verify the new sale-family nav labels, active-state treatment, favorites/cart/support buttons, and responsive wrapping

## Final Recommendation

Verdict: `MATCH`

Implementation should proceed in a pilot-first sequence.

Safe implementation shape:

- copy the full `cups.html` header shell structure as the canonical source
- replace the category text-link set with the sale-family nav variant only
- port the cart drawer shell and support shell with the header change
- port the explicit favorites drawer shell as well, even though the shared runtime can auto-create a fallback drawer
- do not port category-page hero CTA custom-overlay behavior in the same prompt

Bottom line:

- this is not a nav-text-only change
- the sale-family pages need the category-page header shell plus its dependent drawer/modal hooks to reach true parity
