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
| DRIFT-001 | Backend / Runtime | `medusa-backend` is active under systemd and enabled for auto-start on boot; PM2 does not own Medusa runtime. | Post-remediation verification shows service is enabled for auto-start and active at runtime (`is-enabled=enabled`, `is-active=active`, service status enabled). | Backend remediation verification output from Phase 1 + Phase 2 closeout pass. | `MATCH` | Low | Keep routine monitoring only; no further drift action required for DRIFT-001. | None | Ops | 2026-03-10 |

## Status
- `MATCH` (no open drift items)

## Risk
- No open drift risk from DRIFT-001 after remediation verification.

## Next action
- Continue normal operational checks; reopen only if runtime ownership/boot persistence regresses.

## Blockers
- None.

## Signoff
- Reviewer:
- Date:
- Decision:
