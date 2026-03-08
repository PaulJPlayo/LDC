# 05 - Backend Config and Deploy Parity Checklist

## Objective
Document backend/runtime/config/deploy expectations from repo state and prepare safe verification steps without performing deployments.

## Repo-expected state
### Runtime ownership expectation
- Medusa runtime ownership should be `systemd` service `medusa-backend`.
- PM2 must not run Medusa backend process ownership for port `9000`.
- This expectation is reinforced in ops artifacts (`ops/runbooks/phase1a-storage-hardening.md`, `ops/scripts/phase1b_monitoring_backups.sh`, `ops/scripts/phase2_e2e_commerce_verification.sh`).

### Health endpoint expectation
- Deploy workflow and runbooks consistently reference `https://api.lovettsldc.com/health`.
- Expected behavior is successful HTTP response (runbooks reference HTTP 200).

### Origin/CORS assumptions (repo)
- `medusa-backend/medusa-config.ts` computes `storeCors`, `adminCors`, `authCors` from env plus defaults:
  - `http://127.0.0.1:5501`
  - `http://localhost:5174`
  - `https://admin.lovettsldc.com`
  - `https://lovettsldc.com`
  - `https://www.lovettsldc.com`
  - `https://ldc-8kg.pages.dev`
- Live CORS behavior still requires runtime verification against deployed env values.

### Payment-provider surface notes (no secrets)
- Backend config registers PayPal provider with id `paypal` from local provider path.
- PayPal mode default is `sandbox` when env is unset.
- Checkout frontend calls store endpoints for payment providers and payment collections.
- Notification provider surface includes optional SendGrid provider only when required env vars are present.

### Deploy-path expectations (repo)
- Deploy trigger is manual (`workflow_dispatch`) in `.github/workflows/deploy-backend.yml`.
- Primary deploy path: AWS SSM `send-command` invoking `/home/ubuntu/ldc-medusa/scripts/deploy-medusa.sh`.
- Fallback deploy path: SSH over SSM running the same script.
- Post-deploy check in workflow: `curl -fsS ... https://api.lovettsldc.com/health`.

### Safe runtime verification commands to run later (read-only / non-deploy)
- Process ownership and service status:
  - `systemctl is-active medusa-backend`
  - `systemctl status medusa-backend --no-pager`
  - `sudo ss -ltnp | grep ':9000'`
  - `pm2 ls || true`
- Health check:
  - `curl -sS -m 20 -D - https://api.lovettsldc.com/health | head -n 20`
- Support checks from runbooks:
  - `journalctl --disk-usage`
  - `systemctl is-active amazon-cloudwatch-agent`
  - `systemctl list-timers --all | grep ldc-disk-cleanup`

## Manual evidence to capture later
- Command outputs for runtime ownership and port `9000` PID mapping.
- Health endpoint response headers/body sample and timestamp.
- Most recent deploy workflow run metadata (run id, conclusion, timestamp).
- CORS/browser evidence for storefront/admin origins against backend.

## Findings
- Repo-derived backend/deploy/runtime expectations captured.
- No deploy executed in this phase.
- Live runtime/health/CORS verification remains pending (`UNKNOWN`).

## Status
- Repo expectation capture: `MATCH`
- Live runtime/deploy parity verification: `UNKNOWN`

## Risk
- High risk if runtime ownership or CORS/env values drift from repo assumptions; this can break checkout/admin flows without code changes.

## Next action
- Execute safe read-only runtime checks and record outcomes in this file and `06-drift-register.md`.

## Blockers
- Requires host/runtime access and CI metadata access for live evidence capture.

## Signoff
- Reviewer:
- Date:
- Decision:
