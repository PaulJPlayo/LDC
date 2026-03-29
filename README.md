# LDC

LDC is a multi-part ecommerce platform, not a placeholder landing page scaffold. This repository contains the public storefront at the repo root, a separate custom Admin Studio in `admin-ui/`, and a separate Medusa backend in `medusa-backend/`.

The current phase is late-stage parity, QA, and release-hardening. Favor targeted fixes, verification, and shared-runtime improvements over broad feature work.

## Project Overview

- Public storefront routes and assets live at the repo root.
- Shared storefront behavior is centered in `commerce.js` and `favorites.js`.
- `admin-ui/` contains the custom LDC Admin Studio.
- `medusa-backend/` contains the Medusa API, data, and integration logic.

## Live Systems

- Public storefront: `https://lovettsldc.com/`
- Customization route: `https://lovettsldc.com/customization`
- Favorites page: `https://lovettsldc.com/favorites`
- Checkout page: `https://lovettsldc.com/checkout`
- Admin Studio: `https://admin.lovettsldc.com`
- Backend API: `https://api.lovettsldc.com`
- Backend health endpoint: `https://api.lovettsldc.com/health`

## Repository Structure

```text
.
├── admin-ui/          # Custom Admin Studio (Vite + React)
├── docs/              # Audits, verification notes, implementation plans
├── medusa-backend/    # Medusa backend
├── scripts/           # Repo utilities and support scripts
├── commerce.js        # Shared storefront commerce runtime
├── favorites.js       # Shared favorites state/runtime
├── favorites-theme.css
├── product-map.json
└── *.html             # Storefront route pages served from the repo root
```

## Storefront Architecture

- Storefront routes are static HTML pages at the repo root, with shared runtime behavior layered on top.
- `commerce.js` owns the shared commerce layer: Medusa connectivity, cart lifecycle, product-map-driven rendering, shared product-tile behavior, and checkout/cart hydration.
- `favorites.js` owns canonical favorites state in browser storage (`ldc:favorites`) and keeps tile hearts, drawer UI, the favorites page, and move-to-cart behavior synchronized.
- `favorites-theme.css` provides the shared favorites presentation used by drawer and page-level favorites UI.
- Prefer shared runtime changes over page-local duplicated logic when storefront behavior needs to change.

## Local Development

### Root storefront

Run these commands from the repo root:

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run test:shipping-money`
- `npm run instagram:fetch`

Notes:

- `npm run dev` watches `src/styles.css` and writes to `styles.css`.
- `npm run build` builds `styles.css` and updates the storefront build marker in `commerce.js`. Avoid casual root builds during docs-only work if you do not intend to refresh that marker.

### Admin Studio

Run these commands from `admin-ui/`:

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

Optional local env setup:

- `cp .env.example .env`

`VITE_MEDUSA_BACKEND_URL` defaults to `https://api.lovettsldc.com`.

### Medusa backend

Run these commands from `medusa-backend/`:

- `npm install`
- `npm run dev`
- `npm run start`
- `npm run build`
- `npm run seed`
- `npm run send:test-email`
- `npm run test:unit`
- `npm run test:integration:http`
- `npm run test:integration:modules`

The backend declares `node >=20`.

## Deployment Model

- Storefront production branch: `main`
- Storefront deploy path: `main` -> Cloudflare Pages -> `https://lovettsldc.com`
- Admin Studio is a separate deploy target rooted at `admin-ui/`
- Backend deploy path is separate from storefront changes
- `.github/workflows/deploy-backend.yml` defines a manual GitHub Actions deploy that runs `/home/ubuntu/ldc-medusa/scripts/deploy-medusa.sh` via AWS SSM, with SSH-over-SSM fallback
- Backend deploy validation ends with `https://api.lovettsldc.com/health`
- Medusa runtime is expected to be owned by systemd service `medusa-backend`; PM2 must not run Medusa

## Working Rules

- Work one scoped branch or prompt at a time
- Prefer shared runtime updates in `commerce.js` and `favorites.js` over duplicating logic across route pages
- Do not casually edit `admin-ui/` or `medusa-backend/` during storefront-only work
- Verify the relevant live routes after deploy
- If production looks stale, confirm the intended commit is on `main` before considering any retrigger

## Notes / Guardrails

- Never commit secrets or environment values
- Do not claim commit, push, deploy, or verification success unless it actually happened
- Keep audit docs under `docs/audits/`
- Keep local artifacts gitignored and out of normal source changes
