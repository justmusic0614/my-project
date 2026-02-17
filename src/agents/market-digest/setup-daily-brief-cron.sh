#!/bin/bash
# @deprecated 2026-02-17 - 已被 setup-sre-cron.sh 統一管理，使用 SRE cron-wrapper
# 設定 Daily Brief 自動執行 Cron Job

set -e

echo "⏰ 設定 Daily Brief Cron Job"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 設定路徑
MARKET_DIGEST_DIR="$HOME/clawd/agents/market-digest"

# 檢查目錄
if [ ! -d "$MARKET_DIGEST_DIR" ]; then
    echo "❌ Market Digest 目錄不存在: $MARKET_DIGEST_DIR"
    exit 1
fi

echo "📂 Market Digest 目錄: $MARKET_DIGEST_DIR"
echo ""

# 定義 Cron 任務
CRON_JOBS=(
    # 每日 08:30 UTC (台北 16:30) - 生成並推播 Daily Brief
    "30 0 * * * cd $MARKET_DIGEST_DIR && node integrate-daily-brief.js >> logs/daily-brief.log 2>&1"
    
    # 備用：每日 12:00 UTC (台北 20:00) - 盤後更新
    # "0 12 * * * cd $MARKET_DIGEST_DIR && node integrate-daily-brief.js >> logs/daily-brief-evening.log 2>&1"
)

# 備份當前 crontab
echo "💾 備份當前 crontab..."
crontab -l > /tmp/crontab.backup.$(date +%Y%m%d-%H%M%S) 2>/dev/null || echo "# 新 crontab" > /tmp/crontab.backup.$(date +%Y%m%d-%H%M%S)
echo "✅ 已備份到: /tmp/crontab.backup.*"
echo ""

# 檢查是否已存在相同任務
echo "🔍 檢查現有 Cron Job..."
EXISTING=$(crontab -l 2>/dev/null | grep -c "integrate-daily-brief" || true)

if [ "$EXISTING" -gt 0 ]; then
    echo "⚠️  已存在 $EXISTING 個 Daily Brief Cron Job"
    echo ""
    echo "現有任務:"
    crontab -l | grep "integrate-daily-brief" || true
    echo ""
    read -p "是否要移除並重新設定? (y/N) " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # 移除舊任務
        crontab -l | grep -v "integrate-daily-brief" | crontab -
        echo "✅ 已移除舊任務"
    else
        echo "⏭️  保留現有任務，結束"
        exit 0
    fi
fi

# 新增 Cron Job
echo "➕ 新增 Daily Brief Cron Job..."
(crontab -l 2>/dev/null; echo ""; echo "# Market Digest - Daily Brief"; echo "${CRON_JOBS[0]}") | crontab -
echo "✅ Cron Job 已新增"
echo ""

# 顯示當前 crontab
echo "📋 當前 Cron Jobs:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
crontab -l | grep -A1 "Market Digest" || crontab -l | tail -5
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 執行時間說明
echo "⏰ 執行時間 (台北時間):"
echo "   • 16:30 - 每日 Daily Brief 生成與推播"
echo ""
echo "📝 日誌位置:"
echo "   • $MARKET_DIGEST_DIR/logs/daily-brief.log"
echo ""

# 測試 Cron 環境
echo "🧪 測試 Cron 環境..."
echo "   執行測試指令 (10秒內完成):"
echo "   cd $MARKET_DIGEST_DIR && node -v"
echo ""

(cd $MARKET_DIGEST_DIR && timeout 10 node -v) || echo "⚠️  測試失敗，請檢查 node 是否在 PATH 中"
echo ""

# 手動測試建議
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Cron Job 設定完成！"
echo ""
echo "🎯 手動測試:"
echo "   cd $MARKET_DIGEST_DIR"
echo "   node integrate-daily-brief.js"
echo ""
echo "📊 查看日誌:"
echo "   tail -f $MARKET_DIGEST_DIR/logs/daily-brief.log"
echo ""
echo "⏰ 下次執行時間:"
echo "   • UTC: 明日 00:30"
echo "   • 台北: 明日 08:30"
echo ""
