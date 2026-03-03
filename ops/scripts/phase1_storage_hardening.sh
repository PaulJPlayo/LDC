#!/usr/bin/env bash
set -euo pipefail

INSTANCE_ID="${INSTANCE_ID:-i-0b14413f966a0843e}"
AWS_REGION="${AWS_REGION:-us-east-2}"
SSH_USER="${SSH_USER:-ubuntu}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/Documents/LDC/ldc-medusa-key.pem}"
TARGET_GB="${TARGET_GB:-40}"
BACKEND_BASE="${BACKEND_BASE:-https://api.lovettsldc.com}"
HOST="${HOST:-}"
HOST_FALLBACK="${HOST_FALLBACK:-}"

say() {
  printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1"; exit 1; }
}

resolve_host() {
  if [[ -n "$HOST" ]]; then
    echo "$HOST"
    return
  fi

  if command -v aws >/dev/null 2>&1; then
    local ip
    ip=$(aws ec2 describe-instances \
      --region "$AWS_REGION" \
      --instance-ids "$INSTANCE_ID" \
      --query 'Reservations[0].Instances[0].PublicIpAddress' \
      --output text 2>/dev/null || true)
    if [[ -n "$ip" && "$ip" != "None" && "$ip" != "null" ]]; then
      echo "$ip"
      return
    fi
  fi

  if [[ -n "$HOST_FALLBACK" ]]; then
    echo "$HOST_FALLBACK"
    return
  fi

  echo ""
}

parse_root_devices() {
  local root_source="$1"
  if [[ "$root_source" =~ ^/dev/nvme[0-9]+n[0-9]+p([0-9]+)$ ]]; then
    ROOT_PART_NUM="${BASH_REMATCH[1]}"
    ROOT_DISK="${root_source%p$ROOT_PART_NUM}"
    return 0
  fi
  if [[ "$root_source" =~ ^/dev/xvd[a-z]([0-9]+)$ ]]; then
    ROOT_PART_NUM="${BASH_REMATCH[1]}"
    ROOT_DISK="${root_source%$ROOT_PART_NUM}"
    return 0
  fi
  if [[ "$root_source" =~ ^/dev/sd[a-z]([0-9]+)$ ]]; then
    ROOT_PART_NUM="${BASH_REMATCH[1]}"
    ROOT_DISK="${root_source%$ROOT_PART_NUM}"
    return 0
  fi
  return 1
}

require ssh
require curl

say "Preflight"
if [[ ! -f "$SSH_KEY_PATH" ]]; then
  echo "SSH key not found: $SSH_KEY_PATH"
  exit 1
fi
chmod 400 "$SSH_KEY_PATH"

HOST_RESOLVED=$(resolve_host)
if [[ -z "$HOST_RESOLVED" ]]; then
  echo "Could not resolve host. Set HOST or HOST_FALLBACK, or configure AWS CLI access."
  exit 1
fi
say "Using host: $HOST_RESOLVED"

if ! nc -z -w 5 "$HOST_RESOLVED" 22 >/dev/null 2>&1; then
  echo "SSH port 22 unreachable on $HOST_RESOLVED"
  exit 1
fi

if ! ssh -i "$SSH_KEY_PATH" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=8 "$SSH_USER@$HOST_RESOLVED" 'echo ok' >/dev/null 2>&1; then
  echo "SSH auth/connect failed for $SSH_USER@$HOST_RESOLVED"
  exit 1
fi

say "Discover root device"
REMOTE_DISCOVERY=$(ssh -i "$SSH_KEY_PATH" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$SSH_USER@$HOST_RESOLVED" 'bash -se' <<'REMOTE'
set -euo pipefail
root_source=$(findmnt -n -o SOURCE /)
root_fstype=$(findmnt -n -o FSTYPE /)
root_df=$(df -h / | awk 'NR==2 {print $2"|"$4"|"$5}')
root_dfi=$(df -i / | awk 'NR==2 {print $5}')
echo "root_source=$root_source"
echo "root_fstype=$root_fstype"
echo "root_df=$root_df"
echo "root_dfi=$root_dfi"
lsblk -dn -o NAME,SERIAL
lsblk -o NAME,SIZE,TYPE,MOUNTPOINT
REMOTE
)
printf '%s\n' "$REMOTE_DISCOVERY"

ROOT_SOURCE=$(printf '%s\n' "$REMOTE_DISCOVERY" | sed -n 's/^root_source=//p' | head -n1)
ROOT_FSTYPE=$(printf '%s\n' "$REMOTE_DISCOVERY" | sed -n 's/^root_fstype=//p' | head -n1)
ROOT_DF=$(printf '%s\n' "$REMOTE_DISCOVERY" | sed -n 's/^root_df=//p' | head -n1)
BEFORE_ROOT_SIZE=$(echo "$ROOT_DF" | awk -F'|' '{print $1}')
BEFORE_ROOT_AVAIL=$(echo "$ROOT_DF" | awk -F'|' '{print $2}')
BEFORE_ROOT_USE=$(echo "$ROOT_DF" | awk -F'|' '{print $3}')

if [[ "$ROOT_SOURCE" == /dev/mapper/* || "$ROOT_SOURCE" == /dev/dm-* ]] || printf '%s\n' "$REMOTE_DISCOVERY" | grep -q ' lvm '; then
  echo "LVM detected. Stop and use explicit LVM resize workflow."
  exit 1
fi

if ! parse_root_devices "$ROOT_SOURCE"; then
  echo "Unable to parse root disk/partition from $ROOT_SOURCE"
  exit 1
fi

ROOT_DISK_BASENAME="${ROOT_DISK#/dev/}"
ROOT_SERIAL=$(ssh -i "$SSH_KEY_PATH" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$SSH_USER@$HOST_RESOLVED" "lsblk -dn -o NAME,SERIAL | awk '\$1==\"$ROOT_DISK_BASENAME\" {print \$2}'")
ROOT_VOL_ID=""
if [[ "$ROOT_SERIAL" =~ ^vol[0-9a-fA-F]+$ ]]; then
  ROOT_VOL_ID="vol-${ROOT_SERIAL#vol}"
elif [[ "$ROOT_SERIAL" =~ ^vol-?[0-9a-fA-F]+$ ]]; then
  ROOT_VOL_ID="vol-${ROOT_SERIAL#vol-}"
fi

CURRENT_DISK_BYTES=$(ssh -i "$SSH_KEY_PATH" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$SSH_USER@$HOST_RESOLVED" "lsblk -bn -o SIZE '$ROOT_DISK' | head -n1")
CURRENT_GB=$(( (CURRENT_DISK_BYTES + 1024*1024*1024 - 1) / (1024*1024*1024) ))
if (( CURRENT_GB >= TARGET_GB )); then
  TARGET_GB="$CURRENT_GB"
fi

say "Manual AWS console step"
echo "1) EC2 -> Volumes"
if [[ -n "$ROOT_VOL_ID" ]]; then
  echo "2) Select root volume: $ROOT_VOL_ID"
else
  echo "2) Open instance $INSTANCE_ID Storage tab and select root volume"
fi
echo "3) Snapshot first: pre-resize-root-$(date -u +%Y%m%d-%H%M%S)"
echo "4) Modify volume to ${TARGET_GB} GiB"
echo "5) Wait for state 'optimizing' or 'completed'"
read -r -p "Press ENTER to continue... " _

say "Wait for disk resize visibility"
EXPECTED_BYTES=$((TARGET_GB * 1024 * 1024 * 1024))
if (( CURRENT_DISK_BYTES < EXPECTED_BYTES )); then
  for i in $(seq 1 20); do
    NOW_BYTES=$(ssh -i "$SSH_KEY_PATH" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$SSH_USER@$HOST_RESOLVED" "lsblk -bn -o SIZE '$ROOT_DISK' | head -n1")
    echo "poll=$i now_bytes=$NOW_BYTES expected>=$EXPECTED_BYTES"
    if (( NOW_BYTES >= EXPECTED_BYTES )); then
      break
    fi
    if (( i == 20 )); then
      echo "Disk did not reflect new size in time."
      exit 1
    fi
    sleep 30
  done
else
  echo "Disk already at/above target."
fi

say "Grow partition and filesystem"
ssh -i "$SSH_KEY_PATH" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$SSH_USER@$HOST_RESOLVED" "ROOT_DISK='$ROOT_DISK' ROOT_PART_NUM='$ROOT_PART_NUM' ROOT_SOURCE='$ROOT_SOURCE' ROOT_FSTYPE='$ROOT_FSTYPE' bash -se" <<'REMOTE'
set -euo pipefail
sudo apt-get update -y
sudo apt-get install -y cloud-guest-utils
set +e
grow_out=$(sudo growpart "$ROOT_DISK" "$ROOT_PART_NUM" 2>&1)
grow_rc=$?
set -e
echo "$grow_out"
if [[ $grow_rc -ne 0 ]] && ! echo "$grow_out" | grep -q "NOCHANGE"; then
  exit $grow_rc
fi
if [[ "$ROOT_FSTYPE" == "ext4" ]]; then
  sudo resize2fs "$ROOT_SOURCE"
elif [[ "$ROOT_FSTYPE" == "xfs" ]]; then
  sudo xfs_growfs /
else
  echo "Unsupported fs type: $ROOT_FSTYPE"
  exit 1
fi
df -h /
REMOTE

AFTER_ROOT_DF=$(ssh -i "$SSH_KEY_PATH" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$SSH_USER@$HOST_RESOLVED" "df -h / | awk 'NR==2 {print \$2"|"\$4"|"\$5}'")
AFTER_ROOT_SIZE=$(echo "$AFTER_ROOT_DF" | awk -F'|' '{print $1}')
AFTER_ROOT_AVAIL=$(echo "$AFTER_ROOT_DF" | awk -F'|' '{print $2}')
AFTER_ROOT_USE=$(echo "$AFTER_ROOT_DF" | awk -F'|' '{print $3}')

say "Apply journald caps and cleanup timer"
ssh -i "$SSH_KEY_PATH" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$SSH_USER@$HOST_RESOLVED" 'bash -se' <<'REMOTE'
set -euo pipefail
sudo mkdir -p /etc/systemd/journald.conf.d
cat <<'CONF' | sudo tee /etc/systemd/journald.conf.d/ldc.conf >/dev/null
[Journal]
SystemMaxUse=200M
SystemKeepFree=1G
RuntimeMaxUse=100M
CONF
sudo systemctl restart systemd-journald

cat <<'SCRIPT' | sudo tee /usr/local/sbin/ldc-disk-cleanup.sh >/dev/null
#!/usr/bin/env bash
set -euo pipefail
LOG_FILE="/var/log/ldc_disk_cleanup.log"
{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ldc-disk-cleanup: start"
  journalctl --vacuum-time=7d || true
  apt-get clean || true
  rm -rf /var/lib/apt/lists/* || true
  rm -rf /var/cache/apt/archives/*.deb /var/cache/apt/archives/partial/* || true
  find /var/log -maxdepth 1 -type f \( -name '*.1' -o -name '*.gz' \) -print -delete || true
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ldc-disk-cleanup: done"
} >> "$LOG_FILE" 2>&1
SCRIPT

sudo chmod 0755 /usr/local/sbin/ldc-disk-cleanup.sh
sudo chown root:root /usr/local/sbin/ldc-disk-cleanup.sh

cat <<'UNIT' | sudo tee /etc/systemd/system/ldc-disk-cleanup.service >/dev/null
[Unit]
Description=LDC disk cleanup

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/ldc-disk-cleanup.sh
UNIT

cat <<'TIMER' | sudo tee /etc/systemd/system/ldc-disk-cleanup.timer >/dev/null
[Unit]
Description=Run LDC disk cleanup daily

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
TIMER

sudo systemctl daemon-reload
sudo systemctl enable --now ldc-disk-cleanup.timer
journalctl --disk-usage
systemctl list-timers --all | grep ldc-disk-cleanup || true
REMOTE

say "Health and ownership verification"
HEALTH_HTTP=$(curl -sS -m 20 -o /tmp/phase1_health_body.txt -w '%{http_code}' "$BACKEND_BASE/health" || echo "000")
HEALTH_BODY=$(tr -d '\r\n' < /tmp/phase1_health_body.txt 2>/dev/null || true)

REMOTE_VERIFY=$(ssh -i "$SSH_KEY_PATH" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$SSH_USER@$HOST_RESOLVED" 'bash -se' <<'REMOTE'
set -euo pipefail
echo "ssm_amazon=$(systemctl is-active amazon-ssm-agent 2>/dev/null || true)"
echo "ssm_snap=$(systemctl is-active snap.amazon-ssm-agent.amazon-ssm-agent.service 2>/dev/null || true)"
line=$(sudo ss -ltnp | awk '/:9000/ {print; exit}')
echo "port_line=$line"
pid=$(echo "$line" | sed -n 's/.*pid=\([0-9]\+\).*/\1/p')
if [[ -n "$pid" ]]; then
  echo "port_cmd=$(ps -p "$pid" -o cmd=)"
fi
echo "systemd_medusa=$(systemctl is-active medusa-backend || true)"
if pm2 ls 2>/dev/null | grep -qE 'medusa.*online'; then
  echo "pm2_medusa=online"
elif pm2 ls 2>/dev/null | grep -qE 'medusa'; then
  echo "pm2_medusa=present_not_online"
else
  echo "pm2_medusa=absent"
fi
REMOTE
)
printf '%s\n' "$REMOTE_VERIFY"

say "Trigger deploy workflow (if gh is available)"
DEPLOY_RESULT="skipped"
if command -v gh >/dev/null 2>&1; then
  gh workflow run deploy-backend.yml
  sleep 2
  run_id=$(gh run list --workflow deploy-backend.yml --limit 1 --json databaseId --jq '.[0].databaseId')
  echo "deploy_run_url=https://github.com/$(gh repo view --json nameWithOwner --jq .nameWithOwner)/actions/runs/$run_id"
  if gh run watch "$run_id" --interval 10 --exit-status; then
    DEPLOY_RESULT="success"
  else
    DEPLOY_RESULT="failure"
    gh run view "$run_id" --log-failed || true
  fi
fi
echo "deploy_result=$DEPLOY_RESULT"

say "Optional PayPal deep verification"
echo "Skipped in committed script to avoid secret-handling patterns."
echo "If needed, run a one-off helper under /tmp or artifacts/ (gitignored), not from committed ops scripts."

say "Summary"
echo "before_root=$BEFORE_ROOT_SIZE (used $BEFORE_ROOT_USE)"
echo "after_root=$AFTER_ROOT_SIZE (used $AFTER_ROOT_USE)"
echo "backend_health_http=$HEALTH_HTTP body=$HEALTH_BODY"
