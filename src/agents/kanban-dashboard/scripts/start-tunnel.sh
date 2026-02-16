#!/bin/bash
# start-tunnel.sh - Cloudflare Tunnel 啟動腳本（PM2 管理）
#
# 功能：
# 1. 啟動 cloudflared tunnel（前景運行）
# 2. 後台監控日誌，解析動態 URL
# 3. 儲存 URL 到 tunnel-url.txt
# 4. 自動呼叫 update-webhook.sh 更新 Telegram webhook
#
# PM2 注意事項：
# - 使用 exec 取代當前 shell，cloudflared 成為主進程
# - PM2 直接管理 cloudflared 進程
# - URL 解析在後台子進程中執行（不影響主進程）

set -euo pipefail

# ==================== 配置 ====================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$PROJECT_ROOT/data"
LOG_DIR="$PROJECT_ROOT/logs"
TUNNEL_URL_FILE="$DATA_DIR/tunnel-url.txt"
TUNNEL_LOG="$LOG_DIR/cloudflare-tunnel.log"
UPDATE_WEBHOOK_SCRIPT="$SCRIPT_DIR/update-webhook.sh"
CLOUDFLARED="/home/clawbot/.local/bin/cloudflared"
TARGET_PORT="3001"

# ==================== 初始化 ====================

# 確保目錄存在
mkdir -p "$DATA_DIR" "$LOG_DIR"

# 清空舊日誌（避免檔案過大）
: > "$TUNNEL_LOG"

# 日誌函數
log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$TUNNEL_LOG"
}

log "🚀 Starting Cloudflare Tunnel..."
log "   Target: http://localhost:$TARGET_PORT"
log "   Cloudflared: $CLOUDFLARED"
log "   Project Root: $PROJECT_ROOT"

# ==================== URL 解析子進程 ====================

(
  # 等待 cloudflared 啟動並輸出 URL
  sleep 5

  log "🔍 Monitoring log for Tunnel URL..."

  # 監控最近 30 秒
  for i in {1..30}; do
    if [ -f "$TUNNEL_LOG" ]; then
      # 解析 URL（正則：https://[字母數字破折號].trycloudflare.com）
      URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | tail -1)

      if [ -n "$URL" ]; then
        log "✅ Detected Tunnel URL: $URL"

        # 儲存 URL
        echo "$URL" > "$TUNNEL_URL_FILE"
        log "📝 URL saved to $TUNNEL_URL_FILE"

        # 呼叫 webhook 更新腳本
        if [ -x "$UPDATE_WEBHOOK_SCRIPT" ]; then
          log "🔄 Updating Telegram webhook..."
          if bash "$UPDATE_WEBHOOK_SCRIPT" "$URL" >> "$TUNNEL_LOG" 2>&1; then
            log "✅ Webhook updated successfully"
          else
            log "⚠️  Warning: webhook update failed (exit code: $?)"
          fi
        else
          log "⚠️  Warning: $UPDATE_WEBHOOK_SCRIPT not found or not executable"
        fi

        # 成功解析，退出監控
        exit 0
      fi
    fi
    sleep 1
  done

  # 30 秒內未找到 URL
  log "⚠️  Warning: Failed to detect Tunnel URL after 30 seconds"
  log "   Monitor script will detect and update webhook later"
) &

# ==================== 啟動 cloudflared ====================

log "🌐 Launching cloudflared..."

# exec: 取代當前 shell，cloudflared 成為主進程
# PM2 會直接管理 cloudflared 進程
# 2> >(tee -a): 將 stderr 複製到日誌檔案
exec "$CLOUDFLARED" tunnel --url "http://localhost:$TARGET_PORT" \
  2> >(tee -a "$TUNNEL_LOG" >&2)

# Note: exec 之後的程式碼不會執行
