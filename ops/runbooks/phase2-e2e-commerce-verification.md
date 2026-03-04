# Phase 2 End-to-End Commerce Verification

## Purpose
Verify the production commerce path end-to-end with evidence:
- Storefront -> Medusa Store API
- Backend platform health and process ownership
- Payment session creation for PayPal provider
- Admin/storefront manual validation steps

This runbook is sanitized (no secrets).

## Automated Script
- Script: `ops/scripts/phase2_e2e_commerce_verification.sh`
- Artifacts:
  - `artifacts/phase2_e2e_commerce_verification.log`
  - `artifacts/phase2_e2e_commerce_verification.md`

Run:
```bash
bash ops/scripts/phase2_e2e_commerce_verification.sh
```

## What the Script Checks
1. Local preflight and safe watcher cleanup.
2. SSH connectivity + read-only instance checks:
   - `df -h /`, `df -i /`
   - SSM service active
   - CloudWatch agent active + recent log AccessDenied scan
   - cleanup timer enabled + next run
   - journald disk usage
   - port `9000` ownership (must be systemd `medusa-backend`)
   - PM2 must not have `medusa` online
   - backend repo commit provenance (`git rev-parse`, recent log)
3. Public checks:
   - backend `/health` must return HTTP 200
   - storefront `commerce.js` build markers and publishable key extraction
4. Store API checkout skeleton:
   - regions -> product/variant -> cart -> line item -> address -> shipping -> taxes -> cart totals
   - payment collection + PayPal payment session
   - captures safe evidence fields only (`cart_total_minor`, `expected_major`, `paypal_order_id`)
5. Optional deep PayPal amount validation:
   - Only runs a non-committed helper if present at `/tmp/phase2_paypal_amount_check.sh`
6. Optional deploy workflow verification via `gh`.

## Manual UI Checklist (Evidence + Screenshots)

### Admin Studio
1. Log in to Admin Studio.
2. Confirm products/variants list loads.
3. Create a test product/variant (or edit an existing one) and publish.
4. Screenshot evidence:
   - product list visible
   - product detail showing published status

### Storefront
1. Open storefront and confirm product appears in expected catalog location.
2. Add product to cart.
3. Proceed to checkout.
4. Select PayPal (sandbox) session.
5. Confirm checkout displayed amount matches expected major-unit amount.
6. Screenshot evidence:
   - cart line item + subtotal/total
   - checkout payment selection with PayPal
   - displayed amount at checkout

### Fulfillment / Order Flow
1. Complete one sandbox checkout (if allowed in your test window).
2. In Admin Studio, confirm order appears.
3. Mark order fulfilled and confirm status change.
4. Screenshot evidence:
   - order detail with payment/fulfillment statuses

## Optional Deep PayPal Amount Validation (Non-Committed)
If PayPal API verification is required, use a one-off helper under `/tmp` or `artifacts/` only.
It may source backend `.env` on the server, but must print only:
- `cart_total_minor`
- `expected_major`
- `paypal_amount.value`
- `amount_match`

Do not commit helper scripts or logs containing sensitive auth details.

## Pass Criteria Summary
- SSH reachable
- backend `/health` = 200
- SSM active
- CWAgent active and no recent PutMetricData AccessDenied
- cleanup timer enabled and scheduled
- journald usage under threshold
- port 9000 owned by systemd medusa process and PM2 medusa not online
- storefront marker extracted
- store API checkout skeleton complete
- PayPal payment session created with order id
- optional deep amount match true (when helper executed)
