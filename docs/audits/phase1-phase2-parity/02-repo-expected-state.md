# 02 - Repo Expected State

## Objective
Define repo-derived parity expectations across storefront, admin, backend, deploy, and ops, and identify likely parity hotspots for Phase 1B/Phase 2 verification.

## Repo-expected state
### Storefront (repo-derived)
- Storefront is static HTML at repo root with route files including:
  - `index.html`, `new-arrivals.html`, `best-sellers.html`, `restock.html`, `sale.html`, `under-25.html`, `last-chance.html`, `tumblers.html`, `cups.html`, `accessories.html`, `customization.html`, `checkout.html`, `account.html`, `favorites.html`, plus `attire.html` and `doormats.html`.
- Commerce integration is implemented in `commerce.js` and loaded by storefront routes.
- Medusa integration expects page-level body attributes:
  - `data-medusa-enabled="true"`
  - `data-medusa-backend="https://api.lovettsldc.com"`
  - `data-medusa-publishable-key="..."`
- `commerce.js` includes storefront build markers:
  - `STOREFRONT_BUILD_SHA`
  - `STOREFRONT_BUILD_UTC`

### Admin Studio (repo-derived)
- Admin UI is a Vite React app under `admin-ui/` with protected routes via `RequireAuth` in `admin-ui/src/App.jsx`.
- Primary admin routes include:
  - `/login`, `/invite`, `/dashboard`, `/storefront-layout`, `/settings`, `/draft-orders/new`, `/products/new`
  - resource list/detail routes generated from `admin-ui/src/data/resources.js`.
- Admin API base is expected from `VITE_MEDUSA_BACKEND_URL`, defaulting to `https://api.lovettsldc.com` in `admin-ui/src/lib/api.js`.
- Session behavior expects cookie-backed auth (`credentials: 'include'`) and `/auth/session` after `/auth/user/emailpass` login.

### Backend (repo-derived)
- Medusa config in `medusa-backend/medusa-config.ts` defines CORS using env plus default origins:
  - `http://127.0.0.1:5501`, `http://localhost:5174`, `https://admin.lovettsldc.com`, `https://lovettsldc.com`, `https://www.lovettsldc.com`, `https://ldc-8kg.pages.dev`.
- `admin.disable = true` in backend config.
- Payment provider surface includes PayPal provider `id: "paypal"` via `./src/providers/paypal/index.ts`.
- Notification provider surface includes conditional SendGrid provider when required env vars are present.

### Deploy path (repo-derived)
- GitHub Actions deploy workflow is manual (`workflow_dispatch`) in `.github/workflows/deploy-backend.yml`.
- Deploy path expects SSM execution of `/home/ubuntu/ldc-medusa/scripts/deploy-medusa.sh` on target instance.
- Fallback path uses SSH-over-SSM to run the same deploy script.
- Post-deploy check expects `https://api.lovettsldc.com/health` to succeed.

### Ops/runbook expectations (repo-derived)
- `ops/scripts/phase1_storage_hardening.sh` and `ops/runbooks/phase1a-storage-hardening.md` define system hardening and explicitly require Medusa ownership on systemd `medusa-backend` with PM2 not serving Medusa.
- `ops/scripts/phase1b_monitoring_backups.sh` and runbook define monitoring and backup guardrails (CloudWatch, alarms, snapshots) without app code changes.
- `ops/scripts/phase2_e2e_commerce_verification.sh` and runbook define parity/e2e verification workflow and local artifact generation.

### Likely parity hotspots (repo-derived hypotheses)
- Storefront/backend URL consistency across all HTML bodies and `commerce.js` runtime fallbacks.
- Storefront section-key alignment between HTML (`data-section-key`) and `commerce.js` managed section keys.
- Admin session behavior and CORS/cookie behavior against configured backend origins.
- Runtime ownership drift risk (`medusa-backend` systemd vs accidental PM2 process ownership).
- CORS origin drift between deployed env values and defaults embedded in `medusa-config.ts`.
- Checkout/payment surface drift between storefront expectations and backend provider configuration.

## Manual evidence to capture later
- Confirm runtime ownership on the host (systemd active, PM2 not owning Medusa process).
- Confirm `/health` response and header/body stability from production endpoint.
- Confirm admin and storefront origin behavior in browser network traces.
- Confirm deploy workflow behavior from latest successful Actions run metadata.

## Findings
- Repo-derived expected state captured from source files and runbooks.
- Live parity verification is not yet executed; hotspot outcomes remain `UNKNOWN`.

## Status
- Repo-derived expected state capture: `MATCH`
- Live/runtime parity verification: `UNKNOWN`

## Risk
- Repo assumptions may drift from deployed runtime if environment values or host ownership changed outside git history.

## Next action
- Convert hotspot hypotheses into evidence-backed outcomes in `03`-`05` and register drifts in `06-drift-register.md`.

## Blockers
- Live environment access is required for runtime ownership, health, and browser-network confirmation.

## Signoff
- Reviewer:
- Date:
- Decision:
