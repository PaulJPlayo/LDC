#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

mkdir -p artifacts
LOG_FILE="artifacts/phase2_e2e_commerce_verification.log"
SUMMARY_FILE="artifacts/phase2_e2e_commerce_verification.md"
: > "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

START_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

INSTANCE_ID="${INSTANCE_ID:-i-0b14413f966a0843e}"
AWS_REGION="${AWS_REGION:-us-east-2}"
HOST_FALLBACK="${HOST_FALLBACK:-18.223.116.91}"
HOST="${HOST:-$HOST_FALLBACK}"
SSH_USER="${SSH_USER:-ubuntu}"
KEY_PATH="${KEY_PATH:-$HOME/Documents/LDC/ldc-medusa-key.pem}"
BACKEND_BASE="${BACKEND_BASE:-https://api.lovettsldc.com}"
HEALTH_URL="${HEALTH_URL:-https://api.lovettsldc.com/health}"
STOREFRONT_MARKER_URL="${STOREFRONT_MARKER_URL:-https://lovettsldc.com/commerce.js}"
DEPLOY_WORKFLOW="${DEPLOY_WORKFLOW:-deploy-backend.yml}"

SSH_REACHABLE="NO"
HEALTH_OK="NO"
SSM_ACTIVE="NO"
CWAGENT_ACTIVE="NO"
CWAGENT_PUTMETRICDATA_NOT_DENIED="NO"
CLEANUP_TIMER_OK="NO"
JOURNAL_UNDER_250MB="NO"
PORT_9000_OWNERSHIP_OK="NO"
STOREFRONT_MARKER_EXTRACTED="NO"
STORE_API_SKELETON_OK="NO"
PAYPAL_SESSION_CREATED="NO"
OPTIONAL_PAYPAL_AMOUNT_MATCH="SKIPPED"
DEPLOY_VERIFIED="SKIPPED"

HOST_USED="$HOST"
HEALTH_HTTP=""
HEALTH_BODY=""
CWAGENT_STATUS=""
CWAGENT_DENIED_RECENT=""
CLEANUP_TIMER_ENABLED=""
CLEANUP_TIMER_NEXT=""
JOURNAL_DISK_USAGE=""
PORT_LINE=""
PORT_CMD=""
PORT_PID=""
MEDUSA_MAIN_PID=""
PM2_MEDUSA_ONLINE=""
REMOTE_GIT_HEAD=""
REMOTE_GIT_LOG=""

STOREFRONT_BUILD_SHA=""
STOREFRONT_BUILD_UTC=""
PUBLISHABLE_KEY=""
PUBLISHABLE_KEY_MASKED=""

REGION_ID=""
PRODUCT_ID=""
VARIANT_ID=""
CART_ID=""
SHIPPING_OPTION_ID=""
PAYMENT_COLLECTION_ID=""
PAYPAL_PROVIDER_ID=""
PAYPAL_ORDER_ID=""
CART_TOTAL_MINOR=""
EXPECTED_MAJOR=""
CURRENCY_CODE=""
TAX_POST_STATUS=""

DEPLOY_RUN_ID=""
DEPLOY_RUN_URL=""
DEPLOY_CONCLUSION=""

say() {
  printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

finish() {
  local rc="$?"
  local end_utc
  end_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  cat > "$SUMMARY_FILE" <<EOF_SUMMARY
# Phase 2 E2E Commerce Verification

Generated (UTC): $end_utc
Script exit code: $rc

## Targets
- Instance: $INSTANCE_ID
- Region: $AWS_REGION
- Host used: $HOST_USED
- Backend: $BACKEND_BASE
- Health endpoint: $HEALTH_URL

## Platform Snapshot
- SSM active: $SSM_ACTIVE
- CWAgent active: $CWAGENT_ACTIVE
- CWAgent PutMetricData denied in recent log lines: $CWAGENT_DENIED_RECENT
- Cleanup timer enabled: $CLEANUP_TIMER_ENABLED
- Cleanup timer next: $CLEANUP_TIMER_NEXT
- Journald disk usage: $JOURNAL_DISK_USAGE
- Port 9000 line: $PORT_LINE
- Port 9000 cmd: $PORT_CMD
- medusa-backend MainPID: $MEDUSA_MAIN_PID
- Port listener pid: $PORT_PID
- pm2 medusa online: $PM2_MEDUSA_ONLINE
- Remote git HEAD: $REMOTE_GIT_HEAD
- Remote git recent: $REMOTE_GIT_LOG

## Public/Store Checks
- Health HTTP: $HEALTH_HTTP
- Health body: $HEALTH_BODY
- STOREFRONT_BUILD_SHA: $STOREFRONT_BUILD_SHA
- STOREFRONT_BUILD_UTC: $STOREFRONT_BUILD_UTC
- Publishable key (masked): $PUBLISHABLE_KEY_MASKED

## Store API Checkout Skeleton
- region_id: $REGION_ID
- product_id: $PRODUCT_ID
- variant_id: $VARIANT_ID
- cart_id: $CART_ID
- shipping_option_id: $SHIPPING_OPTION_ID
- payment_collection_id: $PAYMENT_COLLECTION_ID
- paypal_provider_id: $PAYPAL_PROVIDER_ID
- paypal_order_id: $PAYPAL_ORDER_ID
- currency_code: $CURRENCY_CODE
- cart_total_minor: $CART_TOTAL_MINOR
- expected_major: $EXPECTED_MAJOR
- taxes_post_status: $TAX_POST_STATUS

## Deploy Verification
- deploy_run_id: $DEPLOY_RUN_ID
- deploy_run_url: $DEPLOY_RUN_URL
- deploy_conclusion: $DEPLOY_CONCLUSION

## PASS/FAIL Checklist
- [${SSH_REACHABLE/YES/x}] SSH reachable
- [${HEALTH_OK/YES/x}] /health 200
- [${SSM_ACTIVE/YES/x}] SSM active
- [${CWAGENT_ACTIVE/YES/x}] CWAgent active
- [${CWAGENT_PUTMETRICDATA_NOT_DENIED/YES/x}] CWAgent PutMetricData not denied (recent lines)
- [${CLEANUP_TIMER_OK/YES/x}] cleanup timer enabled + next run scheduled
- [${JOURNAL_UNDER_250MB/YES/x}] journald disk usage < 250MB
- [${PORT_9000_OWNERSHIP_OK/YES/x}] port 9000 owned by systemd medusa-backend; PM2 medusa not online
- [${STOREFRONT_MARKER_EXTRACTED/YES/x}] storefront marker extracted
- [${STORE_API_SKELETON_OK/YES/x}] store API checkout skeleton completed
- [${PAYPAL_SESSION_CREATED/YES/x}] paypal session created (order id present)
- [${OPTIONAL_PAYPAL_AMOUNT_MATCH/YES/x}] optional paypal amount_match=true (if helper executed)
EOF_SUMMARY

  echo "summary_file=$SUMMARY_FILE"
  echo "log_file=$LOG_FILE"
}
trap finish EXIT

say "A) Clear lingering watchers (safe patterns)"
ps aux | egrep -i 'gh run watch|phase1b_monitoring_backups|phase1_storage_hardening|phase0_baseline|tail -f' | grep -v egrep || true
pkill -f 'gh run watch' || true
pkill -f 'phase1b_monitoring_backups' || true
pkill -f 'phase1_storage_hardening' || true
pkill -f 'phase0_baseline' || true
pkill -f 'tail -f' || true
ps aux | egrep -i 'gh run watch|phase1b_monitoring_backups|phase1_storage_hardening|phase0_baseline|tail -f' | grep -v egrep || true

say "B) Local preflight"
for c in ssh curl jq; do
  command -v "$c" >/dev/null 2>&1 || { echo "missing_command=$c"; exit 20; }
done
if command -v gh >/dev/null 2>&1; then
  echo "gh_available=true"
else
  echo "gh_available=false"
fi

if [[ ! -f "$KEY_PATH" ]]; then
  echo "stop_reason=ssh_key_missing:$KEY_PATH"
  exit 21
fi
chmod 400 "$KEY_PATH"

echo "host_used=$HOST_USED"

set +e
if command -v nc >/dev/null 2>&1; then
  nc -z -w 5 "$HOST_USED" 22
  PORT22_RC=$?
else
  timeout 5 bash -c "</dev/tcp/$HOST_USED/22" >/dev/null 2>&1
  PORT22_RC=$?
fi
set -e
if [[ $PORT22_RC -ne 0 ]]; then
  echo "stop_reason=ssh_port_22_unreachable"
  exit 22
fi

SSH_BASE=(ssh -i "$KEY_PATH" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$SSH_USER@$HOST_USED")
set +e
SSH_PROBE="$(${SSH_BASE[@]} 'echo ssh_ok' 2>/tmp/phase2_ssh_err.txt)"
SSH_RC=$?
set -e
if [[ $SSH_RC -ne 0 || "$SSH_PROBE" != "ssh_ok" ]]; then
  echo "stop_reason=ssh_probe_failed"
  sed -n '1,80p' /tmp/phase2_ssh_err.txt || true
  exit 23
fi
SSH_REACHABLE="YES"

say "C) SSH read-only platform checks"
REMOTE_OUT="$(${SSH_BASE[@]} 'bash -se' <<'REMOTE'
set -euo pipefail

df_h_root=$(df -h / | awk 'NR==2 {print $2"|"$4"|"$5}')
df_i_root=$(df -i / | awk 'NR==2 {print $5}')

ssm_active="inactive"
if systemctl is-active --quiet snap.amazon-ssm-agent.amazon-ssm-agent.service; then
  ssm_active="active"
elif systemctl is-active --quiet amazon-ssm-agent.service; then
  ssm_active="active"
fi

cwagent_active=$(systemctl is-active amazon-cloudwatch-agent 2>/dev/null || true)
cwagent_denied_recent="unknown"
if [[ -f /opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log ]]; then
  if sudo tail -n 120 /opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log | grep -q 'AccessDenied.*cloudwatch:PutMetricData'; then
    cwagent_denied_recent="yes"
  else
    cwagent_denied_recent="no"
  fi
fi

cleanup_timer_enabled=$(systemctl is-enabled ldc-disk-cleanup.timer 2>/dev/null || true)
cleanup_timer_next=$(systemctl list-timers ldc-disk-cleanup.timer --all --no-legend | awk '{print $1" "$2" "$3" "$4" "$5" "$6}' | head -n1)
journal_disk_usage=$(journalctl --disk-usage 2>/dev/null || true)

port_line=$(sudo ss -ltnp | awk '/:9000/ {print; exit}')
port_pid=$(echo "$port_line" | sed -n 's/.*pid=\([0-9]\+\).*/\1/p')
port_cmd=""
if [[ -n "$port_pid" ]]; then
  port_cmd=$(ps -p "$port_pid" -o cmd= || true)
fi
medusa_active=$(systemctl is-active medusa-backend || true)
medusa_main_pid=$(systemctl show -p MainPID --value medusa-backend || true)
pm2_medusa_online="no"
if pm2 ls 2>/dev/null | grep -qE 'medusa.*online'; then
  pm2_medusa_online="yes"
fi

remote_git_head=$(cd /home/ubuntu/ldc-medusa && git rev-parse HEAD)
remote_git_log=$(cd /home/ubuntu/ldc-medusa && git log -n 3 --oneline | tr '\n' ';')

echo "df_h_root=$df_h_root"
echo "df_i_root=$df_i_root"
echo "ssm_active=$ssm_active"
echo "cwagent_active=$cwagent_active"
echo "cwagent_denied_recent=$cwagent_denied_recent"
echo "cleanup_timer_enabled=$cleanup_timer_enabled"
echo "cleanup_timer_next=$cleanup_timer_next"
echo "journal_disk_usage=$journal_disk_usage"
echo "port_line=$port_line"
echo "port_pid=$port_pid"
echo "port_cmd=$port_cmd"
echo "medusa_active=$medusa_active"
echo "medusa_main_pid=$medusa_main_pid"
echo "pm2_medusa_online=$pm2_medusa_online"
echo "remote_git_head=$remote_git_head"
echo "remote_git_log=$remote_git_log"
REMOTE
)"

printf '%s\n' "$REMOTE_OUT"

SSM_ACTIVE_RAW="$(printf '%s\n' "$REMOTE_OUT" | sed -n 's/^ssm_active=//p' | tail -n1)"
CWAGENT_STATUS="$(printf '%s\n' "$REMOTE_OUT" | sed -n 's/^cwagent_active=//p' | tail -n1)"
CWAGENT_DENIED_RECENT="$(printf '%s\n' "$REMOTE_OUT" | sed -n 's/^cwagent_denied_recent=//p' | tail -n1)"
CLEANUP_TIMER_ENABLED="$(printf '%s\n' "$REMOTE_OUT" | sed -n 's/^cleanup_timer_enabled=//p' | tail -n1)"
CLEANUP_TIMER_NEXT="$(printf '%s\n' "$REMOTE_OUT" | sed -n 's/^cleanup_timer_next=//p' | tail -n1)"
JOURNAL_DISK_USAGE="$(printf '%s\n' "$REMOTE_OUT" | sed -n 's/^journal_disk_usage=//p' | tail -n1)"
PORT_LINE="$(printf '%s\n' "$REMOTE_OUT" | sed -n 's/^port_line=//p' | tail -n1)"
PORT_PID="$(printf '%s\n' "$REMOTE_OUT" | sed -n 's/^port_pid=//p' | tail -n1)"
PORT_CMD="$(printf '%s\n' "$REMOTE_OUT" | sed -n 's/^port_cmd=//p' | tail -n1)"
MEDUSA_ACTIVE="$(printf '%s\n' "$REMOTE_OUT" | sed -n 's/^medusa_active=//p' | tail -n1)"
MEDUSA_MAIN_PID="$(printf '%s\n' "$REMOTE_OUT" | sed -n 's/^medusa_main_pid=//p' | tail -n1)"
PM2_MEDUSA_ONLINE="$(printf '%s\n' "$REMOTE_OUT" | sed -n 's/^pm2_medusa_online=//p' | tail -n1)"
REMOTE_GIT_HEAD="$(printf '%s\n' "$REMOTE_OUT" | sed -n 's/^remote_git_head=//p' | tail -n1)"
REMOTE_GIT_LOG="$(printf '%s\n' "$REMOTE_OUT" | sed -n 's/^remote_git_log=//p' | tail -n1)"

if [[ "$SSM_ACTIVE_RAW" == "active" ]]; then
  SSM_ACTIVE="YES"
fi
if [[ "$CWAGENT_STATUS" == "active" ]]; then
  CWAGENT_ACTIVE="YES"
fi
if [[ "$CWAGENT_DENIED_RECENT" == "no" ]]; then
  CWAGENT_PUTMETRICDATA_NOT_DENIED="YES"
fi
if [[ "$CLEANUP_TIMER_ENABLED" == "enabled" && -n "$CLEANUP_TIMER_NEXT" ]]; then
  CLEANUP_TIMER_OK="YES"
fi
if [[ "$JOURNAL_DISK_USAGE" =~ ([0-9]+(\.[0-9]+)?)M ]]; then
  JOURNAL_MB="${BASH_REMATCH[1]}"
  if awk "BEGIN {exit !($JOURNAL_MB < 250)}"; then
    JOURNAL_UNDER_250MB="YES"
  fi
elif [[ "$JOURNAL_DISK_USAGE" =~ ([0-9]+(\.[0-9]+)?)K ]]; then
  JOURNAL_UNDER_250MB="YES"
fi

if [[ -n "$PORT_PID" && -n "$MEDUSA_MAIN_PID" && "$PORT_PID" == "$MEDUSA_MAIN_PID" && "$MEDUSA_ACTIVE" == "active" && "$PM2_MEDUSA_ONLINE" == "no" && "$PORT_CMD" == *"/home/ubuntu/ldc-medusa/medusa-backend/node_modules/@medusajs/cli/cli.js start"* ]]; then
  PORT_9000_OWNERSHIP_OK="YES"
fi

if [[ "$PORT_9000_OWNERSHIP_OK" != "YES" ]]; then
  echo "stop_reason=port_9000_not_owned_by_systemd_medusa_or_pm2_online"
  exit 24
fi

say "D) Public checks"
HEALTH_HTTP=$(curl -sS -m 20 -o /tmp/phase2_health_body.txt -w '%{http_code}' "$HEALTH_URL" || echo "000")
HEALTH_BODY=$(tr -d '\r\n' < /tmp/phase2_health_body.txt 2>/dev/null || true)
if [[ "$HEALTH_HTTP" == "200" ]]; then
  HEALTH_OK="YES"
else
  echo "stop_reason=backend_health_not_200"
  exit 25
fi

curl -sS -m 20 "$STOREFRONT_MARKER_URL" -o /tmp/phase2_commerce.js
STOREFRONT_BUILD_SHA=$(grep -oE "STOREFRONT_BUILD_SHA[[:space:]]*=[[:space:]]*'[^']+'" /tmp/phase2_commerce.js | head -n1 | sed -E "s/.*'([^']+)'.*/\1/" || true)
STOREFRONT_BUILD_UTC=$(grep -oE "STOREFRONT_BUILD_UTC[[:space:]]*=[[:space:]]*'[^']+'" /tmp/phase2_commerce.js | head -n1 | sed -E "s/.*'([^']+)'.*/\1/" || true)
PUBLISHABLE_KEY=$(grep -oE 'pk_[A-Za-z0-9]+' /tmp/phase2_commerce.js | head -n1 || true)
if [[ -n "$PUBLISHABLE_KEY" ]]; then
  STOREFRONT_MARKER_EXTRACTED="YES"
  PUBLISHABLE_KEY_MASKED="${PUBLISHABLE_KEY:0:8}..."
else
  echo "stop_reason=publishable_key_not_found_in_commerce_js"
  exit 26
fi

say "E) Store API checkout skeleton"
HDR_PUB=(-H "x-publishable-api-key: $PUBLISHABLE_KEY")
HDR_JSON=(-H "Content-Type: application/json")

REGIONS_JSON=$(curl -sS "$BACKEND_BASE/store/regions" "${HDR_PUB[@]}")
REGION_ID=$(printf '%s' "$REGIONS_JSON" | jq -r '.regions[0].id')

PRODUCTS_JSON=$(curl -sS "$BACKEND_BASE/store/products?limit=1&fields=id,title,variants.id&region_id=$REGION_ID" "${HDR_PUB[@]}")
PRODUCT_ID=$(printf '%s' "$PRODUCTS_JSON" | jq -r '.products[0].id')
VARIANT_ID=$(printf '%s' "$PRODUCTS_JSON" | jq -r '.products[0].variants[0].id')

CART_CREATE_JSON=$(curl -sS -X POST "$BACKEND_BASE/store/carts" "${HDR_JSON[@]}" "${HDR_PUB[@]}" -d "{\"region_id\":\"$REGION_ID\"}")
CART_ID=$(printf '%s' "$CART_CREATE_JSON" | jq -r '.cart.id')

curl -sS -X POST "$BACKEND_BASE/store/carts/$CART_ID/line-items" "${HDR_JSON[@]}" "${HDR_PUB[@]}" -d "{\"variant_id\":\"$VARIANT_ID\",\"quantity\":1}" >/dev/null

curl -sS -X POST "$BACKEND_BASE/store/carts/$CART_ID" "${HDR_JSON[@]}" "${HDR_PUB[@]}" -d '{"email":"phase2-e2e@example.com","shipping_address":{"first_name":"Phase2","last_name":"E2E","address_1":"123 Main St","city":"Columbus","province":"OH","postal_code":"43215","country_code":"us","phone":"5555555555"},"billing_address":{"first_name":"Phase2","last_name":"E2E","address_1":"123 Main St","city":"Columbus","province":"OH","postal_code":"43215","country_code":"us","phone":"5555555555"}}' >/dev/null

SHIP_JSON=$(curl -sS "$BACKEND_BASE/store/shipping-options?cart_id=$CART_ID" "${HDR_PUB[@]}")
SHIPPING_OPTION_ID=$(printf '%s' "$SHIP_JSON" | jq -r '.shipping_options[0].id')

curl -sS -X POST "$BACKEND_BASE/store/carts/$CART_ID/shipping-methods" "${HDR_JSON[@]}" "${HDR_PUB[@]}" -d "{\"option_id\":\"$SHIPPING_OPTION_ID\"}" >/dev/null

set +e
TAX_BODY=$(curl -sS -X POST "$BACKEND_BASE/store/carts/$CART_ID/taxes" "${HDR_PUB[@]}")
TAX_RC=$?
set -e
if [[ $TAX_RC -eq 0 ]]; then
  TAX_POST_STATUS="ok"
else
  TAX_POST_STATUS="failed"
fi

echo "tax_post_status=$TAX_POST_STATUS"

CART_JSON=$(curl -sS "$BACKEND_BASE/store/carts/$CART_ID" "${HDR_PUB[@]}")
CART_TOTAL_MINOR=$(printf '%s' "$CART_JSON" | jq -r '.cart.total')
CURRENCY_CODE=$(printf '%s' "$CART_JSON" | jq -r '.cart.currency_code' | tr '[:lower:]' '[:upper:]')

PROVIDERS_JSON=$(curl -sS "$BACKEND_BASE/store/payment-providers?region_id=$REGION_ID" "${HDR_PUB[@]}")
PAYPAL_PROVIDER_ID=$(printf '%s' "$PROVIDERS_JSON" | jq -r '.payment_providers[] | select(.id|test("paypal")) | .id' | head -n1)

PC_JSON=$(curl -sS -X POST "$BACKEND_BASE/store/payment-collections" "${HDR_JSON[@]}" "${HDR_PUB[@]}" -d "{\"cart_id\":\"$CART_ID\"}")
PAYMENT_COLLECTION_ID=$(printf '%s' "$PC_JSON" | jq -r '.payment_collection.id')

RET_URL="https://lovettsldc.com/checkout"
PS_JSON=$(curl -sS -X POST "$BACKEND_BASE/store/payment-collections/$PAYMENT_COLLECTION_ID/payment-sessions" "${HDR_JSON[@]}" "${HDR_PUB[@]}" -d "{\"provider_id\":\"$PAYPAL_PROVIDER_ID\",\"data\":{\"return_url\":\"$RET_URL\",\"cancel_url\":\"$RET_URL\"}}")
PAYPAL_ORDER_ID=$(printf '%s' "$PS_JSON" | jq -r '.payment_collection.payment_sessions[] | select(.provider_id=="'"$PAYPAL_PROVIDER_ID"'") | (.data.order_id // .data.id // .data.token // empty)' | head -n1)

EXPECTED_MAJOR=$(node -e 'const m=Number(process.argv[1]); const c=String(process.argv[2]||"USD").toUpperCase(); const z=new Set(["BIF","CLP","DJF","GNF","JPY","KMF","KRW","MGA","PYG","RWF","UGX","VND","VUV","XAF","XOF","XPF"]); const t=new Set(["BHD","IQD","JOD","KWD","LYD","OMR","TND"]); const d=z.has(c)?0:(t.has(c)?3:2); console.log((m/Math.pow(10,d)).toFixed(d));' "$CART_TOTAL_MINOR" "$CURRENCY_CODE")

if [[ -n "$REGION_ID" && -n "$PRODUCT_ID" && -n "$VARIANT_ID" && -n "$CART_ID" && -n "$PAYMENT_COLLECTION_ID" ]]; then
  STORE_API_SKELETON_OK="YES"
fi
if [[ -n "$PAYPAL_PROVIDER_ID" && -n "$PAYPAL_ORDER_ID" ]]; then
  PAYPAL_SESSION_CREATED="YES"
fi

say "F) Optional deep paypal amount helper (/tmp only, non-committed)"
set +e
HELPER_EXISTS="$(${SSH_BASE[@]} 'if [ -x /tmp/phase2_paypal_amount_check.sh ]; then echo yes; else echo no; fi')"
set -e
if [[ "$HELPER_EXISTS" == "yes" ]]; then
  HELPER_OUT="$(${SSH_BASE[@]} '/tmp/phase2_paypal_amount_check.sh' || true)"
  echo "$HELPER_OUT"
  MATCH_VAL=$(printf '%s\n' "$HELPER_OUT" | sed -n 's/^amount_match=//p' | tail -n1)
  if [[ "$MATCH_VAL" == "true" ]]; then
    OPTIONAL_PAYPAL_AMOUNT_MATCH="YES"
  else
    OPTIONAL_PAYPAL_AMOUNT_MATCH="NO"
  fi
else
  OPTIONAL_PAYPAL_AMOUNT_MATCH="SKIPPED"
fi

say "G) Optional deploy workflow verification"
if command -v gh >/dev/null 2>&1; then
  set +e
  gh auth status >/dev/null 2>&1
  GH_AUTH_RC=$?
  set -e
  if [[ $GH_AUTH_RC -eq 0 ]]; then
    gh workflow run "$DEPLOY_WORKFLOW"
    sleep 2
    DEPLOY_RUN_ID=$(gh run list --workflow "$DEPLOY_WORKFLOW" --limit 1 --json databaseId --jq '.[0].databaseId')
    DEPLOY_RUN_URL="https://github.com/$(gh repo view --json nameWithOwner --jq .nameWithOwner)/actions/runs/$DEPLOY_RUN_ID"
    set +e
    gh run watch "$DEPLOY_RUN_ID" --interval 10 --exit-status
    WATCH_RC=$?
    set -e
    if [[ $WATCH_RC -eq 0 ]]; then
      DEPLOY_CONCLUSION="success"
      DEPLOY_VERIFIED="YES"
    else
      DEPLOY_CONCLUSION="failure"
      DEPLOY_VERIFIED="NO"
      gh run view "$DEPLOY_RUN_ID" --log-failed || true
    fi
  else
    DEPLOY_CONCLUSION="gh_auth_unavailable"
    DEPLOY_VERIFIED="SKIPPED"
  fi
else
  DEPLOY_CONCLUSION="gh_not_available"
  DEPLOY_VERIFIED="SKIPPED"
fi

say "Phase 2 script completed"
