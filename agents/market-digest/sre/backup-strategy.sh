#!/bin/bash
##
# Backup Strategy - 自動備份策略
# 功能：
# - 每日備份重要資料
# - 保留最近 7 天備份
# - 壓縮備份以節省空間
# - 記錄備份日誌
##

set -euo pipefail

# 配置
AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.."; pwd)"
BACKUP_DIR="${AGENT_DIR}/backups"
LOG_DIR="${AGENT_DIR}/logs"
DATE_SUFFIX="$(date +%Y%m%d-%H%M%S)"
RETENTION_DAYS=7

# 顏色輸出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 日誌函數
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "${LOG_DIR}/backup.log"
}

log_success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] ✓ $1${NC}" | tee -a "${LOG_DIR}/backup.log"
}

log_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ✗ $1${NC}" | tee -a "${LOG_DIR}/backup.log"
}

log_warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] ⚠ $1${NC}" | tee -a "${LOG_DIR}/backup.log"
}

# 創建備份目錄
ensure_backup_dir() {
    mkdir -p "${BACKUP_DIR}"
    mkdir -p "${LOG_DIR}"
}

# 備份資料
backup_data() {
    log "開始備份資料..."
    
    local backup_name="data-${DATE_SUFFIX}.tar.gz"
    local backup_path="${BACKUP_DIR}/${backup_name}"
    
    # 檢查資料目錄是否存在
    if [ ! -d "${AGENT_DIR}/data" ]; then
        log_warning "資料目錄不存在，跳過備份"
        return 0
    fi
    
    # 壓縮備份（排除快取目錄）
    tar -czf "${backup_path}" \
        --exclude='data/*-cache' \
        --exclude='data/cache' \
        --exclude='*.tmp' \
        --exclude='*.log' \
        -C "${AGENT_DIR}" \
        data/ 2>&1 | grep -v "Removing leading" || true
    
    if [ ${PIPESTATUS[0]} -eq 0 ]; then
        local size=$(du -h "${backup_path}" | cut -f1)
        log_success "資料備份完成：${backup_name} (${size})"
    else
        log_error "資料備份失敗"
        return 1
    fi
}

# 備份配置
backup_config() {
    log "開始備份配置..."
    
    local backup_name="config-${DATE_SUFFIX}.tar.gz"
    local backup_path="${BACKUP_DIR}/${backup_name}"
    
    # 壓縮配置檔案
    tar -czf "${backup_path}" \
        -C "${AGENT_DIR}" \
        config.json \
        .env 2>/dev/null \
        || tar -czf "${backup_path}" -C "${AGENT_DIR}" config.json
    
    if [ ${PIPESTATUS[0]} -eq 0 ] || [ $? -eq 0 ]; then
        local size=$(du -h "${backup_path}" | cut -f1)
        log_success "配置備份完成：${backup_name} (${size})"
    else
        log_error "配置備份失敗"
        return 1
    fi
}

# 清理舊備份
cleanup_old_backups() {
    log "清理舊備份（保留最近 ${RETENTION_DAYS} 天）..."
    
    local deleted_count=0
    
    # 刪除舊的資料備份
    while IFS= read -r file; do
        rm -f "$file"
        ((deleted_count++))
    done < <(find "${BACKUP_DIR}" -name "data-*.tar.gz" -mtime +${RETENTION_DAYS} 2>/dev/null)
    
    # 刪除舊的配置備份
    while IFS= read -r file; do
        rm -f "$file"
        ((deleted_count++))
    done < <(find "${BACKUP_DIR}" -name "config-*.tar.gz" -mtime +${RETENTION_DAYS} 2>/dev/null)
    
    if [ $deleted_count -gt 0 ]; then
        log_success "清理了 ${deleted_count} 個舊備份"
    else
        log "沒有需要清理的舊備份"
    fi
}

# 顯示備份狀態
show_backup_status() {
    log "=== 備份狀態 ==="
    
    local total_size=$(du -sh "${BACKUP_DIR}" 2>/dev/null | cut -f1)
    local backup_count=$(find "${BACKUP_DIR}" -name "*.tar.gz" 2>/dev/null | wc -l)
    
    log "備份目錄：${BACKUP_DIR}"
    log "備份總數：${backup_count}"
    log "總大小：${total_size}"
    
    log "\n最近的備份："
    find "${BACKUP_DIR}" -name "*.tar.gz" -type f -exec ls -lh {} \; 2>/dev/null | \
        tail -5 | \
        awk '{print "  " $9 " (" $5 ", " $6 " " $7 ")"}' || true
}

# 主函數
main() {
    log "=== 開始備份策略 ==="
    
    ensure_backup_dir
    
    local success=0
    
    # 執行備份
    if backup_data && backup_config; then
        success=1
    fi
    
    # 清理舊備份
    cleanup_old_backups
    
    # 顯示狀態
    show_backup_status
    
    if [ $success -eq 1 ]; then
        log_success "備份策略執行完成"
        exit 0
    else
        log_error "備份策略執行失敗"
        exit 1
    fi
}

# 執行主函數
main
