#!/bin/bash

# --- SRE: ensure node in non-interactive shells (cron/ssh) ---
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# SRE Cron Wrapper
# 確保 cron job 在正確的環境下執行

set -euo pipefail

# --- SRE: fast exit for help/version (no side effects) ---
case "${1:-}" in
  -h|--help)
    echo "Usage: ./sre/cron-wrapper.sh <job_name> <command...>"
    echo ""
    echo "Examples (v2 pipeline):"
    echo "  ./sre/cron-wrapper.sh phase1  'node index.js pipeline --phase 1'"
    echo "  ./sre/cron-wrapper.sh phase2  'node index.js pipeline --phase 2'"
    echo "  ./sre/cron-wrapper.sh phase34 'node index.js pipeline --phase 3 && node index.js pipeline --phase 4'"
    echo "  ./sre/cron-wrapper.sh weekend 'node index.js pipeline --weekend'"
    echo "  ./sre/cron-wrapper.sh weekly  'node index.js weekly'"
    echo "  ./sre/cron-wrapper.sh health  'node sre/health-check.js'"
    exit 0
    ;;
  -v|--version)
    node -v 2>/dev/null || echo "node not found"
    exit 0
    ;;
esac

# ==================== 配置 ====================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
SRE_DIR="$PROJECT_ROOT/sre"

# Node.js 環境
export PATH="/usr/local/bin:/usr/bin:/bin:/home/clawbot/.nvm/versions/node/v22.22.0/bin:$PATH"
export NODE_PATH="/home/clawbot/.nvm/versions/node/v22.22.0/lib/node_modules"

# 工作目錄
cd "$PROJECT_ROOT"

# 日誌檔案
DATE=$(date +%Y-%m-%d)
TIME=$(date +%H:%M:%S)
TIMESTAMP=$(date +%Y-%m-%dT%H:%M:%S%z)
LOG_FILE="$LOG_DIR/cron-${DATE}.log"

# ==================== 函數 ====================

log() {
    echo "[$TIME] $*" | tee -a "$LOG_FILE"
}

log_error() {
    echo "[$TIME] ERROR: $*" | tee -a "$LOG_FILE" >&2
}

log_success() {
    echo "[$TIME] ✅ $*" | tee -a "$LOG_FILE"
}

# 依賴檢查
check_dependencies() {
    log "🔍 執行依賴檢查..."
    
    if ! node "$SRE_DIR/dependency-checker.js" --fix >> "$LOG_FILE" 2>&1; then
        log_error "依賴檢查失敗"
        return 1
    fi
    
    log_success "依賴檢查通過"
    return 0
}

# 健康檢查
health_check() {
    log "🏥 執行健康檢查..."
    
    # 執行健康檢查並捕獲結果
    if node -e "
const { createHealthCheckSystem } = require('$SRE_DIR/health-check');
(async () => {
    const healthCheck = createHealthCheckSystem();
    const status = await healthCheck.runAll();
    if (status.status === 'CRITICAL') {
        process.exit(1);
    }
})();
" >> "$LOG_FILE" 2>&1; then
        log_success "健康檢查通過"
        return 0
    else
        log_error "健康檢查失敗 - 系統處於 CRITICAL 狀態"
        return 1
    fi
}

# 執行主要任務
run_task() {
    local TASK_NAME="$1"
    local TASK_CMD="$2"
    
    log "🚀 執行任務: $TASK_NAME"
    log "   指令: $TASK_CMD"
    
    # 記錄開始時間
    local START_TIME=$(date +%s)
    
    # 執行任務
    if eval "$TASK_CMD" >> "$LOG_FILE" 2>&1; then
        local END_TIME=$(date +%s)
        local DURATION=$((END_TIME - START_TIME))
        log_success "任務完成: $TASK_NAME (耗時 ${DURATION}s)"
        return 0
    else
        local EXIT_CODE=$?
        local END_TIME=$(date +%s)
        local DURATION=$((END_TIME - START_TIME))
        log_error "任務失敗: $TASK_NAME (exit code: $EXIT_CODE, 耗時 ${DURATION}s)"
        return $EXIT_CODE
    fi
}

# 清理舊日誌（保留 7 天）
cleanup_old_logs() {
    log "🧹 清理舊日誌（保留 7 天）..."
    
    find "$LOG_DIR" -name "cron-*.log" -type f -mtime +7 -delete 2>/dev/null || true
    find "$LOG_DIR" -name "error-*.log" -type f -mtime +7 -delete 2>/dev/null || true
    
    log_success "日誌清理完成"
}

# 發送 Telegram 告警
send_alert() {
    local SEVERITY="$1"
    local MESSAGE="$2"

    log "📢 發送告警: [$SEVERITY] $MESSAGE"

    # 需要 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID（從 .env 載入）
    if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
        log "⚠️  Telegram 未設定（TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID），略過推播"
        return 0
    fi

    local EMOJI
    case "$SEVERITY" in
        CRITICAL) EMOJI="🔴" ;;
        ERROR)    EMOJI="🟠" ;;
        WARNING)  EMOJI="🟡" ;;
        *)        EMOJI="ℹ️" ;;
    esac

    local TEXT="${EMOJI} [${SEVERITY}] market-digest cron alert
Job: ${TASK_NAME:-unknown}
Time: $(date '+%Y-%m-%d %H:%M:%S %Z')
Message: ${MESSAGE}"

    curl -s -X POST \
        "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d "chat_id=${TELEGRAM_CHAT_ID}" \
        --data-urlencode "text=${TEXT}" \
        -o /dev/null || log "⚠️  Telegram 推播失敗（curl error）"
}

# ==================== 主流程 ====================

main() {
    log "════════════════════════════════════════════════════════════"
    log "🤖 Cron Wrapper 啟動"
    log "   時間戳: $TIMESTAMP"
    log "   工作目錄: $PROJECT_ROOT"
    log "   Node 版本: $(node --version)"
    log "════════════════════════════════════════════════════════════"
    
    # 確保日誌目錄存在
    mkdir -p "$LOG_DIR"

    # 載入 .env（若存在），自動設定所有 API keys（ANTHROPIC_API_KEY 等）
    ENV_FILE="$PROJECT_ROOT/.env"
    if [ -f "$ENV_FILE" ]; then
        set -a
        # shellcheck source=../.env
        source "$ENV_FILE"
        set +a
        log "✅ 已載入 .env"
    else
        log "⚠️  .env 檔案不存在: $ENV_FILE"
    fi

    # 1. 依賴檢查
    if ! check_dependencies; then
        send_alert "CRITICAL" "依賴檢查失敗"
        exit 1
    fi
    
    # 2. 健康檢查（非阻塞）
    if ! health_check; then
        log "⚠️  健康檢查未通過，但繼續執行..."
        send_alert "WARNING" "健康檢查未通過"
    fi
    
    # 3. 清理舊日誌
    cleanup_old_logs
    
    # 4. 執行主要任務
    if [ $# -eq 0 ]; then
        log_error "未指定任務"
        log "用法: $0 <task_name> <task_command>"
        exit 1
    fi
    
    TASK_NAME="$1"
    shift
    TASK_CMD="$*"
    
    if ! run_task "$TASK_NAME" "$TASK_CMD"; then
        send_alert "ERROR" "任務執行失敗: $TASK_NAME"
        exit 1
    fi
    
    # 5. 執行後健康檢查
    log "🏥 執行後健康檢查..."
    if ! health_check; then
        send_alert "WARNING" "執行後健康檢查未通過"
    fi
    
    log "════════════════════════════════════════════════════════════"
    log_success "Cron Wrapper 完成"
    log "════════════════════════════════════════════════════════════"
}

# 執行主流程
main "$@"
