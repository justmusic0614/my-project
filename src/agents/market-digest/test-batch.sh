#!/bin/bash
# Batch Test Script - 批次驗收測試
# 減少測試操作的 token 消耗

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔍 Market Digest 批次測試"
echo "━━━━━━━━━━━━━━━━━━"
echo ""

# 測試計數
total=0
passed=0
failed=0

# 測試函式
test_command() {
  local name="$1"
  local command="$2"
  total=$((total + 1))
  
  echo "[$total] 測試: $name"
  
  if eval "$command" > /dev/null 2>&1; then
    echo "    ✅ 通過"
    passed=$((passed + 1))
  else
    echo "    ❌ 失敗"
    failed=$((failed + 1))
  fi
}

# 1. 檔案存在性測試
echo "📁 檔案檢查"
test_command "chip-data-fetcher.js" "test -f chip-data-fetcher.js"
test_command "financial-data-fetcher.js" "test -f financial-data-fetcher.js"
test_command "chip-analyzer.js" "test -f chip-analyzer.js"
test_command "weekly-reporter.js" "test -f weekly-reporter.js"
test_command "alert-monitor.js" "test -f alert-monitor.js"
test_command "watchlist.js" "test -f watchlist.js"
test_command "telegram-wrapper.sh" "test -x telegram-wrapper.sh"
test_command "alert-push.sh" "test -x alert-push.sh"
echo ""

# 2. CLI 功能測試
echo "🔧 CLI 功能"
test_command "watchlist list" "node watchlist.js list"
test_command "chip-analyzer help" "node chip-analyzer.js"
test_command "weekly-reporter help" "node weekly-reporter.js"
test_command "alert-monitor help" "node alert-monitor.js"
echo ""

# 3. Telegram wrapper 測試
echo "📱 Telegram 包裝"
test_command "help" "bash telegram-wrapper.sh help"
test_command "list" "bash telegram-wrapper.sh list"
echo ""

# 4. 資料夾檢查
echo "📂 資料夾"
test_command "data/" "test -d data"
test_command "data/chip-cache/" "test -d data/chip-cache || mkdir -p data/chip-cache"
echo ""

# 總結
echo "━━━━━━━━━━━━━━━━━━"
echo "測試結果："
echo "  總計: $total"
echo "  通過: $passed ✅"
echo "  失敗: $failed ❌"
echo ""

if [ $failed -eq 0 ]; then
  echo "🎉 所有測試通過！"
  exit 0
else
  echo "⚠️  部分測試失敗"
  exit 1
fi
