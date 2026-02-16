#!/bin/bash

# --- SRE: ensure node in non-interactive shells (cron/ssh) ---
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# SRE Cron Wrapper for Kanban Dashboard
# 確保 cron job 在正確的環境下執行

set -euo pipefail

# --- SRE: fast exit for help/version (no side effects) ---
case "${1:-}" in
  -h|--help)
    echo "Usage: ./sre/cron-wrapper.sh <job_name> <command>"
    echo "Examples:"
    echo "  ./sre/cron-wrapper.sh health-check \"node sre/telegram-health-monitor.js\""
    exit 0
    ;;
  -v|--version)
    [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
    node -v 2>/dev/null || echo "node not found"
    exit 0
    ;;
esac

# ==================== 配置 ====================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_ROOT/logs/cron"

# Node.js 環境
export PATH="/usr/local/bin:/usr/bin:/bin:/home/clawbot/.nvm/versions/node/v22.22.0/bin:$PATH"
export NODE_PATH="/home/clawbot/.nvm/versions/node/v22.22.0/lib/node_modules"

# 工作目錄
cd "$PROJECT_ROOT"

# 日誌檔案
DATE=$(date +%Y-%m-%d)
TIME=$(date +%H:%M:%S)
TIMESTAMP=$(date +%Y-%m-%dT%H:%M:%S%z)
LOG_FILE="$LOG_DIR/wrapper-${DATE}.log"

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

# 簡化的依賴檢查（只檢查 Node.js 和 PM2）
check_dependencies() {
    log "🔍 執行依賴檢查..."

    # 檢查 Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js not found"
        return 1
    fi
    log "   ✓ Node.js: $(node --version)"

    # 檢查 PM2
    if ! command -v pm2 &> /dev/null; then
        log_error "PM2 not found"
        return 1
    fi
    log "   ✓ PM2: installed"

    log_success "依賴檢查通過"
    return 0
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

# 清理舊日誌（保留 30 天）
cleanup_old_logs() {
    log "🧹 清理舊日誌（保留 30 天）..."

    find "$PROJECT_ROOT/logs" -name "*.log" -type f -mtime +30 -delete 2>/dev/null || true

    log_success "日誌清理完成"
}

# ==================== 主流程 ====================

main() {
    log "════════════════════════════════════════════════════════════"
    log "🤖 Kanban Dashboard Cron Wrapper 啟動"
    log "   時間戳: $TIMESTAMP"
    log "   工作目錄: $PROJECT_ROOT"
    log "   Node 版本: $(node --version 2>/dev/null || echo 'N/A')"
    log "════════════════════════════════════════════════════════════"

    # 確保日誌目錄存在
    mkdir -p "$LOG_DIR"

    # 1. 依賴檢查
    if ! check_dependencies; then
        log_error "依賴檢查失敗，退出"
        exit 1
    fi

    # 2. 清理舊日誌（每次執行）
    cleanup_old_logs

    # 3. 執行主要任務
    if [ $# -eq 0 ]; then
        log_error "未指定任務"
        log "用法: $0 <task_name> <task_command>"
        exit 1
    fi

    TASK_NAME="$1"
    shift
    TASK_CMD="$*"

    if ! run_task "$TASK_NAME" "$TASK_CMD"; then
        log_error "任務執行失敗: $TASK_NAME"
        exit 1
    fi

    log "════════════════════════════════════════════════════════════"
    log_success "Cron Wrapper 完成"
    log "════════════════════════════════════════════════════════════"
}

# 執行主流程
main "$@"
