# Account Auth and Customer Session Contract Diagnosis

Date: 2026-04-27
Branch: `diagnosis/account-auth-session-contract`
Base: `origin/main` at `50df50e`

## 1. Executive summary

Overall verdict: `DRIFT`.

The live LDC backend is Medusa v2.12.3, and both installed backend source plus live endpoint checks show the expected customer-auth model is Medusa v2 auth routes under `/auth/customer/emailpass`, with either JWT bearer replay or cookie session via `/auth/session`. The current Account page uses legacy/v1-style storefront endpoints for auth (`/store/auth`) and an order-history endpoint that is not present in the installed Medusa v2 store API (`/store/customers/me/orders`).

The root issue is not just `credentials: 'omit'`. The Account implementation has an endpoint mismatch, missing token/session handling, missing logout behavior, and an order-history endpoint mismatch. Backend CORS for the expected v2 routes appears configured and live-enabled for `https://lovettsldc.com`.

No credentials were provided. No Account form was submitted. No customer account, order, backend, or Admin Studio action was taken.

## 2. Git/base-state note

Required git checks were run.

- Starting branch: `audit/account-page-usability-data-handling`
- Worktree before branch creation: clean
- `git fetch origin`: completed
- `git rev-parse main`: `c47b313d1dc03db5b102b63bb9bd1d3ecf236dd7`
- `git rev-parse origin/main`: `50df50e1947c8650266a4512538c5df157647169`

Local `main` remains diverged from `origin/main`.

- Local-only commit: `c47b313 docs: add mini cart regression audit`
- Remote-only chain includes the doormats/attire parity work and `50df50e Add custom routes to continue shopping targets`

The diagnosis branch was created from detached `origin/main`:

```bash
git switch --detach origin/main
git switch -c diagnosis/account-auth-session-contract
```

Local `main` was not reset, rebased, merged, or otherwise changed.

Previous audit read:

- `docs/audits/account-page-usability-data-handling-audit.md` was read from `origin/audit/account-page-usability-data-handling` using `git show`.
- The previous audit branch was not merged.

## 3. Medusa version and auth contract

Version evidence:

- `medusa-backend/package.json` pins:
  - `@medusajs/medusa`: `2.12.3`
  - `@medusajs/framework`: `2.12.3`
  - `@medusajs/admin-sdk`: `2.12.3`
  - `@medusajs/cli`: `2.12.3`
- `medusa-backend/node_modules/@medusajs/medusa/package.json` reports `2.12.3`.
- `medusa-backend/README.md` says the starter is compatible with Medusa versions `>= 2`.

Expected customer login/auth endpoints from installed Medusa v2.12.3 source:

- `POST /auth/customer/emailpass`
  - Route source: `medusa-backend/node_modules/@medusajs/medusa/dist/api/auth/[actor_type]/[auth_provider]/route.js`
  - On success, returns `{ token }`.
- `POST /auth/customer/emailpass/register`
  - Route source: `medusa-backend/node_modules/@medusajs/medusa/dist/api/auth/[actor_type]/[auth_provider]/register/route.js`
  - On success, returns a registration JWT token.
- `POST /auth/session`
  - Route source: `medusa-backend/node_modules/@medusajs/medusa/dist/api/auth/session/route.js`
  - Requires bearer auth and stores `req.auth_context` in `req.session.auth_context`.
- `DELETE /auth/session`
  - Destroys the session.
- `POST /auth/token/refresh`
  - Route source: `medusa-backend/node_modules/@medusajs/medusa/dist/api/auth/token/refresh/route.js`
  - Returns a refreshed JWT token.

Expected logged-in customer endpoints from installed Medusa v2.12.3 source:

- `POST /store/customers`
  - Route source: `medusa-backend/node_modules/@medusajs/medusa/dist/api/store/customers/route.js`
  - Middleware source requires customer auth with `["session", "bearer"]` and `allowUnregistered: true`.
  - Validator source for `StoreCreateCustomer` accepts customer profile fields such as `email`, `first_name`, `last_name`, `phone`, `metadata`; it does not accept `password`.
- `GET /store/customers/me`
  - Route source: `medusa-backend/node_modules/@medusajs/medusa/dist/api/store/customers/me/route.js`
  - Middleware source requires customer auth with `["session", "bearer"]`.
- `GET /store/orders`
  - Route source: `medusa-backend/node_modules/@medusajs/medusa/dist/api/store/orders/route.js`
  - Middleware source requires customer auth with `["session", "bearer"]`.
  - The route filters orders by `customer_id: req.auth_context.actor_id`.

Expected auth method:

- Medusa supports two storefront customer approaches:
  - JWT bearer: get a token from `/auth/customer/emailpass`, then pass `Authorization: Bearer {token}` to authenticated requests.
  - Cookie session: get a token from `/auth/customer/emailpass`, then `POST /auth/session` with `Authorization: Bearer {token}` and use `credentials: 'include'` on later requests.
- Official Medusa docs confirm both methods for customer login and state that non-JS-SDK storefronts must pass either bearer authorization or `credentials: include` depending on the chosen auth method.
- Official Medusa docs confirm registration should call `/auth/customer/emailpass/register`, then create the customer while passing the registration token.

Publishable API key:

- Store API routes require the publishable key for storefront requests. `commerce.js` attaches `x-publishable-api-key` to every `/store/*` request.
- Auth routes under `/auth/*` are not store routes and are not the place where the publishable key solves customer session state.

## 4. Current storefront Account implementation

Shared request helper:

- Function: `request(path, options = {})`
- URL: `${backendUrl}${path}`
- Headers:
  - `Content-Type: application/json`
  - `x-publishable-api-key` for paths starting with `/store/`
- Credentials mode: `options.credentials || 'omit'`
- Token handling: none
- Session handling: none

`handleSignIn`:

- Endpoint: `POST /store/auth`
- Body: `{ email, password }`
- Headers: content type plus publishable key because path starts with `/store/`
- Credentials mode: inherited `omit`
- Token/session handling: none
- Expected by code: success message, then `ldc:auth:change`, then Account reloads profile/orders.
- Diagnosis: endpoint mismatch. Live `OPTIONS /store/auth` returns `404`; live `GET /store/auth` returns `Cannot GET /store/auth`. Installed Medusa v2 source defines customer email/password auth at `/auth/customer/emailpass`, not `/store/auth`.

`handleSignUp`:

- Endpoint 1: `POST /store/customers`
- Body: `{ email, password, first_name, last_name }`
- Endpoint 2: `POST /store/auth`
- Credentials mode: inherited `omit`
- Token/session handling: none
- Expected by code: create customer, then sign in, then `ldc:auth:change`.
- Diagnosis: endpoint and payload mismatch. Medusa v2 expects registration token flow first through `/auth/customer/emailpass/register`; `POST /store/customers` requires customer auth middleware with bearer/session and `allowUnregistered: true`; the customer create validator does not include `password`.

`getCustomer`:

- Endpoint: `GET /store/customers/me`
- Credentials mode: inherited `omit`
- Authorization header: none
- Publishable key: yes
- Diagnosis: endpoint is correct for Medusa v2, but the request is unauthenticated because there is no bearer token and no cookie session included. Live logged-out result is `401`.

`getOrders`:

- Endpoint: `GET /store/customers/me/orders`
- Credentials mode: inherited `omit`
- Authorization header: none
- Publishable key: yes
- Diagnosis: endpoint mismatch. Installed Medusa v2.12.3 store order route is `GET /store/orders`, protected by customer auth and filtered by `req.auth_context.actor_id`. No installed route exists under `store/customers/me/orders`. Live `OPTIONS /store/customers/me/orders` returns `401`, while `OPTIONS /store/orders` returns `204` with CORS headers.

Logout:

- No Account logout control was found.
- No storefront logout helper was found.
- For cookie sessions, expected logout is `DELETE /auth/session` with `credentials: 'include'`.
- For JWT bearer, logout would at minimum clear the stored token.

## 5. Current backend/session/CORS configuration

Backend config:

- `medusa-backend/medusa-config.ts` computes:
  - `storeCors`
  - `adminCors`
  - `authCors`
- Default origins added by source include:
  - `https://lovettsldc.com`
  - `https://www.lovettsldc.com`
  - `https://admin.lovettsldc.com`
  - `https://ldc-8kg.pages.dev`
  - local development origins
- HTTP config defines `jwtSecret` and `cookieSecret` from environment with local fallback strings. No secret values were exposed or changed.

Live CORS/preflight evidence from `Origin: https://lovettsldc.com`:

- `OPTIONS /auth/customer/emailpass` -> `204`
- `OPTIONS /auth/customer/emailpass/register` -> `204`
- `OPTIONS /auth/session` with `POST` -> `204`
- `OPTIONS /auth/session` with `DELETE` -> `204`
- `OPTIONS /store/customers` -> `204`
- `OPTIONS /store/customers/me` -> `204`
- `OPTIONS /store/orders` -> `204`

For these expected v2 routes, live responses include:

- `access-control-allow-origin: https://lovettsldc.com`
- `access-control-allow-credentials: true`
- `access-control-allow-headers: content-type,x-publishable-api-key,authorization`
- `access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE`

Routes that do not fit the expected v2 contract:

- `OPTIONS /store/auth` -> `404`
- `OPTIONS /store/customers/me/orders` -> `401`

Diagnosis:

- Backend CORS for the expected Medusa v2 auth/session/customer/order routes appears live and compatible with authenticated storefront requests.
- The primary issue is current storefront route/session usage, not a proven backend CORS block.

## 6. Admin comparison

Admin Studio uses a complete cookie-session pattern:

- `admin-ui/src/lib/api.js` `login(email, password)`:
  - `POST /auth/user/emailpass`
  - receives `token`
  - `POST /auth/session` with `Authorization: Bearer {token}`
  - uses `credentials: 'include'`
- Admin API requests use `credentials: 'include'`.
- Admin logout calls `DELETE /auth/session`.
- `admin-ui/src/state/auth.jsx` refreshes the session through `getCurrentUser`, sets `authenticated` or `anonymous`, and clears state on logout.

Material storefront difference:

- Storefront Account never calls `/auth/customer/emailpass`.
- Storefront Account never calls `/auth/session`.
- Storefront Account never stores or replays a JWT.
- Storefront Account defaults cross-origin fetch credentials to `omit`.
- Storefront Account has no logout control.

Admin resources relevant to downstream expectations:

- `admin-ui/src/data/resources.js` has `/admin/orders` as `Orders`.
- `admin-ui/src/data/resources.js` has `/admin/customers` as `Customers`.

## 7. Live unauthenticated behavior

Live URLs checked:

- `https://lovettsldc.com/account?verify=account-auth-diagnosis` -> `200`
- `https://lovettsldc.com/commerce.js?verify=account-auth-diagnosis` -> `200`
- `https://api.lovettsldc.com/health` -> `200`, body `OK`

Live runtime freshness:

- `commerce.js` reports `STOREFRONT_BUILD_SHA = '50df50e'`.

Live Account browser observation:

- Account status: `Please sign in to view your account.`
- Auth forms visible.
- Account details hidden.
- Account Continue Shopping href: `/`.
- `document.cookie`: empty.
- `localStorage`: shared `ldc:cart` empty cart payload.
- `sessionStorage`: empty.

Observed Account network:

- `GET https://lovettsldc.com/account?verify=account-auth-diagnosis` -> `200`
- `GET https://lovettsldc.com/commerce.js` -> `200`
- `OPTIONS https://api.lovettsldc.com/store/customers/me` -> `204`
- `GET https://api.lovettsldc.com/store/customers/me` -> `401`

Observed request headers in browser capture:

- The `GET /store/customers/me` request had no `Authorization` header.
- The `GET /store/customers/me` request had no `Cookie` header.

Console:

- Info: `[storefront-build] 50df50e ... path=/account`
- Info: `[verify-publishable-key] Attaching publishable key. ...`
- Info: `[storefront-grids] path=/account grids=[]`
- Browser logged the expected `401` failed resource for `/store/customers/me`.
- No Account JavaScript exception was observed.

## 8. Approved credential/test-account behavior

Not tested.

- Approved customer credentials available: no.
- Approved disposable production test-account permission available: no.
- Account forms submitted: no.
- Real production customer account created: no.
- Live order placed: no.
- Admin Studio login or data action: no.

End-to-end authenticated Account behavior remains `UNKNOWN` until approved credentials or an approved disposable test-account path is provided. However, source and safe live checks already prove the current endpoint/session contract is incompatible with the Medusa v2 backend.

## 9. Root-cause classification

Likely root causes:

- Storefront endpoint mismatch issue: confirmed.
  - Current sign-in uses `/store/auth`; expected v2 route is `/auth/customer/emailpass`.
  - Current order history uses `/store/customers/me/orders`; expected v2 customer order list route is `/store/orders`.
- Storefront missing JWT/token storage issue: confirmed if choosing JWT bearer auth.
  - Current code never stores or replays the token returned by Medusa v2 auth.
- Storefront credentials mode issue: confirmed if choosing cookie-session auth.
  - Current `request()` defaults to `credentials: 'omit'`; cookie-session requests need `credentials: 'include'`.
- Missing customer session establishment issue: confirmed for cookie-session auth.
  - Current code never calls `/auth/session`.
- Missing logout UI/control issue: confirmed.
- Order-history expectation issue: confirmed.
  - Current endpoint does not match installed/live Medusa v2 route surface.
- Copy/truthfulness issue: inherited from prior audit.
- Backend CORS/session config issue: not confirmed for expected v2 routes.
  - Live CORS for expected v2 auth/session/customer/order routes is permissive for `https://lovettsldc.com` and supports credentials plus authorization headers.
- Unknown due lack of approved credentials: still applies to real customer profile/order data and Admin correlation.

## 10. Risk classification

High:

- Current customer sign-in and create-account flows cannot be considered production-usable because they target the wrong auth endpoint and do not preserve an authenticated session/token.
- Current Create Account flow appears to submit a password to `/store/customers`, but Medusa v2 customer creation expects auth-token-backed customer profile creation, not password in that store customer body.

Medium:

- Order history is wired to an endpoint that is not present in installed Medusa v2 route source.
- No logout control exists.
- Account copy still implies profile/order capabilities that are not currently proven usable.

Low:

- Label/copy clarity items remain from the previous audit: `Confirm` should be clearer, required fields are not visibly marked, and sign-in helper text omits password.

Unknown:

- Whether an approved real/test customer has order data that will appear through `GET /store/orders` after the correct auth contract is implemented.
- Whether storefront-created customers and authenticated order history align with Admin Studio expectations without a credentialed/Admin check.

## 11. Recommended Phase 2B implementation scope

Recommended implementation path: storefront-only Account auth contract repair first, with no Admin or backend changes unless implementation testing proves otherwise.

Narrow Phase 2B scope:

1. Choose one auth method for the static storefront.
   - Recommended default: cookie session, because it mirrors Admin Studio and avoids storing customer JWTs in browser storage.
   - Alternative: JWT bearer stored in `sessionStorage` only, if cookie session behavior proves unsuitable.
2. Replace Account sign-in flow:
   - `POST /auth/customer/emailpass` with `{ email, password }`
   - If using cookie session: `POST /auth/session` with `Authorization: Bearer {token}` and `credentials: 'include'`
   - Then `GET /store/customers/me` with the selected auth method.
3. Replace Account create-account flow:
   - `POST /auth/customer/emailpass/register` with `{ email, password }`
   - `POST /store/customers` with the registration/login bearer token and customer profile body without `password`
   - Establish the selected auth method afterward, either by logging in with `/auth/customer/emailpass` or by refreshing/using a valid customer token.
4. Replace order-history endpoint:
   - Use `GET /store/orders`, not `/store/customers/me/orders`.
5. Add logout behavior if authenticated sessions are supported:
   - Cookie session: `DELETE /auth/session` with `credentials: 'include'`
   - JWT bearer: clear stored token/session state
6. Keep Account Continue Shopping unchanged except for regression verification.
7. Do not change Admin Studio or backend unless live credentialed testing proves backend CORS/session settings still block the corrected v2 flow.

If approved credentials are supplied before implementation, run a separate verification-only prompt first to confirm the corrected manual request sequence against the live backend without creating a new customer.

## 12. Proposed minimal success criteria for Goal 4 closure

Before Goal 4 can close:

- Customer sign-in uses the Medusa v2 customer auth route and succeeds with approved test credentials.
- The selected auth method is explicit: cookie session or JWT bearer.
- Authenticated Account requests preserve auth through refresh/navigation.
- Account displays customer name/email truthfully from `GET /store/customers/me`.
- Order history either works through `GET /store/orders` or customer-facing copy is corrected to avoid overpromising.
- Customer can log out if authenticated sessions are supported.
- Passwords are never stored in browser storage.
- If a JWT is used, storage choice is explicit and limited.
- Account Continue Shopping still safely falls back to `/` and restores allowed prior routes.
- No cart, favorites, checkout, Attire, Doormats, or Continue Shopping regressions are introduced.
- No real production account or order is created without explicit approval.

## 13. Evidence links

Official Medusa documentation consulted:

- Login Customer in Storefront: `https://docs.medusajs.com/resources/storefront-development/customers/login`
- Register Customer in Storefront: `https://docs.medusajs.com/resources/storefront-development/customers/register`
- Retrieve Logged-In Customer in Storefront: `https://docs.medusajs.com/resources/storefront-development/customers/retrieve`
- Authentication Routes: `https://docs.medusajs.com/resources/commerce-modules/auth/authentication-route`

These docs align with the installed Medusa v2.12.3 route source inspected locally.

## 14. Closure recommendation

`DRIFT`

The Account page is wired to a customer-auth contract that does not match the live Medusa v2 backend. Phase 2B should repair the storefront Account auth contract narrowly before any copy/design work or Admin/backend changes.
