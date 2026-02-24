#!/bin/bash
# Optimization Advisor 扫描脚本

set -e
# Set PATH for cron environment
export PATH="/home/clawbot/.nvm/versions/node/v22.22.0/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$HOME/clawd/logs/optimization-advisor.log"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

echo "[$(timestamp)] 开始优化扫描..." | tee -a "$LOG_FILE"

# 执行扫描
OUTPUT=$(cd "$SCRIPT_DIR" && node advisor.js scan 2>&1)

# 检查是否有新建议
NEW_COUNT=$(echo "$OUTPUT" | grep "新建议：" | awk '{print $2}')

if [ "$NEW_COUNT" != "0" ] && [ -n "$NEW_COUNT" ]; then
  echo "[$(timestamp)] 发现 $NEW_COUNT 个新建议，推播中..." | tee -a "$LOG_FILE"
  
  # 提取建议内容
  SUGGESTIONS=$(echo "$OUTPUT" | sed -n '/💡 优化建议/,$p')
  
  # 推播到 Telegram
  echo "$SUGGESTIONS" | clawdbot message send \
    --channel telegram \
    --target 1377531222 \
    --message "$(cat)" \
    2>&1 | tee -a "$LOG_FILE"
  
  echo "[$(timestamp)] 推播完成" | tee -a "$LOG_FILE"
else
  echo "[$(timestamp)] 无新建议" | tee -a "$LOG_FILE"
fi
