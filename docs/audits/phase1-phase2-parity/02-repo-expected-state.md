# 02 - Repo Expected State

## Objective
Define expected repository/runtime/deploy conventions used as parity targets.

## Repo-expected state
- Medusa runtime ownership is systemd service `medusa-backend`.
- PM2 must not run Medusa backend processes.
- Audit documents live under `docs/audits/`.
- Artifacts/logs/screenshots remain local-only and gitignored.
- No secrets or environment values are committed.
- Audit statuses are constrained to `MATCH`, `DRIFT`, `UNKNOWN`.

## Manual evidence to capture later
- Runtime process-manager evidence (systemd vs PM2) from approved commands.
- `.gitignore` evidence confirming artifact paths are local-only.
- Workflow/runbook references showing deploy expectations.

## Findings
- Add one finding per expected-state item with explicit evidence.

## Status
- `UNKNOWN`

## Risk
- Risk if expected-state assumptions are unvalidated or stale.

## Next action
- Validate each expected-state item and mark status with source evidence.

## Blockers
- Capture missing permissions or unavailable runtime access.

## Signoff
- Reviewer:
- Date:
- Decision:
