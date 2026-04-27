# Account Page Usability and Data-Handling Audit

Date: 2026-04-27
Branch: `audit/account-page-usability-data-handling`
Base: `origin/main` at `50df50e`

## 1. Executive summary

Overall closure recommendation: `DRIFT`.

The Account page is not a static placeholder. It is a production-facing Medusa account surface with sign-in, create-account, profile, and order-history code paths. However, the current storefront source does not show a complete customer session model: `commerce.js` posts sign-in/sign-up requests and then reloads account state, but shared storefront requests use `credentials: 'omit'` and no customer token/session value is stored or replayed. Live logged-out `/account` correctly falls back to the sign-in/create-account UI after a `401` from `/store/customers/me`, but authenticated profile/order behavior remains unverified without approved credentials or account creation.

The highest-risk drift is customer-facing truthfulness and data handling: the page invites customers to create an account and says they can manage their profile and track every LDC order, while the source shows no logout control, no profile-management form, and no proven session persistence path after account creation or sign-in.

## 2. Source and route inventory

Files inspected:

- `README.md`
- `AGENTS.md`
- `account.html`
- `commerce.js`
- `favorites.js` by targeted search only; `account.html` does not include it.
- `docs/medusa-aws-plan.md`
- `docs/audits/account-continue-shopping-audit-2026-04-02.md`
- `docs/audits/phase1-phase2-parity/03-storefront-parity-checklist.md`
- `docs/audits/phase1-phase2-parity/04-admin-studio-parity-checklist.md`
- `docs/admin-parity-audit.md`
- `admin-ui/src/lib/api.js`
- `admin-ui/src/data/resources.js`
- `medusa-backend/medusa-config.ts`

Live URLs inspected:

- `https://lovettsldc.com/account?verify=account-audit` -> `200`
- `https://lovettsldc.com/commerce.js?verify=account-audit` -> `200`
- `https://lovettsldc.com/attire?verify=account-audit-start` -> `200`, used only to confirm Account Continue Shopping capture.

Runtime freshness:

- Live `commerce.js` reports `STOREFRONT_BUILD_SHA = '50df50e'`.
- Live `commerce.js` contains the previous Goal 3 custom-route addition: `/attire` and `/doormats` are present in `CONTINUE_SHOPPING_BROWSE_PATHS` and `ACCOUNT_CONTINUE_SHOPPING_ALLOWED_PATHS`.

Relevant selectors/helpers found:

- `account.html`: `data-account-continue-shopping-target`, `data-account-status`, `data-account-auth`, `data-signin-form`, `data-signup-form`, `data-account-details`, `data-account-name`, `data-account-email`, `data-order-list`.
- `commerce.js`: `ACCOUNT_CONTINUE_SHOPPING_RETURN_URL_KEY`, `ACCOUNT_CONTINUE_SHOPPING_ALLOWED_PATHS`, `ACCOUNT_CONTINUE_SHOPPING_EXCLUDED_PATHS`, `captureAccountContinueShoppingTarget`, `resolveAccountContinueShoppingTarget`, `applyAccountContinueShoppingTargets`.
- `commerce.js`: `handleSignIn`, `handleSignUp`, `getCustomer`, `getOrders`.

## 3. Current Account page customer journey

Initial logged-out load:

- The page loads a standalone Account shell with a `Continue Shopping` link, title `Your Account`, and subtitle `Manage your profile and track every LDC order in one place.`
- Initial status text is `Checking your account...`, then `Loading your account...`, then live logged-out state becomes `Please sign in to view your account.`
- The sign-in and create-account forms are shown.
- The account details area is present in source but hidden in logged-out state.

Visible forms and CTAs:

- Sign In form:
  - Heading: `Sign In`
  - Helper text: `Use your email to access order history.`
  - Fields: `Email`, `Password`
  - Button: `Sign In`
- Create Account form:
  - Heading: `Create Account`
  - Helper text: `New here? Set up your LDC account.`
  - Fields: `Name`, `Email`, `Password`, `Confirm`
  - Button: `Create Account`
- No logout CTA is present.
- No edit-profile CTA or profile-management form is present.

Continue Shopping:

- Direct `/account` with no stored Account return target resolves the Account Continue Shopping href to `/`.
- `/attire?verify=account-audit-start -> /account?verify=account-audit-from-attire` resolves Account Continue Shopping to `/attire?verify=account-audit-start`.
- Account uses a dedicated `ldc:account:return-url` session key and excludes `/account` from capture.

Desktop/mobile layout:

- Desktop headless Chrome viewport `1440x900`: sign-in and create-account cards render side by side, each about `437px` wide.
- Mobile headless Chrome viewport `390x844`: sign-in and create-account cards stack vertically, each about `300px` wide.
- No overlap was observed in the measured desktop or mobile layouts.

## 4. Account data handling map

| Surface | Required | Submitted anywhere | Browser storage | Backend/Medusa destination | Displayed back | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Sign-in email | HTML `required` | Yes, with password | Not stored by Account source | `POST /store/auth` | Only if later returned by `/store/customers/me` | Wiring confirmed; end-to-end auth unknown |
| Sign-in password | HTML `required` | Yes | Not stored | `POST /store/auth` | No | Wiring confirmed; end-to-end auth unknown |
| Sign-up name | HTML `required` | Yes | Not stored | Split into `first_name`/`last_name` for `POST /store/customers` | Only if later returned by `/store/customers/me` | Wiring confirmed; downstream creation not tested |
| Sign-up email | HTML `required` | Yes | Not stored | `POST /store/customers`, then `POST /store/auth` | Only if later returned by `/store/customers/me` | Wiring confirmed; downstream creation not tested |
| Sign-up password | HTML `required` | Yes | Not stored | `POST /store/customers`, then `POST /store/auth` | No | Wiring confirmed; downstream creation not tested |
| Sign-up confirm password | HTML `required` | No direct API body field | Not stored | Client-side comparison only | No | Confirmed |
| Account status text | N/A | No | Not stored | Derived from account load result | Yes | Confirmed |
| Displayed name | N/A | No | Not stored | `GET /store/customers/me` | Yes, authenticated state only | Source confirmed; live authenticated state unknown |
| Displayed email | N/A | No | Not stored | `GET /store/customers/me` | Yes, authenticated state only | Source confirmed; live authenticated state unknown |
| Order History cards | N/A | No | Not stored | `GET /store/customers/me/orders` | Yes, authenticated state only | Source confirmed; live authenticated state unknown |
| Account Continue Shopping target | N/A | No | `sessionStorage` key `ldc:account:return-url` | No backend | Link href | Confirmed |
| Shared cart fallback | N/A | No account submission | `localStorage` key `ldc:cart` created as empty cart payload on live route load | No account-specific backend write observed | Not visible on Account | Confirmed shared runtime side effect |

No Account customer/profile/order data was observed in `localStorage` or `sessionStorage`.

## 5. Authentication/session behavior

Account appears to support login:

- `account.html` renders `data-signin-form`.
- `commerce.js` installs `handleSignIn` on `[data-signin-form]`.
- `handleSignIn` sends `POST /store/auth` with `{ email, password }`.

Account appears to support create account:

- `account.html` renders `data-signup-form`.
- `commerce.js` installs `handleSignUp` on `[data-signup-form]`.
- `handleSignUp` sends `POST /store/customers`, then `POST /store/auth`.

Logout:

- No logout UI or handler was found in `account.html` or `commerce.js`.

Token/session evidence:

- `commerce.js` shared `request()` uses `credentials: options.credentials || 'omit'`.
- Account sign-in/sign-up calls do not pass `credentials: 'include'`.
- Account source does not store a customer token, JWT, session ID, or auth cookie reference in browser storage.
- Account source does not call a separate `/auth/session` endpoint after storefront auth.
- Admin Studio code does use explicit session handling: `admin-ui/src/lib/api.js` uses `credentials: 'include'` for API requests and establishes `/auth/session` with a bearer token after `/auth/user/emailpass`. That pattern is not present in the storefront Account flow.

Live logged-out behavior:

- Live `/account` issues `GET https://api.lovettsldc.com/store/customers/me`.
- The live response is `401`.
- The page handles that by showing `Please sign in to view your account.`

No forms were submitted during this audit. No test account was created.

## 6. Order history behavior

Account does claim and prepare to show order history:

- Page metadata says `LDC account and order history`.
- Subtitle says `Manage your profile and track every LDC order in one place.`
- Sign-in helper text says `Use your email to access order history.`
- Authenticated details include heading `Order History`.

Implementation type:

- Not static placeholder content.
- Not browser-storage-only content.
- Source attempts Medusa-backed customer order content through `GET /store/customers/me/orders`.
- The order-history empty state `No orders yet.` appears only in authenticated details rendering when the orders array is empty.

Unknowns:

- Authenticated order-history behavior was not verified because the audit did not use credentials, create an account, or place an order.
- It is unknown whether guest orders, checkout-created orders, or Admin-created draft/converted orders appear in this customer order-history endpoint for a signed-in storefront customer.

Truthfulness concern:

- `track every LDC order in one place` may overpromise unless the storefront account can show all orders a customer expects, including guest or pre-account orders. Source only shows customer-authenticated `/store/customers/me/orders`.

## 7. Storefront/Admin Studio expectation review

Admin Studio expectations from source/docs:

- Admin Studio manages `/admin/orders` and `/admin/customers`.
- `admin-ui/src/data/resources.js` defines Orders columns for order number, customer email, status, payment, total, and placed date.
- `admin-ui/src/data/resources.js` defines Customers columns for first name, last name, email, and created date.
- `admin-ui/src/lib/api.js` uses cookie-backed authenticated admin requests with `credentials: 'include'`.
- `medusa-backend/medusa-config.ts` configures `storeCors`, `adminCors`, and `authCors`, and defines Medusa HTTP secrets.

Storefront account capability:

- Storefront Account can theoretically create customer records through `POST /store/customers`.
- Storefront Account can theoretically display customer profile/orders through `/store/customers/me` and `/store/customers/me/orders`.
- Storefront Account source does not show enough session handling to prove that a customer can sign in, remain authenticated, and then view profile/orders.

Drift/unknown:

- `DRIFT`: customer-facing Account promises are broader than the demonstrated source behavior.
- `UNKNOWN`: whether created storefront customers appear in Admin Studio Customers, because no account was created.
- `UNKNOWN`: whether storefront order history reflects Admin Studio order-management expectations, because no authenticated customer/order test was performed.

## 8. Usability and truthfulness review

Clear or acceptable:

- The page purpose is broadly understandable as an Account page.
- The sign-in and create-account split is clear.
- Browser-native required-field validation exists because inputs use `required`.
- Error state for logged-out account load is understandable: `Please sign in to view your account.`
- Direct Account Continue Shopping fallback is safe.
- The route visually aligns with other standalone storefront utility pages and no overlap was observed on tested desktop/mobile widths.

Drift or clarity issues:

- `Manage your profile` is not truthful as written because no profile edit/manage controls are present.
- `track every LDC order in one place` may overpromise because source only attempts authenticated customer order history and that flow is unverified.
- `Use your email to access order history` is incomplete because the form also requires a password.
- `Confirm` should likely be `Confirm password` for clarity.
- Required fields are not visually marked beyond browser validation.
- No logout control exists after sign-in in source.
- Account creation is a production action. The page asks for name, email, and password, but the source does not show a proven session persistence path after creation.

## 9. Risk classification

High:

- Account creation/sign-in may be a false customer-account promise if session persistence does not work. Source evidence: `request()` defaults to `credentials: 'omit'`; no customer token/session storage is present; live logged-out state returns `401`.
- The Create Account form appears capable of submitting customer data to production `/store/customers`, but the source does not prove the customer can then use the account page successfully.

Medium:

- Order-history copy may mislead customers if only authenticated customer orders are supported or if authenticated order history is not functional.
- No logout control is present in source.
- Profile-management copy is broader than the implemented display-only profile surface.

Low:

- `Confirm` label should be more explicit.
- Required fields could be visually marked.
- Sign-in helper text could mention password as well as email.

Unknown:

- Authenticated `/store/customers/me` and `/store/customers/me/orders` behavior with approved credentials.
- Whether storefront-created customers and customer orders appear in Admin Studio exactly as expected.
- Whether checkout orders are attached to customer accounts in a way Account can retrieve.

## 10. Recommended next action

Recommended next phase: diagnosis-first Phase 2 account auth/data pilot.

Do not start with a redesign. First prove the intended Medusa customer auth/session contract for the static storefront:

1. Determine the correct Medusa storefront customer auth flow for this backend.
2. Decide whether storefront auth should use cookie-backed sessions, bearer tokens, or another supported customer-token path.
3. Verify whether `POST /store/customers` should be available from production Account without additional confirmation/terms copy.
4. Verify whether `/store/customers/me/orders` returns the expected LDC orders for an approved test customer.
5. Only after the auth contract is proven, adjust Account copy/CTA states to match the actual supported behavior.

If backend or Admin Studio access is required, use a separate scoped prompt. Storefront-only changes are insufficient if the issue is session/auth configuration or order/customer association.

## 11. Proposed Phase 2 prompt outline

Title: LDC Account Auth Session and Truthful Account UX Diagnosis Pilot

Scope:

- Audit and prove the storefront customer auth/session contract with approved non-production or explicitly approved test credentials only.
- Do not create real customer accounts unless a dedicated approved test account path is provided.
- Do not place live orders.
- Inspect the expected Medusa customer auth API for this backend and compare it to `commerce.js` request/session behavior.
- If a small storefront-only fix is proven, implement the minimum change to make sign-in/session/profile/order history truthful.
- If backend/Admin changes are required, stop and report the required backend/Admin scope.

Candidate fix areas, pending diagnosis:

- Customer auth request credentials/token handling.
- Logout control if authenticated Account is supported.
- Copy changes for profile/order-history claims.
- Authenticated empty states and failure messages.

## 12. Audit evidence

Live Account browser observations:

- Desktop direct `/account`: status `Please sign in to view your account.`, auth forms visible, details hidden, Continue Shopping href `/`.
- Desktop `/attire -> /account`: `sessionStorage` contained `ldc:account:return-url = /attire?verify=account-audit-start`; Account Continue Shopping href matched that value.
- Mobile direct `/account`: status `Please sign in to view your account.`, auth forms visible, details hidden, Continue Shopping href `/`.
- Desktop layout: sign-in card and create-account card side by side.
- Mobile layout: sign-in card stacked above create-account card.

Live network observations:

- `/account?verify=account-audit`: `200`.
- `/commerce.js`: `200`.
- `/styles.css`: `200`.
- `/product-map.json`: `200`.
- `/store/customers/me`: CORS preflight `204`, fetch `401` in logged-out state.

Live console observations:

- Info: `[storefront-build] 50df50e ... path=/account`.
- Info: `[verify-publishable-key] Attaching publishable key. ...`.
- Info: `[storefront-grids] path=/account grids=[]`.
- Browser console logged the expected failed resource for `401` on `/store/customers/me` in logged-out state.
- No Account-specific JavaScript exception was observed.

Storage observations:

- Direct Account load created no Account customer/auth storage.
- Direct Account load showed shared `localStorage` key `ldc:cart` with an empty cart payload.
- `/attire -> /account` created session keys:
  - `ldc:continue-shopping:return-url = /attire?verify=account-audit-start`
  - `ldc:account:return-url = /attire?verify=account-audit-start`

Safety confirmations:

- Forms submitted: no.
- Real customer account created: no.
- Live order placed: no.
- Admin Studio login/action taken: no.
- Backend/Admin/source files modified: no.

## 13. Git/base-state note

Required initial state checks were run:

- `git status --short`: clean.
- `git branch --show-current`: started on `feature/continue-shopping-custom-routes`.
- `git fetch origin`: completed.
- `git rev-parse main`: `c47b313d1dc03db5b102b63bb9bd1d3ecf236dd7`.
- `git rev-parse origin/main`: `50df50e1947c8650266a4512538c5df157647169`.

Local `main` remains diverged from `origin/main`:

- Local-only: `c47b313 docs: add mini cart regression audit`.
- Remote-only includes the doormats/attire parity chain and `50df50e Add custom routes to continue shopping targets`.

The audit branch was created from `origin/main` using detached-origin workflow. Local `main` was not reset, rebased, or merged.

## 14. Closure recommendation

`DRIFT`

Account is present and partially wired, but the customer-facing account promise is ahead of the demonstrated session/order-history behavior. The next step should be a diagnosis-first Phase 2 account auth/data pilot, not broad redesign or speculative backend/Admin work.
