# 01 - Baseline Snapshot

## Objective
Capture a reproducible repository baseline for Phase 1A and make clear what is repo-confirmed versus still pending live evidence.

## Repo-expected state
- Active audit branch at capture time: `audit/phase1-phase2-parity`.
- HEAD commit at capture time: `205f0ba052c61736f602a03fdb919109618b560d`.
- Baseline source branch: `main`.
- Baseline docs are audit-only and do not change storefront/admin/backend runtime behavior.

## Manual evidence to capture later
- Runtime process ownership evidence from server (`systemd`/`pm2`) is still pending.
- Live storefront parity screenshots/network traces are still pending.
- Live admin parity screenshots/API traces are still pending.
- Live backend runtime and health verification evidence is still pending.

## Findings
### Repo baseline captured
- Branch and commit recorded from local git state at baseline capture time.
- Root `AGENTS.md` added in Phase 1A with repo-level audit guardrails.
- Audit workspace scaffolding added in Phase 1A under `docs/audits/phase1-phase2-parity/`:
  - `README.md`
  - `01-baseline-snapshot.md`
  - `02-repo-expected-state.md`
  - `03-storefront-parity-checklist.md`
  - `04-admin-studio-parity-checklist.md`
  - `05-backend-config-deploy-parity-checklist.md`
  - `06-drift-register.md`
  - `07-phase1-phase2-signoff.md`
  - `manual-findings-template.md`
- Local artifact folders were created under `artifacts/phase1-phase2-parity/` and remain gitignored/local-only.

### Live evidence still pending
- No live parity validation is claimed in this document.
- Any runtime or UI assertions requiring environment access remain `UNKNOWN` until evidence is captured.

## Status
- Repo baseline capture: `MATCH`
- Live/runtime parity evidence: `UNKNOWN`

## Risk
- If baseline metadata is not kept aligned with branch/head changes, later parity conclusions may be attributed to the wrong code snapshot.

## Next action
- For each checklist (`03`-`05`), execute manual evidence capture and update `MATCH`/`DRIFT`/`UNKNOWN` per item with artifact references.

## Blockers
- No repo-access blockers.
- Live environment access and manual execution windows are required for pending evidence.

## Signoff
- Reviewer:
- Date:
- Decision:
