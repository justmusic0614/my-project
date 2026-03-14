#!/bin/bash
# OpenClaw Memory Health Check — 自動偵測 + 修復
#
# 偵測 memory_search 是否可用，故障時自動執行 openclaw memory index --force
# 位置（VPS）: ~/clawd/sre/memory-health-check.sh
# 排程: 每 20 分鐘（:07/:27/:47），UTC 01-21
#
# 根因: gateway RSS 峰值觸頂 MemoryHigh，systemd memory throttle
#       導致 sqlite DB handle 異常關閉
# 修復: openclaw memory index --force（~30 秒恢復）

set -euo pipefail

# ==================== 環境設定 ====================

# 載入 NVM（cron 環境無 PATH）
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="/usr/local/bin:/usr/bin:/bin:/home/clawbot/.nvm/versions/node/v22.22.0/bin:$PATH"

# systemd --user 需要 XDG_RUNTIME_DIR（cron 環境無此變數）
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"

# 從 ~/clawd/.env 載入環境變數（Telegram token）
ENV_FILE="$HOME/clawd/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=../../.env
  source "$ENV_FILE"
  set +a
fi

# ==================== 配置 ====================

LOG_DIR="$HOME/clawd/logs"
COOLDOWN_FILE="/tmp/memory-health-alert.cooldown"
COOLDOWN_SECONDS=1800  # 30 分鐘告警冷卻
PROBE_TIMEOUT=30
REPAIR_TIMEOUT=120
MAX_REPAIR_ATTEMPTS=2

mkdir -p "$LOG_DIR"

DATE=$(date +%Y-%m-%d)
TIME=$(date +%H:%M:%S)

# ==================== 工具函數 ====================

log() {
  echo "[$TIME] $*"
}

log_error() {
  echo "[$TIME] ERROR: $*" >&2
}

send_telegram() {
  local SEVERITY="$1"
  local MESSAGE="$2"

  # 檢查 Telegram 環境變數
  if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
    log_error "Telegram 環境變數未設定，跳過推播"
    return 1
  fi

  # 告警冷卻（非 CRITICAL 才受限）
  if [ "$SEVERITY" != "CRITICAL" ] && [ -f "$COOLDOWN_FILE" ]; then
    local LAST_SENT
    LAST_SENT=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo "0")
    local NOW
    NOW=$(date +%s)
    local ELAPSED=$(( NOW - LAST_SENT ))
    if [ "$ELAPSED" -lt "$COOLDOWN_SECONDS" ]; then
      log "告警冷卻中（剩餘 $(( COOLDOWN_SECONDS - ELAPSED ))s），跳過推播"
      return 0
    fi
  fi

  local FULL_MSG="[$SEVERITY] OpenClaw Memory Health
$MESSAGE
$(date '+%Y-%m-%d %H:%M:%S UTC')"

  # JSON 轉義
  local ESCAPED_MSG
  ESCAPED_MSG=$(python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' <<< "$FULL_MSG" 2>/dev/null || \
    echo "\"$(echo "$FULL_MSG" | sed 's/"/\\"/g' | tr '\n' ' ')\"")

  local RESPONSE
  RESPONSE=$(curl -s -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": \"${TELEGRAM_CHAT_ID}\", \"text\": ${ESCAPED_MSG}}" \
    --max-time 15 2>/dev/null || echo '{"ok":false,"error":"curl failed"}')

  if echo "$RESPONSE" | grep -q '"ok":true'; then
    log "Telegram 推播成功 ($SEVERITY)"
    date +%s > "$COOLDOWN_FILE"
    return 0
  else
    log_error "Telegram 推播失敗: $RESPONSE"
    return 1
  fi
}

# ==================== 核心函數 ====================

# 探針偵測 memory_search 是否可用
# 回傳: 0=healthy, 1=unhealthy（錯誤原因寫入 stdout）
probe_memory() {
  local OUTPUT
  OUTPUT=$(timeout "$PROBE_TIMEOUT" openclaw memory search "health check probe" --max-results 1 2>&1) || true

  if echo "$OUTPUT" | grep -qi "database is not open"; then
    echo "database_not_open"
    return 1
  fi
  if echo "$OUTPUT" | grep -qi "unavailable\|embedding.*error\|provider.*error"; then
    echo "memory_unavailable"
    return 1
  fi
  if echo "$OUTPUT" | grep -qi "error\|fail\|exception"; then
    echo "unknown_error: $(echo "$OUTPUT" | head -1)"
    return 1
  fi

  echo "healthy"
  return 0
}

# 修復 memory index
repair_memory() {
  log "執行 openclaw memory index --force ..."
  timeout "$REPAIR_TIMEOUT" openclaw memory index --force 2>&1 || true
  sleep 5
}

# ==================== 主流程 ====================

main() {
  log "=== OpenClaw Memory Health Check ==="

  # 探針偵測
  local PROBE_RESULT
  PROBE_RESULT=$(probe_memory) || true

  if [ "$PROBE_RESULT" = "healthy" ]; then
    log "memory_search: HEALTHY"
    exit 0
  fi

  # 偵測到故障
  log_error "memory_search: UNHEALTHY ($PROBE_RESULT)"

  # 修復迴圈
  local ATTEMPT=0
  local REPAIRED=false
  while [ "$ATTEMPT" -lt "$MAX_REPAIR_ATTEMPTS" ]; do
    ATTEMPT=$((ATTEMPT + 1))
    log "修復嘗試 $ATTEMPT/$MAX_REPAIR_ATTEMPTS ..."

    repair_memory

    local VERIFY
    VERIFY=$(probe_memory) || true
    if [ "$VERIFY" = "healthy" ]; then
      REPAIRED=true
      break
    fi
    log_error "驗證失敗: $VERIFY"
  done

  if [ "$REPAIRED" = true ]; then
    log "修復成功（第 $ATTEMPT 次嘗試）"
    send_telegram "INFO" "memory_search 自動修復成功
原因: $PROBE_RESULT
嘗試: $ATTEMPT 次" || true
  else
    log_error "修復失敗，需人工介入"
    send_telegram "CRITICAL" "memory_search 自動修復失敗
原因: $PROBE_RESULT
建議: systemctl --user restart openclaw-gateway" || true
  fi
}

main "$@"
