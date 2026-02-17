#!/bin/bash
# Setup Morning Report Cron Job
# 每天 07:00 (台北時間 = UTC 23:00 前一天) 整合並推播早報

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "設定每日早報 Cron Job..."

# 每天 07:00 台北時間 = UTC 23:00（前一天）
# 使用 cron-wrapper.sh 確保 .env 和 NVM 環境正確載入
MORNING_JOB="0 23 * * * $SCRIPT_DIR/sre/cron-wrapper.sh morning-report \"node $SCRIPT_DIR/smart-integrator.js push\" >> $SCRIPT_DIR/logs/morning-report.log 2>&1"

# 移除舊的 smart-integrator cron，加入新的
(crontab -l 2>/dev/null | grep -v "smart-integrator.js" || true; echo "$MORNING_JOB") | crontab -

echo "✅ Cron job 已設定："
echo "  - 每天 07:00 (台北時間) 整合並推播早報"
echo "  - 透過 cron-wrapper.sh 執行（自動載入 .env + NVM）"
echo ""
echo "當前 crontab："
crontab -l | grep smart-integrator.js || echo "（尚未設定）"
