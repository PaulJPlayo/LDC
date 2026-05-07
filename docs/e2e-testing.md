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

## Safety

Do not submit real orders or real payments. Stop before final checkout/order submission unless a flow is clearly a test or sandbox checkout.
