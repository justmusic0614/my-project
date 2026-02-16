#!/bin/bash
# Market Digest - 早報推播腳本

set -e

REPORT_FILE="$HOME/clawd/agents/market-digest/data/runtime/morning-report.txt"

# 檢查報告是否存在
if [ ! -f "$REPORT_FILE" ]; then
  echo "❌ 報告檔案不存在：$REPORT_FILE"
  exit 1
fi

# 讀取檔案內容並推播
REPORT_CONTENT=$(cat "$REPORT_FILE")

clawdbot message send \
  --channel telegram \
  --target REDACTED_CHAT_ID \
  --message "$REPORT_CONTENT"

echo "✅ 早報已推播到 Telegram"
