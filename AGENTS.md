# AGENTS.md

## Repository expectations
- Phase-based workflow: audit/parity work first, feature changes only when explicitly requested.
- Never commit secrets or environment values.
- Do not perform final checkout verification until explicitly requested and approved.
- Medusa must be treated as systemd-managed via `medusa-backend`; PM2 must not run Medusa.
- Keep audit docs under `docs/audits/`.
- Keep artifacts local-only and gitignored.
- Use `MATCH` / `DRIFT` / `UNKNOWN` in audit reports.
- Avoid application behavior changes during audit-only phases.
- Before concluding a coding task, run lightweight validation relevant to the files changed.
- When making git changes, prefer focused commits with clear messages.
