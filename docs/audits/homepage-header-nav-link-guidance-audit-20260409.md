# Homepage Header Nav Title Link Guidance Audit - 2026-04-09

## 1. Audit objective

Audit-only discovery for the homepage header in `index.html`. No storefront runtime file was changed.

Business target for the future implementation:

- Shop title -> Tumblers
- Trending title -> New Arrivals
- Sale title -> Deals for the Steal

Audit status: MATCH. The local `index.html` homepage header and cache-busted live homepage behavior materially agree for the scoped Shop, Trending, and Sale controls.

## 2. Files read

- `README.md`
- `AGENTS.md`
- `index.html`
- `docs/audits/*.md` via targeted `rg -n "homepage|nav|header" README.md AGENTS.md docs/audits -g "*.md"`

Commands run for discovery included:

- `rg -n "Shop|Trending|Sale|Tumblers|New Arrivals|Deals for the Steal" index.html`
- `rg -n "primary-nav|dropdown-panel|group-focus-within|tile-title" index.html`
- `rg -n "header-menu|data-menu|data-menu-toggle|data-menu-panel|data-menu-collapsible|data-menu-collapsible-toggle|data-menu-submenu" index.html`
- `rg -n "#section-1|#section-2|href=\"#\"|tumblers.html|new-arrivals.html|sale.html|customization.html" index.html`
- `rg -n "menuLinks|submenuPanels|submenuToggles|closeAllSubmenus|MENU_BREAKPOINT|aria-expanded" index.html`

## 3. Current desktop behavior

Desktop implementation surface: `index.html` lines 2801-2835.

Responsive state:

- `.primary-nav` is visible at desktop widths via the `@media (min-width: 768px)` block at lines 1618-1624.
- `.primary-nav` is hidden below 768px by lines 1559-1562.
- Live cache-busted desktop check at 1280px reported `primaryDisplay: "flex"` and `headerMenuDisplay: "none"`.

Current desktop title controls:

```html
<div class="group relative">
  <a href="#section-1" class="inline-flex items-center tile-title hover:text-brand-700 focus:outline-none">Shop</a>
  <div class="invisible opacity-0 translate-y-1 origin-top scale-95 hover:visible hover:opacity-100 hover:translate-y-0 hover:scale-100 group-hover:visible group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 group-focus-within:visible group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:scale-100 transition ease-out duration-700 absolute left-1/2 -translate-x-1/2 top-full mt-0 w-56 rounded-2xl border border-slate-200 bg-white shadow-xl dropdown-panel transform">
```

```html
<div class="group relative">
  <a href="#section-2" class="inline-flex items-center tile-title hover:text-brand-700 focus:outline-none">Trending</a>
  <div class="invisible opacity-0 translate-y-1 origin-top scale-95 hover:visible hover:opacity-100 hover:translate-y-0 hover:scale-100 group-hover:visible group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 group-focus-within:visible group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:scale-100 transition ease-out duration-700 absolute left-1/2 -translate-x-1/2 top-full mt-0 w-56 rounded-2xl border border-slate-200 bg-white shadow-xl dropdown-panel transform">
```

```html
<div class="group relative">
  <a href="#" class="inline-flex items-center tile-title hover:text-brand-700 focus:outline-none">Sale</a>
  <div class="invisible opacity-0 translate-y-1 origin-top scale-95 hover:visible hover:opacity-100 hover:translate-y-0 hover:scale-100 group-hover:visible group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 group-focus-within:visible group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:scale-100 transition ease-out duration-700 absolute left-1/2 -translate-x-1/2 top-full mt-0 w-56 rounded-2xl border border-slate-200 bg-white shadow-xl dropdown-panel transform">
```

Current desktop submenu wrappers are sibling `.dropdown-panel` containers inside each `.group relative` wrapper. They are not JS-driven. They are hidden by default through utility classes and shown by `hover:*`, `group-hover:*`, and `group-focus-within:*`.

Live desktop click behavior, cache-busted URL `https://lovettsldc.com/?cb=1775793820110`:

- MATCH: Shop title click navigated to `https://lovettsldc.com/?cb=1775793820110#section-1`; scrollY 144.
- MATCH: Trending title click navigated to `https://lovettsldc.com/?cb=1775793820110#section-2`; scrollY 774.
- MATCH: Sale title click navigated to `https://lovettsldc.com/?cb=1775793820110#`; hash read as empty; scrollY 0.

Live desktop submenu access:

- MATCH: Shop panel was `visibility: hidden`, `opacity: 0` before interaction; hover made it visible; focus on the title made it visible through `group-focus-within`.
- MATCH: Trending panel followed the same hover and focus-visible pattern.
- MATCH: Sale panel followed the same hover and focus-visible pattern.

Desktop current submenu destinations:

- Shop submenu: Tumblers -> `tumblers.html`; Cups & Mugs -> `cups.html`; Accessories -> `accessories.html`; Attire -> `attire.html`; Doormats -> `doormats.html`.
- Trending submenu: New Arrivals -> `new-arrivals.html`; Best Sellers -> `best-sellers.html`; Restock -> `restock.html`.
- Sale submenu: Deals for the Steal -> `sale.html`; Under $25 Items -> `under-25.html`; Last Chance - Seasonal -> `last-chance.html`.

## 4. Current menu/mobile behavior

Menu/mobile implementation surface: `index.html` lines 2749-2799.

Responsive state:

- `.header-menu` defaults to `display: none` at lines 1413-1416.
- At max-width 767px, `.header-menu` becomes `inline-flex` at lines 1563-1566.
- Live narrow check at 390px reported `primaryDisplay: "none"` and `headerMenuDisplay: "flex"`.

Current menu shell:

```html
<div class="header-menu" data-menu>
  <button type="button" class="header-menu-toggle" data-menu-toggle aria-expanded="false" aria-controls="headerMenuPanel" aria-label="Open navigation menu">
```

Current menu/mobile title controls:

```html
<button type="button" class="header-menu-toggle-link tile-title" data-menu-collapsible-toggle="shop">
  <span>Shop</span>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9 6 6 6-6"/></svg>
</button>
<div class="header-menu-submenu space-y-1" data-menu-submenu="shop" hidden>
```

```html
<button type="button" class="header-menu-toggle-link tile-title" data-menu-collapsible-toggle="trending">
  <span>Trending</span>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9 6 6 6-6"/></svg>
</button>
<div class="header-menu-submenu space-y-1" data-menu-submenu="trending" hidden>
```

```html
<button type="button" class="header-menu-toggle-link tile-title" data-menu-collapsible-toggle="sale">
  <span>Sale</span>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9 6 6 6-6"/></svg>
</button>
<div class="header-menu-submenu space-y-1" data-menu-submenu="sale" hidden>
```

Current menu/mobile behavior:

- MATCH: Shop, Trending, and Sale titles are `<button type="button">` controls, not anchors.
- MATCH: The title itself expands/collapses only. It has no `href`.
- MATCH: The submenu panel is separate and keyed by `data-menu-submenu="shop"`, `data-menu-submenu="trending"`, or `data-menu-submenu="sale"`.
- MATCH: The menu toggle owns `aria-expanded`, `aria-controls="headerMenuPanel"`, and its open/close label.
- DRIFT: The submenu toggle buttons do not currently expose `aria-expanded` or `aria-controls`.
- MATCH: Live title clicks at 390px left `location.href` unchanged and opened the corresponding submenu id.
- MATCH: Live menu link close behavior was verified by preventing navigation only for observation on the Shop -> Tumblers submenu link; the existing link click handler closed the menu, set `data-menu-panel.hidden` to true, set menu `aria-expanded` to `false`, and cleared open submenu ids.

Current menu/mobile submenu destinations:

- Shop submenu: Tumblers -> `tumblers.html`; Cups & Mugs -> `cups.html`; Accessories -> `accessories.html`; Attire -> `attire.html`; Doormats -> `doormats.html`.
- Trending submenu: New Arrivals -> `new-arrivals.html`; Best Sellers -> `best-sellers.html`; Restock -> `restock.html`.
- Sale submenu: Deals for the Steal -> `sale.html`; Under $25 Items -> `under-25.html`; Last Chance - Seasonal -> `last-chance.html`.

## 5. Relevant selectors / JS dependencies

Relevant CSS selectors and responsive selectors:

- `.header-menu` at lines 1413-1416.
- `.header-menu-toggle` at lines 1417-1436.
- `.header-menu-panel` at lines 1437-1449.
- `.header-menu-collapsible` at lines 1453-1462.
- `.header-menu-toggle-link` at lines 1463-1478.
- `.header-menu-toggle-link svg` at lines 1479-1488.
- `.header-menu-submenu` and `.header-menu-submenu[hidden]` at lines 1495-1500.
- `.header-menu-panel[hidden]` at lines 1522-1524.
- `.primary-nav` hidden below 768px at lines 1559-1562.
- `.header-menu` visible below 768px at lines 1563-1566.
- `.primary-nav` visible at 768px and above at lines 1618-1624.

Homepage-local JS dependency block: `index.html` lines 3924-4055.

Relevant current JS:

```js
const headerMenu = document.querySelector('[data-menu]');
const menuToggle = document.querySelector('[data-menu-toggle]');
const menuPanel = document.querySelector('[data-menu-panel]');
const menuLinks = menuPanel?.querySelectorAll('a');
const submenuPanels = menuPanel?.querySelectorAll('[data-menu-submenu]');
const submenuToggles = menuPanel?.querySelectorAll('[data-menu-collapsible-toggle]');
const MENU_BREAKPOINT = 768;
```

```js
const setMenuState = isOpen => {
  menuIsOpen = isOpen;
  if (!menuPanel || !menuToggle) return;
  menuPanel.hidden = !isOpen;
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
  headerMenu?.classList.toggle('is-open', isOpen);
```

```js
menuLinks?.forEach(link => {
  link.addEventListener('click', () => closeMenu());
});
const closeAllSubmenus = () => {
  submenuPanels?.forEach(panel => {
    panel.setAttribute('hidden', '');
    const group = panel.closest('[data-menu-collapsible]');
    group?.classList.remove('is-open');
  });
};
const closeMenu = () => {
  setMenuState(false);
  closeAllSubmenus();
};
```

```js
submenuToggles?.forEach(toggle => {
  toggle.addEventListener('click', event => {
    event.preventDefault();
    const id = toggle.getAttribute('data-menu-collapsible-toggle');
    if (!id) return;
    const panel = menuPanel?.querySelector(`[data-menu-submenu="${id}"]`);
    if (!panel) return;
    const group = toggle.closest('[data-menu-collapsible]');
    const isOpen = !panel.hasAttribute('hidden');
    closeAllSubmenus();
    if (!isOpen) {
      panel.removeAttribute('hidden');
      group?.classList.add('is-open');
    }
  });
});
```

```js
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    ...
  } else if (event.key === 'Tab' && menuIsOpen && menuPanel && !menuPanel.hidden) {
    const focusable = menuLinks ? Array.from(menuLinks) : [];
```

Accessibility impact:

- Desktop title controls are anchors. Enter activates the current `href`; focus on the anchor opens the panel through CSS `group-focus-within`; Tab can continue into submenu links while the group has focus within.
- Menu/mobile title controls are buttons. Enter/Space activate the current JS submenu toggle behavior and do not navigate.
- Current menu submenu toggles lack `aria-expanded` and `aria-controls`, so screen reader state for each submenu is DRIFT relative to the recommended accessible split-control pattern.
- Current Tab trap uses `menuLinks` only, which excludes menu buttons. That is a dependency to fix if the pilot introduces separate chevron buttons and title anchors.

## 6. Confirmed target mapping

Source-of-truth future mapping:

- Shop title -> Tumblers -> `tumblers.html` in source; live `/tumblers` canonical works.
- Trending title -> New Arrivals -> `new-arrivals.html` in source; live `/new-arrivals` canonical works.
- Sale title -> Deals for the Steal -> `sale.html` in source; live `/sale` canonical works.

Live route checks, cache-busted at `cb=1775793820110`:

- MATCH: `https://lovettsldc.com/tumblers?cb=1775793820110` -> 200, final URL unchanged, title `Tumblers`, h1 `Tumblers customized to your style.`
- MATCH: `https://lovettsldc.com/new-arrivals?cb=1775793820110` -> 200, final URL unchanged, title `New Arrivals`, h1 `New Arrivals, curated by L.D.C.`
- MATCH: `https://lovettsldc.com/sale?cb=1775793820110` -> 200, final URL unchanged, title `Sale`, h1 `Sale Spotlight`
- MATCH: `https://lovettsldc.com/tumblers.html?cb=1775793820110` -> 200, final URL `https://lovettsldc.com/tumblers?cb=1775793820110`
- MATCH: `https://lovettsldc.com/new-arrivals.html?cb=1775793820110` -> 200, final URL `https://lovettsldc.com/new-arrivals?cb=1775793820110`
- MATCH: `https://lovettsldc.com/sale.html?cb=1775793820110` -> 200, final URL `https://lovettsldc.com/sale?cb=1775793820110`

## 7. Root-cause / risk class

Desktop root-cause class: simple href update with low structural risk.

- The desktop title is already an anchor.
- Submenu access is CSS hover/focus-within driven and should remain intact if the title `href` changes to `tumblers.html`, `new-arrivals.html`, or `sale.html`.

Menu/mobile root-cause class: structural split-control change plus accessibility-sensitive menu JS update.

- The mobile title is currently the submenu button; changing it directly into an anchor would remove the current expand target.
- Preserving submenu access requires an anchor title plus a separate chevron/button control, or equivalent split row.
- The split button should expose `aria-expanded` and `aria-controls`.
- The menu focus-trap logic should be updated from anchor-only `menuLinks` to all visible/focusable menu controls inside the panel.

No hard-stop condition was found:

- MATCH: The behavior is driven by `index.html`, not a hidden shared include for the scoped homepage header.
- MATCH: Live production and local `index.html` materially agree for the scoped controls.
- MATCH: No evidence says this requires `commerce.js`, `favorites.js`, non-homepage route shells, admin, backend, or a global nav rewrite.

## 8. Recommended Shop pilot pattern

Use Shop as the Phase 2 pilot.

Desktop Shop pilot:

- Change only the desktop Shop title anchor from `href="#section-1"` to `href="tumblers.html"` in `index.html`.
- Keep the existing `.group relative` wrapper.
- Keep the existing sibling `.dropdown-panel` submenu markup and submenu inventory unchanged.
- Keep the existing hover, group-hover, and group-focus-within classes unchanged.
- Expected behavior: click/Enter on Shop navigates to Tumblers; hover/focus still exposes the Shop submenu; Tab can still reach Tumblers, Cups & Mugs, Accessories, Attire, and Doormats in the dropdown.

Menu/mobile Shop pilot:

- Do not replace the current Shop button with a single anchor.
- Use a split-control row in `index.html`: a Shop title anchor to `tumblers.html` plus a separate chevron button that retains `data-menu-collapsible-toggle="shop"`.
- Give the Shop submenu an id, for example `id="headerMenuSubmenuShop"`.
- Give the chevron button `aria-controls="headerMenuSubmenuShop"` and dynamic `aria-expanded`.
- Update `closeAllSubmenus()` to reset submenu toggle `aria-expanded` to `false`.
- Update the submenu click handler to set the active toggle `aria-expanded` to `true` when its panel opens.
- Update the menu focusable list used for Tab wrapping so it includes menu anchors and menu buttons, not only `menuLinks`.
- Keep `menuLinks?.forEach(link => link.addEventListener('click', () => closeMenu()))` behavior for anchors, so clicking the new Shop title anchor closes the menu before navigation.

## 9. Recommended allowed files for Phase 2

Recommended Phase 2 file surface: `index.html` only.

Do not touch in Phase 2:

- `commerce.js`
- `favorites.js`
- `customization.html`
- `checkout.html`
- `favorites.html`
- `account.html`
- `tumblers.html`
- `new-arrivals.html`
- `sale.html`
- `admin-ui/**`
- `medusa-backend/**`
- `package.json`
- `package-lock.json`
- workflow files
- environment files
- external CSS files

If the pilot needs CSS for the split-control row, keep it homepage-local inside the existing `index.html` style surface and make it minimal.

## 10. Live URLs checked

- `https://lovettsldc.com/?cb=1775793820110`
- `https://lovettsldc.com/tumblers?cb=1775793820110`
- `https://lovettsldc.com/new-arrivals?cb=1775793820110`
- `https://lovettsldc.com/sale?cb=1775793820110`
- `https://lovettsldc.com/tumblers.html?cb=1775793820110`
- `https://lovettsldc.com/new-arrivals.html?cb=1775793820110`
- `https://lovettsldc.com/sale.html?cb=1775793820110`

Live verification method:

- Headless Google Chrome via Chrome DevTools Protocol.
- Desktop viewport: 1280 x 900.
- Narrow/menu viewport: 390 x 844.
- No deploy was run.
- No production files were modified.

## 11. Repo changes made

Runtime changes: none.

Production storefront file changes: none.

Audit documentation change:

- Added `docs/audits/homepage-header-nav-link-guidance-audit-20260409.md`.

Validation to run before concluding:

- `git status --short --branch`
- `git diff --check`

## 12. Go / no-go recommendation for the Shop pilot prompt

GO for Shop pilot, with scope guardrails.

Recommended rollout order:

1. Phase 2: Shop pilot in `index.html` only.
2. Run focused desktop and menu/mobile validation for Shop.
3. Parity finish only if the split-control row exposes a desktop/mobile/accessibility issue.
4. Roll out the same proven pattern to Trending -> New Arrivals and Sale -> Deals for the Steal in `index.html`.
5. Final live audit with cache-busted desktop and narrow-menu checks.

No-go conditions for Phase 2:

- Do not proceed if the prompt expands beyond `index.html`.
- Do not proceed if the implementation requires touching `commerce.js`, `favorites.js`, route shells, admin, backend, or external CSS files.
- Do not proceed if submenu access cannot be preserved through a narrow split-control pattern.
