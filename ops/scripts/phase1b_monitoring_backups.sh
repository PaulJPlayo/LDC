#!/usr/bin/env bash
set -euo pipefail

INSTANCE_ID="${INSTANCE_ID:-i-0b14413f966a0843e}"
AWS_REGION="${AWS_REGION:-us-east-2}"
ROOT_VOLUME_ID="${ROOT_VOLUME_ID:-vol-0f7e137e21f97dedd}"
SSH_USER="${SSH_USER:-ubuntu}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/Documents/LDC/ldc-medusa-key.pem}"
HOST="${HOST:-}"
HOST_FALLBACK="${HOST_FALLBACK:-18.223.116.91}"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-https://api.lovettsldc.com/health}"

say() {
  printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1"
    exit 1
  }
}

resolve_host() {
  if [[ -n "$HOST" ]]; then
    echo "$HOST"
    return
  fi

  if command -v aws >/dev/null 2>&1; then
    local aws_ip
    aws_ip=$(aws ec2 describe-instances \
      --region "$AWS_REGION" \
      --instance-ids "$INSTANCE_ID" \
      --query 'Reservations[0].Instances[0].PublicIpAddress' \
      --output text 2>/dev/null || true)
    if [[ -n "$aws_ip" && "$aws_ip" != "None" && "$aws_ip" != "null" ]]; then
      echo "$aws_ip"
      return
    fi
  fi

  echo "$HOST_FALLBACK"
}

require_cmd ssh
require_cmd curl

say "Phase 1B server-side monitoring setup"
echo "instance_id=$INSTANCE_ID region=$AWS_REGION root_volume_id=$ROOT_VOLUME_ID"

if [[ ! -f "$SSH_KEY_PATH" ]]; then
  echo "SSH key not found at $SSH_KEY_PATH"
  exit 1
fi
chmod 400 "$SSH_KEY_PATH"

TARGET_HOST=$(resolve_host)
if [[ -z "$TARGET_HOST" ]]; then
  echo "Unable to determine host. Set HOST or HOST_FALLBACK."
  exit 1
fi

echo "target_host=$TARGET_HOST"

set +e
if command -v nc >/dev/null 2>&1; then
  nc -z -w 5 "$TARGET_HOST" 22
  SSH_PORT_RC=$?
else
  timeout 5 bash -c "</dev/tcp/$TARGET_HOST/22" >/dev/null 2>&1
  SSH_PORT_RC=$?
fi
set -e

if [[ $SSH_PORT_RC -ne 0 ]]; then
  echo "SSH port 22 is not reachable on $TARGET_HOST"
  exit 1
fi

if ! ssh -i "$SSH_KEY_PATH" \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o ConnectTimeout=8 \
  "$SSH_USER@$TARGET_HOST" 'echo ssh_ok' | grep -q '^ssh_ok$'; then
  echo "SSH authentication/connectivity failed"
  exit 1
fi

say "Pre-checks (disk/SSM/backend health)"
ssh -i "$SSH_KEY_PATH" \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  "$SSH_USER@$TARGET_HOST" 'bash -se' <<'REMOTE'
set -euo pipefail

echo "=== df -h / ==="
df -h /

echo "=== df -i / ==="
df -i /

echo "=== ssm service status ==="
if systemctl is-active --quiet snap.amazon-ssm-agent.amazon-ssm-agent.service; then
  echo "ssm_service=active (snap.amazon-ssm-agent.amazon-ssm-agent.service)"
elif systemctl is-active --quiet amazon-ssm-agent.service; then
  echo "ssm_service=active (amazon-ssm-agent.service)"
else
  echo "ssm_service=inactive"
fi

echo "=== medusa ownership on :9000 ==="
PORT_LINE=$(sudo ss -ltnp | awk '/:9000/ {print; exit}')
echo "$PORT_LINE"
PORT_PID=$(echo "$PORT_LINE" | sed -n 's/.*pid=\([0-9]\+\).*/\1/p')
if [[ -n "$PORT_PID" ]]; then
  ps -p "$PORT_PID" -o pid=,cmd=
fi

echo "=== pm2 list ==="
pm2 ls || true
REMOTE

HEALTH_HTTP=$(curl -sS -m 20 -o /tmp/phase1b_health_body.txt -w '%{http_code}' "$BACKEND_HEALTH_URL" || echo "000")
HEALTH_BODY=$(tr -d '\r\n' < /tmp/phase1b_health_body.txt 2>/dev/null || true)
echo "backend_health_http=$HEALTH_HTTP"
echo "backend_health_body=$HEALTH_BODY"

if [[ "$HEALTH_HTTP" != "200" ]]; then
  echo "Backend health check failed. Stopping to avoid risky changes."
  exit 1
fi

say "Install/Configure CloudWatch agent"
ssh -i "$SSH_KEY_PATH" \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  "$SSH_USER@$TARGET_HOST" 'bash -se' <<'REMOTE'
set -euo pipefail

if ! command -v /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl >/dev/null 2>&1; then
  echo "CloudWatch Agent not present; installing..."
  sudo apt-get update -y
  if ! sudo apt-get install -y amazon-cloudwatch-agent; then
    echo "apt package unavailable; downloading official .deb"
    TMP_DEB="/tmp/amazon-cloudwatch-agent.deb"
    curl -fsSL "https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb" -o "$TMP_DEB"
    sudo dpkg -i "$TMP_DEB"
  fi
else
  echo "CloudWatch Agent already installed"
fi

sudo mkdir -p /opt/aws/amazon-cloudwatch-agent/etc
cat <<'CWCFG' | sudo tee /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json >/dev/null
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "root"
  },
  "metrics": {
    "namespace": "CWAgent",
    "append_dimensions": {
      "InstanceId": "${aws:InstanceId}"
    },
    "metrics_collected": {
      "disk": {
        "measurement": [
          "used_percent"
        ],
        "metrics_collection_interval": 60,
        "resources": [
          "/"
        ]
      },
      "mem": {
        "measurement": [
          "mem_used_percent"
        ],
        "metrics_collection_interval": 60
      },
      "swap": {
        "measurement": [
          "swap_used_percent"
        ],
        "metrics_collection_interval": 60
      }
    }
  }
}
CWCFG

sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json \
  -s

if systemctl list-unit-files | grep -q '^amazon-cloudwatch-agent.service'; then
  sudo systemctl enable amazon-cloudwatch-agent
fi

echo "=== cloudwatch agent status ==="
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status || true
systemctl is-active amazon-cloudwatch-agent || true

echo "=== cloudwatch agent log tail ==="
if [[ -f /opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log ]]; then
  sudo tail -n 100 /opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log
else
  echo "cloudwatch_agent_log_missing"
fi

echo "=== cloudwatch publish permission check ==="
if [[ -f /opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log ]]; then
  if sudo tail -n 300 /opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log | grep -q 'AccessDenied.*cloudwatch:PutMetricData'; then
    echo "cwagent_putmetricdata_permission=missing"
    echo "action_required=attach_cloudwatch_putmetricdata_permissions_to_instance_role"
    echo "suggested_policy=CloudWatchAgentServerPolicy"
  else
    echo "cwagent_putmetricdata_permission=ok"
  fi
fi
REMOTE

say "Phase 1B server-side setup complete"
echo "manual_aws_required=true"
if ! command -v aws >/dev/null 2>&1; then
  echo "reason=aws_cli_not_available_locally"
else
  echo "reason=aws_cli_available_but_not_used_for_safety"
fi
