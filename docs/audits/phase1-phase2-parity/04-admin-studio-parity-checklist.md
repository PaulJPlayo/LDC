# 04 - Admin Studio Parity Checklist

## Objective
Capture Admin Studio parity expectations from repo code and separate documented known gaps from possible live drift.

## Repo-expected state
### Route/screen inventory (repo)
- Core routes from `admin-ui/src/App.jsx`:
  - `/login`
  - `/invite`
  - `/dashboard`
  - `/storefront-layout`
  - `/settings`
  - `/draft-orders/new`
  - `/products/new`
- Resource routes generated from `admin-ui/src/data/resources.js` include (list/detail):
  - `/orders`, `/draft-orders`, `/returns`, `/exchanges`, `/gift-cards`
  - `/return-reasons`, `/refund-reasons`
  - `/products`, `/variants`, `/collections`, `/categories`, `/product-types`, `/product-tags`
  - `/price-lists`, `/promotions`, `/campaigns`
  - `/customers`, `/customer-groups`
  - `/inventory`, `/stock-locations`
  - `/regions`, `/shipping-profiles`, `/shipping-options`, `/tax-regions`, `/tax-rates`
  - `/users`, `/invites`, `/api-keys`, `/notifications`, `/stores`, `/sales-channels`, `/uploads`

### Expected auth/session behavior (repo)
- `RequireAuth` gate redirects anonymous users to `/login`.
- Auth provider lifecycle (`admin-ui/src/state/auth.jsx`):
  - initial status `checking`
  - calls `getCurrentUser()` on boot
  - status transitions to `authenticated` or `anonymous`
- Login flow (`admin-ui/src/lib/api.js`):
  - `POST /auth/user/emailpass` to obtain token
  - `POST /auth/session` with bearer token to establish cookie-backed session
- Session-bearing API requests use `credentials: 'include'`.
- Logout calls `DELETE /auth/session` and clears local auth state.

### Backend URL expectations (repo)
- Admin API base is `VITE_MEDUSA_BACKEND_URL` or default `https://api.lovettsldc.com`.
- Admin README expects Cloudflare Pages env to set `VITE_MEDUSA_BACKEND_URL=https://api.lovettsldc.com`.
- Store API helper in admin client optionally uses `VITE_MEDUSA_PUBLISHABLE_KEY` for store endpoints.

### Known documented gaps (from `docs/admin-parity-audit.md`)
- Role enforcement not implemented (member/admin permissions not gated).
- Fulfillment set/service zone management UI is minimal.
- Notifications management lacks mark read/clear controls.
- Media gallery controls are simpler than Medusa Admin.
- Some screens depend on backend provider configuration and may error if providers are missing.

### Possible live drift to verify later (not yet validated)
- Session persistence behavior in deployed admin environment (cookie/CORS behavior).
- Route-level data loading parity across all resources and detail pages.
- Dashboard metrics and operational widgets against current backend data.
- Draft order and product-creation flows under real data and permissions.

## Manual evidence to capture later
- Login/session flow capture (redirects, cookies/session behavior, logout).
- Screen captures for dashboard, settings, storefront-layout, draft order create, product create.
- Resource list/detail checks for high-impact routes (orders/products/inventory/regions/shipping/tax/users).
- API/network evidence for failed calls and status codes where drift is suspected.

## Findings
- Live admin parity checks completed for the listed check set.
- No confirmed admin `DRIFT` items were identified in this pass.

### Completed check results
- `MATCH`:
  - `login-page-load`
  - `login-success`
  - `session-persist-after-refresh`
  - `dashboard-load`
  - `storefront-layout-load`
  - `settings-load`
  - `orders-list-load`
  - `products-list-load`
  - `inventory-list-load`
  - `draft-order-create-load`
  - `product-create-load`
  - `logout-flow`

### Auth bootstrap note
- One early `401` on `me?fields=+metadata` occurred before auth/session establishment.
- Subsequent authenticated requests succeeded.
- Classification: non-blocking auth bootstrap behavior, not confirmed drift.

### Network target behavior
- Admin network requests hit `api.lovettsldc.com`: `MATCH`.
- No visible blank states or blocking errors during checked flows: `MATCH`.

## Status
- Repo inventory and expectation capture: `MATCH`
- Live admin check set: `MATCH`
- Confirmed admin drift items: none in this pass
- Broader route coverage outside the completed check set: `UNKNOWN`

## Risk
- Residual risk remains in admin routes not included in this check pass and in known documented feature gaps.

## Next action
- Expand validation to remaining lower-priority resource routes not covered in this pass.
- Keep known documented gaps tracked separately from new drift findings.

## Blockers
- No blockers for completed admin checks.
- Full admin route coverage is still incomplete.

## Signoff
- Reviewer:
- Date:
- Decision:
