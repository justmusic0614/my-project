#!/bin/bash
# Setup Morning Report Cron Job
# 每天 08:30 (台北時間 = UTC 00:30) 整合並推播早報

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "設定每日早報 Cron Job..."

# 每天 08:30 台北時間 = UTC 00:30
MORNING_JOB="30 0 * * * cd $SCRIPT_DIR && node morning-integrator.js push >> logs/morning-report.log 2>&1"

# 檢查 cron 中是否已存在
(crontab -l 2>/dev/null | grep -v "morning-integrator.js" || true; echo "$MORNING_JOB") | crontab -

echo "✅ Cron job 已設定："
echo "  - 每天 08:30 (台北時間) 整合並推播早報"
echo ""
echo "當前 crontab："
crontab -l | grep morning-integrator.js || echo "（尚未設定）"
