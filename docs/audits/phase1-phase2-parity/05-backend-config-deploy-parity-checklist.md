# 05 - Backend Config and Deploy Parity Checklist

## Objective
Audit backend runtime/config/deploy parity expectations without executing deployments.

## Repo-expected state
- Medusa backend is systemd-managed as `medusa-backend`.
- PM2 does not manage Medusa backend runtime.
- Deploy workflow references are documented but not executed in Phase 1A.
- No environment values or secrets are copied into committed audit docs.

## Manual evidence to capture later
- Backend config references from `medusa-backend/medusa-config.ts`.
- Deploy workflow references from `.github/workflows/deploy-backend.yml`.
- Runtime ownership evidence from approved operational checks.

## Findings
- Item:
- Evidence:
- Interpretation:
- Proposed status: `MATCH` | `DRIFT` | `UNKNOWN`

## Status
- `UNKNOWN`

## Risk
- Risk of runtime ownership/deploy mismatch causing operational instability.

## Next action
- Validate ownership and deploy assumptions with evidence-only checks.

## Blockers
- Record unavailable server access, missing logs, or incomplete docs.

## Signoff
- Reviewer:
- Date:
- Decision:
