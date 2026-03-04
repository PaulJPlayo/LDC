# Phase 1B Monitoring + Backups Guardrails

## Scope
Operational guardrails for Medusa infrastructure reliability:
- Host-level metrics via CloudWatch Agent
- Alerting via SNS + CloudWatch Alarms
- Automated EBS snapshots via DLM

This phase does not change application code.

## Fixed Targets
- Instance ID: `i-0b14413f966a0843e`
- Region: `us-east-2`
- Root volume: `vol-0f7e137e21f97dedd`
- Backend health endpoint: `https://api.lovettsldc.com/health`

## Confirmed Manual Setup (2026-03-03)
- SNS topic: `ldc-ops-alerts`
- SNS confirmed email (redacted): `oracle***@gmail.com`
- Alarm names:
  - `LDC-EC2-StatusCheckFailed-i-0b14413f966a0843e`
  - `LDC-CWAgent-DiskUsed80-Root-i-0b14413f966a0843e`
  - `LDC-CWAgent-DiskUsed90-Root-i-0b14413f966a0843e`
- Root volume tag: `Backup=Daily14d` on `vol-0f7e137e21f97dedd`
- DLM policy: `LDC-RootVolume-Daily-14d` (daily `03:00 UTC`, retention `14`)

## Script
- Path: `ops/scripts/phase1b_monitoring_backups.sh`
- Purpose:
  - Verifies SSH and host safety checks (`df`, SSM active, backend health)
  - Installs/updates CloudWatch Agent safely (no reboot)
  - Applies CloudWatch Agent config for:
    - `disk.used_percent` (for `/`)
    - `mem.mem_used_percent`
    - `swap.swap_used_percent` (optional but enabled)
  - Starts/enables agent and verifies status/log output
- No secrets are embedded.

## Run
```bash
bash ops/scripts/phase1b_monitoring_backups.sh 2>&1 | tee artifacts/phase1b_monitoring_backups.log
```

Optional overrides:
```bash
INSTANCE_ID=i-0b14413f966a0843e AWS_REGION=us-east-2 HOST=18.223.116.91 bash ops/scripts/phase1b_monitoring_backups.sh
```

## Manual AWS Console Steps (AWS CLI unavailable locally)

### 1) SNS Topic + Email Subscription
1. Open AWS Console in `us-east-2`.
2. Go to **SNS -> Topics -> Create topic**.
3. Type: **Standard**.
4. Name: `ldc-ops-alerts`.
5. Create topic.
6. Open topic -> **Create subscription**:
   - Protocol: `Email`
   - Endpoint: your operations email address
7. Confirm subscription via email link.

### 2) CloudWatch Alarms
Go to **CloudWatch -> Alarms -> Create alarm**.

#### Alarm A: EC2 Status Check Failed (critical)
- Name: `LDC-EC2-StatusCheckFailed-i-0b14413f966a0843e`
- Metric:
  - Namespace: `AWS/EC2`
  - Metric: `StatusCheckFailed`
  - Dimension: `InstanceId=i-0b14413f966a0843e`
- Condition: `>= 1` for `1` datapoint within `5 minutes`
- Action: send notification to SNS topic `ldc-ops-alerts`

#### Alarm B: Root Disk >= 80% (warning)
- Name: `LDC-CWAgent-DiskUsed80-Root-i-0b14413f966a0843e`
- Metric:
  - Namespace: `CWAgent`
  - Metric: `disk_used_percent`
  - Dimension selection from metric explorer for this instance and path `/`
- Condition: `>= 80` for `10 minutes`
- Action: SNS topic `ldc-ops-alerts`

#### Alarm C: Root Disk >= 90% (critical)
- Name: `LDC-CWAgent-DiskUsed90-Root-i-0b14413f966a0843e`
- Metric:
  - Namespace: `CWAgent`
  - Metric: `disk_used_percent`
  - Same disk/path dimensions as Alarm B
- Condition: `>= 90` for `5 minutes`
- Action: SNS topic `ldc-ops-alerts`

#### Alarm D (optional): Memory >= 90% (warning)
- Name: `LDC-CWAgent-MemUsed90-i-0b14413f966a0843e`
- Metric:
  - Namespace: `CWAgent`
  - Metric: `mem_used_percent`
  - Dimension: `InstanceId=i-0b14413f966a0843e`
- Condition: `>= 90` for `10 minutes`
- Action: SNS topic `ldc-ops-alerts`

### 3) EBS Snapshot Automation (DLM)
Use tag-based policy for safer expansion later.

#### Tag the root volume
1. EC2 -> Volumes -> select `vol-0f7e137e21f97dedd`
2. Add tag:
   - Key: `Backup`
   - Value: `Daily14d`

#### Create DLM policy
1. Go to **EC2 -> Lifecycle Manager (DLM)**.
2. Create lifecycle policy:
   - Policy type: `EBS snapshot policy`
   - Target resource type: `Volume`
   - Target tags: `Backup=Daily14d`
3. Schedule:
   - Frequency: `Daily`
   - Start time: off-peak (e.g., `03:00 UTC`)
4. Retention:
   - Retain: `14` snapshots
5. Policy state: `Enabled`
6. Name: `LDC-RootVolume-Daily-14d`

## Verification Checklist

### CloudWatch Agent (instance)
```bash
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status
systemctl is-active amazon-cloudwatch-agent
sudo tail -n 100 /opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log
```
Expected: running/active; no repeating fatal errors.

If logs show repeated `AccessDenied` for `cloudwatch:PutMetricData`, fix IAM on the instance role before relying on CWAgent alarms:
- Attach managed policy `CloudWatchAgentServerPolicy` to the EC2 instance profile role.
- Or add an equivalent custom policy allowing `cloudwatch:PutMetricData`.

### CloudWatch Metrics (console)
- CloudWatch -> Metrics -> `CWAgent`
- Confirm visible datapoints for:
  - `disk_used_percent` on path `/`
  - `mem_used_percent`
  - `swap_used_percent` (if enabled)

### Alarm Status (console)
- All created alarms exist and start in `OK` state.
- SNS subscription is `Confirmed`.

### Snapshot Policy (console)
- DLM policy exists and is `Enabled`.
- Next run time visible.
- New snapshots appear on schedule for the tagged volume.

### Platform Safety
```bash
curl -sS -m 20 -D - https://api.lovettsldc.com/health | head -n 20
```
Expected: `HTTP 200`.

Optional deploy verification:
```bash
gh workflow run deploy-backend.yml
```
Then verify workflow success in Actions.

## Restore / Rollback (EBS Snapshot)
1. Identify a known-good snapshot for root volume.
2. Create a new volume from snapshot in same AZ as instance.
3. Stop instance (maintenance window).
4. Detach current root volume.
5. Attach restored volume as root device.
6. Start instance and validate:
   - SSH
   - SSM agent active
   - backend `/health` returns 200
7. Keep old volume until validation completes.

## Testing Alarms Safely
- Disk alarm test:
  - Temporarily create a **test alarm** with low threshold (e.g., disk >= 10%) then delete after SNS confirmation.
- Status check alarm:
  - Validate by setting alarm action and confirming it remains `OK`; avoid disruptive instance actions.
- Memory alarm:
  - Use optional lower-threshold test alarm in a maintenance window.
