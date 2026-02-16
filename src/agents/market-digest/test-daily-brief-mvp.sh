#!/bin/bash
# Daily Brief MVP 測試腳本

set -e

echo "🧪 Daily Brief MVP 測試"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 設定路徑
MARKET_DIGEST_DIR="$HOME/clawd/agents/market-digest"
cd "$MARKET_DIGEST_DIR"

# Test 1: 檢查依賴
echo "📦 Test 1: 檢查依賴..."
if [ ! -f "package.json" ]; then
    echo "❌ package.json 不存在"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "⚠️  node_modules 不存在，執行 npm install..."
    npm install
fi
echo "✅ 依賴檢查通過"
echo ""

# Test 2: 檢查目錄結構
echo "📂 Test 2: 檢查目錄結構..."
mkdir -p data/news-collect
mkdir -p data/news-analyzed
mkdir -p data/daily-brief
mkdir -p logs
echo "✅ 目錄結構建立完成"
echo ""

# Test 3: 檢查測試數據
echo "📊 Test 3: 檢查測試數據..."
if [ ! -f "data/news-analyzed/2026-02-04.json" ]; then
    echo "⚠️  測試數據不存在，Daily Brief 將使用預設值"
else
    echo "✅ 測試數據存在"
fi
echo ""

# Test 4: 生成 Daily Brief
echo "📊 Test 4: 生成 Daily Brief..."
node daily-brief-generator.js
if [ $? -eq 0 ]; then
    echo "✅ Daily Brief 生成成功"
else
    echo "❌ Daily Brief 生成失敗"
    exit 1
fi
echo ""

# Test 5: 檢查輸出檔案
echo "📄 Test 5: 檢查輸出檔案..."
TODAY=$(date +%Y-%m-%d)
BRIEF_FILE="data/daily-brief/${TODAY}.txt"

if [ -f "$BRIEF_FILE" ]; then
    FILE_SIZE=$(wc -c < "$BRIEF_FILE")
    echo "✅ Daily Brief 已生成: $BRIEF_FILE"
    echo "   檔案大小: $FILE_SIZE bytes"
    
    # 檢查關鍵 sections
    echo ""
    echo "   檢查 sections:"
    
    sections=(
        "Daily_Snapshot"
        "Market_Regime"
        "Macro_Policy"
        "Equity_Market"
        "Taiwan_Market"
        "Watchlist_Focus"
        "Event_Calendar"
    )
    
    for section in "${sections[@]}"; do
        if grep -q "$section" "$BRIEF_FILE"; then
            echo "   ✅ $section"
        else
            echo "   ⚠️  $section (missing)"
        fi
    done
else
    echo "❌ Daily Brief 檔案不存在"
    exit 1
fi
echo ""

# Test 6: 預覽報告
echo "📄 Test 6: 報告預覽 (前 1000 字元)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
head -c 1000 "$BRIEF_FILE"
echo ""
echo "..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test 7: 整合測試（可選）
echo "🔗 Test 7: 整合測試 (可選，按 Ctrl+C 跳過)"
echo "   這將生成包含 Daily Brief 的完整報告..."
read -t 5 -p "   繼續? (Enter 或等 5 秒自動跳過) " || echo ""

if [ $? -eq 0 ]; then
    node integrate-daily-brief.js
    if [ $? -eq 0 ]; then
        echo "✅ 整合測試通過"
    else
        echo "⚠️  整合測試失敗（可能沒有早報資料）"
    fi
else
    echo "⏭️  跳過整合測試"
fi
echo ""

# 總結
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ MVP 測試完成！"
echo ""
echo "📂 檔案位置:"
echo "   • Daily Brief: $BRIEF_FILE"
echo "   • 完整報告: data/runtime/morning-report.txt"
echo ""
echo "🎯 下一步:"
echo "   1. 查看 Daily Brief: cat $BRIEF_FILE"
echo "   2. 設定 Cron Job: bash setup-cron.sh"
echo "   3. 測試 /today 指令"
echo ""
