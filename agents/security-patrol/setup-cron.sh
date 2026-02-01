#!/bin/bash
# Setup cron jobs for Security Patrol

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "設定資安巡邏 Cron Jobs..."

# 1. 每小時巡邏（檢測異常並即時推播）
HOURLY_JOB="0 * * * * cd $SCRIPT_DIR && bash patrol-wrapper.sh patrol >> logs/patrol.log 2>&1"

# 2. 每天 08:00 推送日報（台北時間 = UTC 00:00）
DAILY_JOB="0 0 * * * cd $SCRIPT_DIR && bash patrol-wrapper.sh report >> logs/daily-report.log 2>&1"

# 檢查 cron 中是否已存在
(crontab -l 2>/dev/null | grep -v "patrol-wrapper.sh" || true; echo "$HOURLY_JOB"; echo "$DAILY_JOB") | crontab -

echo "✅ Cron jobs 已設定："
echo "  - 每小時巡邏（異常即時推播）"
echo "  - 每天 08:00 (UTC 00:00) 推送日報"
echo ""
echo "當前 crontab："
crontab -l | grep patrol-wrapper.sh || echo "（尚未設定）"
