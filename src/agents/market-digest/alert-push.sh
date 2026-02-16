#!/bin/bash
# Alert Push - 推播提醒到 Telegram（A 項目）
# 配合 alert-monitor.js 使用

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 執行監控
echo "🔍 執行異常監控..."
report=$(node alert-monitor.js monitor 2>&1 | grep -v "正在抓取" | grep -v "使用快取" | grep -v "正在監控" | grep -v "檢查")

# 檢查是否有異常
if echo "$report" | grep -q "⚠️  異常提醒"; then
  # 有異常，推播到 Telegram
  echo "⚠️  發現異常，準備推播..."
  
  # 使用 Clawdbot message tool 推播
  # 由 Clawdbot 處理推播邏輯
  echo "$report"
  
  # 回傳需要推播的訊號
  exit 1
else
  # 無異常
  echo "✅ 無異常提醒"
  exit 0
fi
