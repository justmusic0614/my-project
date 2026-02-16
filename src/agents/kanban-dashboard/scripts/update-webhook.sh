#!/bin/bash
# update-webhook.sh - 更新 Telegram Webhook
#
# 用途：
# 1. 接收 tunnel URL 作為參數
# 2. 呼叫 Telegram API setWebhook
# 3. 驗證更新結果（檢查 "ok": true）
# 4. 記錄結構化日誌
#
# 使用範例：
#   ./update-webhook.sh https://abc-def-ghi.trycloudflare.com
#
# 環境變數：
#   TELEGRAM_BOT_TOKEN - Bot 認證 token（可選，有預設值）
#   TELEGRAM_WEBHOOK_SECRET - Webhook 安全驗證（可選，有預設值）

set -euo pipefail

# ==================== 參數檢查 ====================

if [ $# -eq 0 ]; then
  echo "❌ Error: Missing tunnel URL argument"
  echo ""
  echo "Usage: $0 <tunnel_url>"
  echo "Example: $0 https://abc-def-ghi.trycloudflare.com"
  exit 1
fi

TUNNEL_URL="$1"

# 簡單的 URL 格式驗證
if ! echo "$TUNNEL_URL" | grep -qE '^https://[a-z0-9-]+\.trycloudflare\.com$'; then
  echo "⚠️  Warning: URL format looks unexpected: $TUNNEL_URL"
  echo "   Expected: https://xxx-yyy-zzz.trycloudflare.com"
fi

# ==================== 配置 ====================

BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-REDACTED_TOKEN}"
WEBHOOK_SECRET="${TELEGRAM_WEBHOOK_SECRET:-REDACTED_SECRET}"
WEBHOOK_PATH="/api/telegram/webhook"
WEBHOOK_URL="${TUNNEL_URL}${WEBHOOK_PATH}"
API_URL="https://api.telegram.org/bot${BOT_TOKEN}/setWebhook"

# ==================== 日誌函數 ====================

log() {
  echo "[$(date -Iseconds)] $*"
}

log_error() {
  echo "[$(date -Iseconds)] ERROR: $*" >&2
}

# ==================== 主邏輯 ====================

log "🔄 Updating Telegram webhook..."
log "   Tunnel URL: $TUNNEL_URL"
log "   Webhook URL: $WEBHOOK_URL"

# 構建 JSON payload
JSON_PAYLOAD=$(cat <<EOF
{
  "url": "$WEBHOOK_URL",
  "secret_token": "$WEBHOOK_SECRET"
}
EOF
)

# 呼叫 Telegram API
RESPONSE=$(curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD" \
  --max-time 10 \
  --connect-timeout 5)

# 檢查 curl 是否成功
if [ $? -ne 0 ]; then
  log_error "❌ Failed to connect to Telegram API"
  exit 1
fi

# 解析結果（檢查 "ok": true）
if echo "$RESPONSE" | grep -q '"ok":true'; then
  log "✅ Webhook updated successfully"
  log "   Response: $RESPONSE"
  exit 0
else
  log_error "❌ Webhook update failed"
  log_error "   Response: $RESPONSE"
  exit 1
fi
