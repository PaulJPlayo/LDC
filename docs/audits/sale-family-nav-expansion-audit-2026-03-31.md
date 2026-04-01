# Sale-Family Nav Expansion Audit

Date: 2026-03-31

## Scope

Verdict: `DRIFT`

Define the next Sale-family nav-row variant for:

- `sale.html`
- `under-25.html`
- `last-chance.html`

without changing the already-complete branded shell, drawer shell, or runtime behavior.

This audit covers:

- the current source-of-truth nav implementation on `cups.html`, `tumblers.html`, and `accessories.html`
- the exact Home + Account expansion for the Sale-family pages
- active-state rules
- placement/order requirements
- mobile/responsive risk notes
- rollout order

## Current Source-Of-Truth Nav Implementation

Verdict: `MATCH`

Reference pages checked:

- `cups.html`
- `tumblers.html`
- `accessories.html`

The category-page nav implementation is consistent across all three reference pages for the pieces relevant to this change:

- `Home` markup: `<a class="nav-link" href="index.html">Home</a>`
- `Account` markup: `<a class="nav-link" href="account.html">Account</a>`
- active item markup: `<span class="nav-link is-active">…</span>`
- inactive item markup: `<a class="nav-link" href="…">…</a>`
- nav wrapper: `<nav class="flex items-center gap-2 flex-wrap">`
- utility cluster placement: `<div class="nav-icon-cluster">…</div>` at the far right of the nav block
- utility-row break marker: `<span class="nav-break" aria-hidden="true"></span>`

Important implementation detail:

- `Home` and `Account` do not use `nav-label-full` / `nav-label-short` in the category pages
- only longer labels such as `Cups & Mugs` use the `nav-label-full` / `nav-label-short` pattern

## Exact New Sale-Family Nav Variant Definition

Verdict: `DRIFT`

Required final nav order:

1. `Home` -> `index.html`
2. `Deals for the Steal` -> `sale.html`
3. `Under $25 Items` -> `under-25.html`
4. `Last Chance - Seasonal` -> `last-chance.html`
5. `Account` -> `account.html`
6. utility icon cluster

Required placement notes:

- `Home` must sit to the left of `Deals for the Steal`
- `Account` must sit to the right of `Last Chance - Seasonal`
- `Account` must sit to the left of the favorites/cart/support icon cluster
- the existing `nav-break` should remain immediately before the icon cluster, not between the nav links

Recommended exact markup pattern:

```html
<nav class="flex items-center gap-2 flex-wrap">
  <a class="nav-link" href="index.html">Home</a>
  <!-- Sale-family page-specific active/inactive set -->
  <a class="nav-link" href="account.html">Account</a>
  <span class="nav-break" aria-hidden="true"></span>
  <div class="nav-icon-cluster">…</div>
</nav>
```

Sale-family item labeling:

- keep the current long labels as-is on desktop
- keep the current short labels on mobile:
  - `Deals`
  - `Under $25`
  - `Last Chance`

Home + Account labeling:

- keep the exact category-page pattern
- do not add `nav-label-full` / `nav-label-short` to `Home`
- do not add `nav-label-full` / `nav-label-short` to `Account`

## Active-State Rules By Page

Verdict: `MATCH`

Required active-state behavior:

- `sale.html`
  - active: `Deals for the Steal`
  - inactive anchors: `Home`, `Under $25 Items`, `Last Chance - Seasonal`, `Account`
- `under-25.html`
  - active: `Under $25 Items`
  - inactive anchors: `Home`, `Deals for the Steal`, `Last Chance - Seasonal`, `Account`
- `last-chance.html`
  - active: `Last Chance - Seasonal`
  - inactive anchors: `Home`, `Deals for the Steal`, `Under $25 Items`, `Account`

Notes:

- `Home` should stay a plain anchor on all three Sale-family pages
- `Account` should stay a plain anchor on all three Sale-family pages
- no Sale-family page should render `Home` or `Account` as active

## Required Order And Placement

Verdict: `MATCH`

The correct desktop order is:

`Home` -> `Deals for the Steal` -> `Under $25 Items` -> `Last Chance - Seasonal` -> `Account` -> icon cluster

The correct mobile intent is:

- same logical order
- icon cluster remains separated by `nav-break`
- short-label treatment remains only on the three longer Sale-family items

## Mobile / Responsive Risk Notes

Verdict: `UNKNOWN`

This is the only meaningful risk area for the change.

Why:

- the current Sale-family row has 3 nav items before the icon cluster
- the expanded Sale-family row will have 5 nav items before the icon cluster
- the Sale-family links are longer than the standard category labels, even with existing short-label handling for the 3 long items

What is known:

- the underlying shell CSS already supports wrapped nav layouts with `flex-wrap`
- the icon cluster already moves to its own row on mobile via `nav-break`
- `Home` and `Account` are short enough to keep the exact category-page anchor treatment

What is not yet proven:

- whether the current mobile spacing remains visually intentional on Sale-family pages after adding both `Home` and `Account`
- whether the 5-item pre-icon nav set should remain one wrapped flex group with current spacing, or whether a minor spacing adjustment will be needed for the pilot

Audit recommendation:

- treat this as a nav-row expansion only first
- expect runtime logic to remain unchanged
- verify mobile layout on `sale.html` before copying the change to the other two pages

## Runtime / Drawer Dependency Check

Verdict: `MATCH`

No drawer or runtime changes should be necessary if the update is implemented correctly.

Reason:

- `Home` and `Account` are plain nav anchors, not interactive utility hooks
- the favorites/cart/support icon cluster stays in the same position and uses the same existing shell/runtime hooks
- `commerce.js` and `favorites.js` do not depend on the specific text-link composition of the nav row

## Recommended Rollout Order

Verdict: `MATCH`

Recommended sequence:

1. pilot `sale.html`
2. if desktop + mobile parity is clean, roll the same nav-row expansion to `under-25.html`
3. then roll the same nav-row expansion to `last-chance.html`

## Final Recommendation

Verdict: `MATCH`

Use the current Sale-family header shell as-is and expand only the nav row.

Implementation should:

- copy the exact `Home` and `Account` anchor pattern from the category pages
- keep the current Sale-family `nav-label-full` / `nav-label-short` handling only on the three longer Sale-family items
- keep the icon cluster and `nav-break` where they are
- pilot on `sale.html` first because mobile density is the only real risk

No `commerce.js`, `favorites.js`, drawer-shell, or support-shell changes should be part of that rollout unless the pilot exposes an actual responsive layout issue.
