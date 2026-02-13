#!/usr/bin/env bash
# vps-sync.sh - rsync 同步本機程式碼到 VPS（或從 VPS 拉取）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=vps-lib.sh
source "${SCRIPT_DIR}/vps-lib.sh"

DRY_RUN=false
DIRECTION="push"   # push（本機→VPS）| pull（VPS→本機）

usage() {
  cat <<EOF
用法：
  $(basename "$0") [選項]

選項：
  --dry-run    模擬同步，不實際傳輸任何檔案
  --pull       方向改為 VPS → 本機（預設為 本機 → VPS）
  --help       顯示說明
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --pull)    DIRECTION="pull" ;;
    --help)    usage ;;
    *)         log_warn "未知參數：$1" ;;
  esac
  shift
done

load_config
validate_config
check_ssh_connection

# 組裝 rsync exclude 旗標
EXCLUDE_FLAGS=()
for excl in "${RSYNC_EXCLUDES[@]}"; do
  EXCLUDE_FLAGS+=("--exclude=${excl}")
done

# rsync 基本參數
RSYNC_BASE=(
  rsync -avz --progress
  -e "$(ssh_e_flag)"
  "${EXCLUDE_FLAGS[@]}"
)

if [[ "$DRY_RUN" == "true" ]]; then
  RSYNC_BASE+=(--dry-run)
  log_warn "DRY RUN 模式：不會實際傳輸任何檔案"
fi

log_section "開始同步"

if [[ "$DIRECTION" == "push" ]]; then
  log_info "方向：本機 → VPS"
  log_info "來源：${LOCAL_SRC}/"
  log_info "目標：${VPS_USER}@${VPS_HOST}:${REMOTE_DEST}/"
  "${RSYNC_BASE[@]}" \
    "${LOCAL_SRC}/" \
    "${VPS_USER}@${VPS_HOST}:${REMOTE_DEST}/"
else
  log_info "方向：VPS → 本機"
  log_info "來源：${VPS_USER}@${VPS_HOST}:${REMOTE_DEST}/"
  log_info "目標：${LOCAL_SRC}/"
  if [[ "$DRY_RUN" != "true" ]]; then
    log_warn "即將從 VPS 拉取並覆蓋本機目錄"
    read -r -p "[CONFIRM] 確認繼續嗎？(y/N) " answer
    [[ "$answer" =~ ^[Yy]$ ]] || { log_info "已取消"; exit 0; }
  fi
  "${RSYNC_BASE[@]}" \
    "${VPS_USER}@${VPS_HOST}:${REMOTE_DEST}/" \
    "${LOCAL_SRC}/"
fi

log_section "同步完成"
