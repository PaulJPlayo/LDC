# E2E Testing

Playwright MCP browser automation is configured for Lovett LDC live, preview, and local browser checks.

## Targets

Set `E2E_TARGET` in `.env.e2e.local`:

- `live` uses `E2E_PUBLIC_URL_LIVE` and `E2E_ADMIN_URL_LIVE`.
- `preview` uses `E2E_PUBLIC_URL_PREVIEW` and `E2E_ADMIN_URL_PREVIEW`.
- `local` uses `E2E_PUBLIC_URL_LOCAL` and `E2E_ADMIN_URL_LOCAL`.

The public/customer site variables are `E2E_PUBLIC_URL_*`.
The Admin site variables are `E2E_ADMIN_URL_*`.
Public/customer login variables are `E2E_PUBLIC_EMAIL` and `E2E_PUBLIC_PASSWORD`.
Admin login variables are `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`.

## Local Secrets

`.env.e2e.local` is gitignored and should hold only local test credentials and target URLs.
Use `.env.e2e.example` as the safe template for shared setup.
Do not print, commit, screenshot, trace, or report credential values.

## VS Code Task

The `Start Playwright MCP Server` task starts Playwright MCP automatically on folder open.

If it does not start automatically, run:

`Tasks: Run Task` -> `Start Playwright MCP Server`

Codex should be used in local Agent mode for browser testing.

The MCP task binds port `8931` to IPv4 loopback `127.0.0.1`. If an already-running MCP
instance is still bound to IPv6 loopback `[::1]:8931`, treat that as a valid local-only
loopback binding and restart the VS Code task when an IPv4 listener is required.

## Credentialed Account Workspace Check

Use the local credentialed check when account verification needs login values without exposing
them through MCP tool inputs:

`Tasks: Run Task` -> `Run Account Workspace Credentialed Check`

or:

`node tests/e2e/account-workspace-dashboard-check.js`

The script reads `.env.e2e.local` through `tests/e2e/helpers/e2eEnv.js`, keeps public customer
credentials in memory only, and prints only safe pass/fail evidence. It checks the signed-out
Account page, signs in, verifies the Account Workspace dashboard, checks mobile and desktop
overflow, confirms saved workspace/account anchors, verifies logout privacy, and reports only
high-level storage counts. It does not save screenshots, traces, videos, cookies, tokens, or
credential values.

Use MCP for general browser inspection. Use the local script for credentialed checks that need
stable secret consumption without exposing login values.

## Safety

Do not submit real orders or real payments. Stop before final checkout/order submission unless a flow is clearly a test or sandbox checkout.
Do not use the credentialed account workspace check for saved-cart restore/delete, checkout,
payment, Admin Studio, backend, database, fulfillment, or live-order verification.
