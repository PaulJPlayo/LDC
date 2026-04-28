# Account Registration 401 Diagnosis

Date: 2026-04-28
Branch: `diagnosis/account-registration-401`
Base: `origin/main` at `ed498c1`

## 1. Summary

Closure recommendation: `DRIFT`.

The live Account repair is deployed and fresh, but the approved disposable Account Create Account path still cannot close. The live registration endpoint returns a confirmed existing-identity response:

- `POST /auth/customer/emailpass/register` -> `401`
- Response body: `{ "type": "unauthorized", "message": "Identity with email already exists" }`

The same approved email/password was then tested through the Sign In path. Login also failed:

- `POST /auth/customer/emailpass` -> `401`
- Response body: `{ "type": "unauthorized", "message": "Invalid email or password" }`

This is Case C from the prompt: register returns 401 and same-credentials login also fails. A storefront existing-identity fallback is not safe to implement yet because the fallback depends on the existing identity accepting the supplied password.

No Account fallback patch was implemented.

## 2. Approval And Test Path

Approval was provided for continued Account auth testing for Goal 4.

Approved path used:

- Option A: reuse prior disposable production test customer data.
- Approved email: `oraclecoding8@gmail.com`

The password was used only for the live credentialed browser test. It is not included in this report.

## 3. Git/Base-State Note

Required git checks were run:

- Starting branch: `release/account-v2-session-repair`
- Worktree before diagnosis branch: clean
- `git fetch origin`: completed
- `git rev-parse origin/main`: `ed498c12d8758d322c7a2d13d9490de368810ed9`

The diagnosis branch was created from detached `origin/main`:

```bash
git switch --detach origin/main
git switch -c diagnosis/account-registration-401
```

Local `main` was not reset, rebased, merged, or force-pushed.

## 4. Current Deployed Account State

`origin/main` contains the Account v2 repair commit:

- Commit: `ed498c12d8758d322c7a2d13d9490de368810ed9`
- Title: `Repair account customer session flow`
- Changed files in that release:
  - `account.html`
  - `commerce.js`

Live URLs checked:

- `https://lovettsldc.com/account?verify=account-registration-401` -> `200`
- `https://lovettsldc.com/commerce.js?verify=account-registration-401` -> `200`
- `https://api.lovettsldc.com/health` -> `OK`

Live `commerce.js` freshness evidence:

- `STOREFRONT_BUILD_SHA = 'ed498c1'`
- Contains `/auth/customer/emailpass`
- Contains `/auth/customer/emailpass/register`
- Contains `/auth/session`
- Contains `/store/customers/me`
- Contains `/store/orders`
- Contains Account `credentials: 'include'` calls
- Does not contain active Account use of `/store/auth`
- Does not contain active Account use of `/store/customers/me/orders`

## 5. Register 401 Evidence

Controlled live browser session:

- Page: `https://lovettsldc.com/account?verify=account-registration-401`
- Initial Account state: `Please sign in to view your account.`
- Direct Account Continue Shopping target: `/`
- Account details hidden; sign-in/create-account forms visible.

Create Account was submitted with the approved test path only.

Register request:

- Method/path: `POST /auth/customer/emailpass/register`
- Status: `401`
- Content type: `application/json; charset=utf-8`
- Set-Cookie observed: no
- Sanitized response body:

```json
{
  "type": "unauthorized",
  "message": "Identity with email already exists"
}
```

Customer-facing result:

- Status remained logged out.
- Create Account message: `Unable to create account. Please try again.`
- Account details did not render.

## 6. Same-Credentials Login/Session Diagnosis

Immediately after the register failure, the same approved email/password was tested through the Sign In path.

Login request:

- Method/path: `POST /auth/customer/emailpass`
- Status: `401`
- Content type: `application/json; charset=utf-8`
- Set-Cookie observed: no
- Sanitized response body:

```json
{
  "type": "unauthorized",
  "message": "Invalid email or password"
}
```

Session/profile/order follow-up:

- `POST /auth/session`: not reached because login did not return a token.
- `GET /store/customers/me`: not reached after login because session was not created.
- `GET /store/orders`: not reached because profile/session was not established.

Customer-facing result:

- Sign In message: `Unable to sign in. Please check your details.`
- Account remained logged out.
- Logout was not visible.

## 7. Root-Cause Classification

Classification: Case C.

- Register 401 with existing-identity message: confirmed.
- Same-credentials login failure: confirmed.
- Existing-identity storefront fallback is not safe for this approved test path because the fallback requires `/auth/customer/emailpass` to succeed with the submitted password.

Likely explanation:

- The email identity already exists in the live auth provider.
- The supplied password does not match that existing identity, or the existing identity is otherwise not usable through the email/password auth provider.

Not proven:

- Whether a fresh unique approved email would register successfully.
- Whether the existing auth identity already has a linked customer actor.
- Whether Admin cleanup or backend auth-provider inspection is needed for this specific identity.

## 8. Implementation Decision

No source changes were made.

Reason:

- The only allowed implementation path was a narrow existing-identity fallback for Case A or Case B.
- The live result is Case C: register 401 and login 401.
- Implementing fallback would not repair this test path and could produce misleading customer behavior.

## 9. Storage And Security Observations

Browser storage after create-account and sign-in attempts:

- Keys observed: `localStorage:ldc:cart`
- Password in localStorage/sessionStorage: no
- JWT in localStorage/sessionStorage: no
- Auth/token-like storage key: no

Cookies:

- No auth/session cookies were created during the failed attempts.

Console:

- Expected 401 resource errors were observed for unauthenticated/account auth attempts.
- No Account JavaScript exception was observed.

## 10. Validation

No runtime source files were changed.

Validation required for diagnosis-only documentation:

- `git diff --check`

## 11. Recommended Next Phase

Recommended next prompt: fresh approved disposable email verification, or backend/auth-provider identity cleanup diagnosis.

The fastest path to isolate root cause is to test with a genuinely new, approved disposable email address. If that succeeds, the storefront repair is likely correct and this specific email should be treated as a stale/existing identity with a mismatched password.

If fresh-email registration also fails with 401, use a backend/auth-provider-scoped prompt to inspect Medusa email/password provider configuration and identity records. Do not patch storefront code until the backend/auth identity behavior is proven.

## 12. Closure Recommendation

`DRIFT`

The live Account route remains safe, but customer registration/sign-in cannot close as `MATCH` with the approved test path because both registration and same-credentials login fail.
