#!/bin/bash

# 配置區域
TELEGRAM_BOT_TOKEN="8333971889:AAEN4LuCjsl4PFpEdTVzYu5UUWZkY-MREsk"
TELEGRAM_CHAT_ID="1377531222"
DASHBOARD_PORT="3001"
LOG_DIR="/home/clawbot/clawd/agents/kanban-dashboard/logs"
CLOUDFLARE_LOG="${LOG_DIR}/cloudflare.log"
NOTIFY_LOG="${LOG_DIR}/telegram-notify.log"

# 確保日誌目錄存在
mkdir -p "$LOG_DIR"

# 進入工作目錄
cd /home/clawbot/clawd/agents/kanban-dashboard

# 停止現有 tunnel
echo "正在停止現有 Cloudflare Tunnel..."
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 2

# 清空舊日誌（保留最後 100 行）
if [ -f "$CLOUDFLARE_LOG" ]; then
    tail -100 "$CLOUDFLARE_LOG" > "${CLOUDFLARE_LOG}.tmp" 2>/dev/null
    mv "${CLOUDFLARE_LOG}.tmp" "$CLOUDFLARE_LOG" 2>/dev/null
fi

# 啟動 Cloudflare Tunnel
echo "正在啟動 Cloudflare Tunnel..."
nohup ~/.local/bin/cloudflared tunnel --url http://127.0.0.1:${DASHBOARD_PORT} > "$CLOUDFLARE_LOG" 2>&1 &
TUNNEL_PID=$!
echo "Cloudflared PID: $TUNNEL_PID"

# 函式：提取 Tunnel URL
extract_tunnel_url() {
    grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' "$CLOUDFLARE_LOG" | tail -1
}

# 函式：發送 Telegram 通知
send_telegram_notification() {
    local url="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S %Z')
    
    # 構建消息（使用 Markdown 格式）
    local message="🚀 *Kanban Dashboard 已啟動*

📍 URL: \`${url}\`
⏰ 時間: ${timestamp}
🔌 本地端口: ${DASHBOARD_PORT}

⚠️ 此為臨時 URL，重啟後會改變
💡 建議：將此 URL 加入書籤以便快速訪問"

    # 發送通知（使用 curl）
    local response=$(curl -s -X POST \
        "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d "chat_id=${TELEGRAM_CHAT_ID}" \
        -d "parse_mode=Markdown" \
        -d "text=${message}" 2>&1)
    
    # 檢查發送結果
    if echo "$response" | grep -q '"ok":true'; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ Telegram 通知發送成功" >> "$NOTIFY_LOG"
        return 0
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ Telegram 通知發送失敗: $response" >> "$NOTIFY_LOG"
        return 1
    fi
}

# 等待並提取 URL（帶重試機制）
echo "正在等待 Tunnel URL 生成..."
MAX_ATTEMPTS=10  # 10 次 × 3 秒 = 30 秒
ATTEMPT=0
TUNNEL_URL=""

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    sleep 3
    TUNNEL_URL=$(extract_tunnel_url)
    
    if [ -n "$TUNNEL_URL" ]; then
        echo ""
        echo "=== ✅ Cloudflare Tunnel 已啟動 ==="
        echo "📍 Dashboard URL: $TUNNEL_URL"
        echo ""
        
        # 發送 Telegram 通知
        echo "正在發送 Telegram 通知..."
        if send_telegram_notification "$TUNNEL_URL"; then
            echo "✅ Telegram 通知已發送"
        else
            echo "⚠️  Telegram 通知發送失敗（請查看 ${NOTIFY_LOG}）"
        fi
        
        echo ""
        echo "📄 完整日誌: ${CLOUDFLARE_LOG}"
        echo "📱 通知日誌: ${NOTIFY_LOG}"
        exit 0
    fi
    
    ATTEMPT=$((ATTEMPT + 1))
    echo "  嘗試 ${ATTEMPT}/${MAX_ATTEMPTS}..."
done

# 如果超時未取得 URL
echo ""
echo "❌ 錯誤: 30 秒內未能取得 Tunnel URL"
echo "請檢查日誌: ${CLOUDFLARE_LOG}"
echo ""
echo "=== 最近 20 行日誌 ==="
tail -20 "$CLOUDFLARE_LOG"

# 發送失敗通知
ERROR_MESSAGE="⚠️ *Cloudflare Tunnel 啟動異常*

無法在 30 秒內獲取 Tunnel URL
請手動檢查服務狀態

日誌位置: ${CLOUDFLARE_LOG}"

curl -s -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "parse_mode=Markdown" \
    -d "text=${ERROR_MESSAGE}" > /dev/null 2>&1

exit 1
