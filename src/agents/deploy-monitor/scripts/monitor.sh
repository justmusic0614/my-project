#\!/bin/bash
# 自动监控脚本 - 检测异常并推播

set -e

# Set environment for cron
export PATH="/home/clawbot/.nvm/versions/node/v22.22.0/bin:$PATH"
export XDG_RUNTIME_DIR="/run/user/1000"
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/1000/bus"

# Export Telegram token for clawdbot CLI（必須在環境中設定）
export TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN is required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$HOME/clawd/logs/monitor.log"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

echo "[$(timestamp)] 开始健康检查..."

# 先检查是否有异常（执行完整检查）
FULL_CHECK=$("$SCRIPT_DIR/simple-health.sh" 2>&1)

# 检查是否有异常
if echo "$FULL_CHECK" | grep -q "❌"; then
  echo "[$(timestamp)] 发现异常！"
  
  # 只显示异常项目
  ERROR_ONLY=$("$SCRIPT_DIR/simple-health.sh" --only-errors 2>&1)
  
  # 推播警报（只包含异常项目）
  echo "⚠️ 服务异常警报" > /tmp/monitor-alert.txt
  echo "" >> /tmp/monitor-alert.txt
  echo "$ERROR_ONLY" >> /tmp/monitor-alert.txt
  
  cat /tmp/monitor-alert.txt | clawdbot message send \
    --channel telegram \
    --target "${TELEGRAM_CHAT_ID:?TELEGRAM_CHAT_ID is required}" \
    --message "$(cat)" \
    2>&1 >> "$LOG_FILE"
  
  echo "[$(timestamp)] 警报已推播"
else
  echo "[$(timestamp)] 所有服务正常"
fi
