#!/bin/bash
# Security Patrol - 設定 Cron Jobs
#
# 執行此腳本以安裝/更新 security-patrol 排程
# 同時移除已廢棄的舊腳本排程（market-digest/security-patrol.sh、tech-debt-monitor.sh 等）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER="$SCRIPT_DIR/patrol-wrapper.sh"

echo "🔧 設定 Security Patrol SRE Cron Jobs"
echo ""

# 確認 wrapper 可執行
if [ ! -f "$WRAPPER" ]; then
  echo "ERROR: patrol-wrapper.sh 不存在：$WRAPPER" >&2
  exit 1
fi
chmod +x "$WRAPPER"

# 備份現有 crontab
BACKUP_FILE="/tmp/crontab-backup-$(date +%Y%m%d-%H%M%S).txt"
crontab -l > "$BACKUP_FILE" 2>/dev/null || echo "" > "$BACKUP_FILE"
echo "📋 crontab 備份：$BACKUP_FILE"

# 移除舊的相關排程
# - market-digest 舊版資安腳本（security-patrol.sh, morning-summary.sh）
# - 已廢棄的 tech-debt-monitor.sh 獨立排程
# - 舊版 patrol-wrapper.sh 排程
CLEAN_CRONTAB=$(crontab -l 2>/dev/null \
  | grep -v "market-digest/security-patrol.sh" \
  | grep -v "market-digest/morning-summary.sh" \
  | grep -v "tech-debt-monitor.sh" \
  | grep -v "patrol-wrapper.sh" \
  | grep -v "# Security Patrol" \
  | grep -v "# === SRE: Security" \
  || true)

# 組裝新的 crontab
NEW_CRONTAB="${CLEAN_CRONTAB}

# === SRE: Security Patrol (installed $(date +%Y-%m-%d)) ===
# 每 2 小時資安巡邏（奇數小時，避開 market-digest 偶數小時排程）
# UTC 01,03,05,...,23 = 台北 09,11,...,07
# nice -n 10：降低 CPU 優先級，避免搶占 1-core VPS
0 1,3,5,7,9,11,13,15,17,19,21,23 * * * nice -n 10 $WRAPPER patrol >> $SCRIPT_DIR/logs/cron-patrol.log 2>&1

# 每天 UTC 03:00 SRE 日報（= 台北 11:00，避開 00:00 市場任務集中時段）
0 3 * * * nice -n 10 $WRAPPER report >> $SCRIPT_DIR/logs/cron-report.log 2>&1
"

# 安裝新 crontab
echo "$NEW_CRONTAB" | crontab -

echo "✅ Cron Jobs 已安裝："
echo "   • 資安巡邏：每 2 小時 (0 1,3,...,23 * * *)，奇數小時，有異常才推播"
echo "   • SRE 日報：每天 UTC 03:00 台北 11:00 (0 3 * * *)，整合技術債"
echo ""
echo "已移除（廢棄排程）："
echo "   • market-digest/security-patrol.sh"
echo "   • market-digest/morning-summary.sh"
echo "   • scripts/tech-debt-monitor.sh（功能整合進 report 模式）"
echo ""
echo "目前排程（Security Patrol）："
crontab -l | grep "patrol-wrapper.sh" || echo "（尚未設定）"
echo ""
echo "手動測試："
echo "   bash $WRAPPER patrol    # 執行巡邏"
echo "   bash $WRAPPER report    # 生成日報"
echo "   bash $WRAPPER status    # 查看狀態"
