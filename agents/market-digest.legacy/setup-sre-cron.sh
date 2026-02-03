#!/bin/bash
# 設定 SRE 版本的 Cron Jobs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER="$SCRIPT_DIR/sre/cron-wrapper.sh"

echo "🔧 設定 Market Digest SRE Cron Jobs"
echo ""

# 備份現有 crontab
crontab -l > /tmp/crontab.backup 2>/dev/null || true

# 移除舊的 market-digest cron
crontab -l 2>/dev/null | grep -v "market-digest" > /tmp/crontab.new || true

# 加入新的 SRE cron（使用 wrapper）
cat >> /tmp/crontab.new << CRON

# Market Digest - SRE 版本（每天 08:30 台北時間 = 00:30 UTC）
30 0 * * * $WRAPPER morning-report "cd $SCRIPT_DIR && node smart-integrator.js push"

CRON

# 安裝新的 crontab
crontab /tmp/crontab.new

echo "✅ Cron Jobs 已更新"
echo ""
echo "目前的 Cron Jobs:"
crontab -l | grep -A 2 "Market Digest"
echo ""
echo "📝 日誌位置: $SCRIPT_DIR/logs/cron-*.log"
