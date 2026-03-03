# Phase 1A Storage Hardening Runbook

## Scope
Operational hardening for Medusa backend host disk pressure and deploy resilience.

## What Was Done
- Root EBS volume increased to `40 GiB`.
- Root partition/filesystem expanded on Ubuntu (`growpart` + `resize2fs`).
- `journald` caps applied via `/etc/systemd/journald.conf.d/ldc.conf`:
  - `SystemMaxUse=200M`
  - `SystemKeepFree=1G`
  - `RuntimeMaxUse=100M`
- Daily cleanup automation installed:
  - Script: `/usr/local/sbin/ldc-disk-cleanup.sh`
  - Timer: `ldc-disk-cleanup.timer` (`OnCalendar=daily`, `Persistent=true`)
- SSM agent verified healthy.
- Medusa ownership verified on port `9000` under `systemd` (`medusa-backend`), with PM2 not serving `medusa`.

## Quick Verification
Run these on the instance:

```bash
df -h /
df -i /
lsblk -o NAME,SIZE,TYPE,MOUNTPOINT
```

```bash
sudo ls -l /etc/systemd/journald.conf.d/ldc.conf
journalctl --disk-usage
```

```bash
systemctl is-enabled ldc-disk-cleanup.timer
systemctl list-timers --all | grep ldc-disk-cleanup
sudo systemctl start ldc-disk-cleanup.service
sudo tail -n 80 /var/log/ldc_disk_cleanup.log
```

```bash
systemctl is-active medusa-backend
sudo ss -ltnp | grep ':9000'
pm2 ls || true
```

From local workstation:

```bash
curl -sS -m 20 -D - https://api.lovettsldc.com/health | head -n 20
gh workflow run deploy-backend.yml
```

## Optional PayPal Deep Verification (Manual, Non-Committed)
- Keep this out of committed ops scripts to avoid secret-handling patterns in git history.
- If needed, run a one-off helper script under `/tmp` or `artifacts/` (both local/runtime scope), then delete it.
- Output only safe fields:
  - `cart_total_minor`
  - `expected_major`
  - `paypal_amount.value`
  - `amount_match`

## What Not To Do
- Do not run PM2 `medusa` on port `9000` when `medusa-backend` systemd service is active.
- Do not commit raw `artifacts/*.log` files or any secret-bearing files.
- Do not print `.env` contents while debugging.

## Parameterization Guidance
Use instance ID + region as the source of truth (`i-...` + `us-east-2`).
Avoid hardcoding a public IP unless AWS lookup is unavailable.
