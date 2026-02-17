#!/bin/bash
# 崩潰偵測腳本 - 檢查 Gateway 崩潰模式

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$HOME/clawd/agents/deploy-monitor/data"
CRASH_LOG="$DATA_DIR/crash-history.jsonl"

# 確保目錄存在
mkdir -p "$DATA_DIR"
touch "$CRASH_LOG"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

# 檢查最近 1 小時的崩潰
CRASHES=$(journalctl --user -u clawdbot-gateway.service --since "1 hour ago" | grep -c "Unhandled promise rejection" || echo "0")

if [ "$CRASHES" -gt 0 ]; then
  echo "[$(timestamp)] 發現 $CRASHES 次崩潰（最近 1 小時）"
  
  # 提取崩潰詳情（轉義換行符）
  LAST_CRASH=$(journalctl --user -u clawdbot-gateway.service --since "1 hour ago" | grep -A5 "Unhandled promise rejection" | tail -10 | tr '\n' ' ' | tr '"' "'")
  
  # 記錄到 JSONL
  printf '{"timestamp":"%s","crashes":%d,"details":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$CRASHES" \
    "$LAST_CRASH" >> "$CRASH_LOG"
  
  # 檢查連續崩潰（最近 3 條記錄）
  RECENT_CRASHES=$(tail -3 "$CRASH_LOG" 2>/dev/null | jq -s 'map(.crashes) | add' || echo "0")
  
  if [ "$RECENT_CRASHES" -ge 3 ]; then
    echo "[$(timestamp)] ⚠️ 連續崩潰警報：最近 3 小時內 $RECENT_CRASHES 次崩潰"
    
    # 推播警報
    cat > /tmp/crash-alert.txt <<EOF
🔴 Gateway 連續崩潰警報

最近 1 小時：$CRASHES 次
最近 3 小時：$RECENT_CRASHES 次

錯誤類型：Unhandled promise rejection (fetch failed)

可能原因：
1. Heartbeat 機制呼叫外部 API 失敗
2. Telegram long polling 超時
3. 其他定期任務網路錯誤

已執行：暫時關閉 agent heartbeat
建議：觀察 24 小時確認是否改善
EOF
    
    export TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-REDACTED_TOKEN}"
    cat /tmp/crash-alert.txt | clawdbot message send \
      --channel telegram \
      --target REDACTED_CHAT_ID \
      --message "$(cat)" \
      2>&1 || echo "[$(timestamp)] 推播失敗"
  else
    echo "[$(timestamp)] 偵測到崩潰但未達警報閾值（$RECENT_CRASHES/3）"
  fi
else
  echo "[$(timestamp)] 無崩潰記錄（最近 1 小時）"
fi

# 清理 7 天前的記錄
if [ -f "$CRASH_LOG" ]; then
  CUTOFF=$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)
  cat "$CRASH_LOG" | jq -c "select(.timestamp > \"$CUTOFF\")" > "$CRASH_LOG.tmp"
  mv "$CRASH_LOG.tmp" "$CRASH_LOG"
fi
