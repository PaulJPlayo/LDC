# 06 - Drift Register

## Objective
Maintain a centralized list of confirmed/partial drift findings with risk and action tracking.

## Repo-expected state
- Every drift entry maps to a specific expected-state rule.
- Each entry includes evidence, current status, and next action.
- Unknowns remain explicit until resolved.

## Manual evidence to capture later
- Linked screenshots/logs/command outputs from local `artifacts/phase1-phase2-parity/`.
- File references and timestamps supporting each entry.

## Findings
| ID | Area | Expected | Observed | Evidence | Status | Risk | Next action | Blockers | Owner | Date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DRIFT-001 | Backend / Runtime | `medusa-backend` is active under systemd and enabled for auto-start on boot; PM2 does not own Medusa runtime. | Service is currently active, but `systemd` status output indicates `medusa-backend.service` is disabled for auto-start on boot. | Backend runtime live findings from Phase 1B/Phase 2 evidence pass (`systemctl status medusa-backend` output). | `DRIFT` | High | Schedule controlled change to enable service on boot; verify enabled+active after change. | Operational change window/approval required; do not change in docs-only pass. | Ops | 2026-03-09 |

## Status
- `DRIFT` (1 open item)

## Risk
- Reboot persistence risk for backend availability until DRIFT-001 is remediated.

## Next action
- Resolve DRIFT-001 and attach verification evidence proving boot persistence.

## Blockers
- Ops approval and maintenance window required for service enablement change.

## Signoff
- Reviewer:
- Date:
- Decision:
