#!/usr/bin/env bash
# deploy.sh — 統一部署腳本（本機 → VPS）
# 功能：audit（偵測 VPS 修改）→ rsync 同步 → PM2 重啟
# 取代 scripts/sync-to-vps.sh + tools/vps-deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── 設定 ──────────────────────────────────────────────────────────────────────
VPS_USER="clawbot"
VPS_HOST="159.65.136.0"
VPS_PORT="22"
VPS_KEY="${HOME}/.ssh/id_ed25519"
SSH_TIMEOUT="10"
REMOTE_BASE="/home/clawbot/clawd/agents"
LOCAL_BASE="${PROJECT_ROOT}/src/agents"
BACKUP_DIR="/home/clawbot/clawd/backups/pre-deploy"
DEPLOY_LOG="/home/clawbot/clawd/logs/deploy.log"

# ── 共用函式（log_*, run_ssh, ssh_e_flag）─────────────────────────────────────
log_info()    { echo -e "\033[0;32m[INFO]\033[0m  $*"; }
log_warn()    { echo -e "\033[0;33m[WARN]\033[0m  $*"; }
log_error()   { echo -e "\033[0;31m[ERROR]\033[0m $*"; }
log_section() { echo -e "\n\033[1;34m=== $* ===\033[0m"; }

run_ssh() {
  ssh -i "${VPS_KEY}" -p "${VPS_PORT}" \
    -o "ConnectTimeout=${SSH_TIMEOUT}" \
    -o "StrictHostKeyChecking=accept-new" \
    -o "BatchMode=yes" \
    "${VPS_USER}@${VPS_HOST}" "$@"
}

ssh_e_flag() {
  echo "ssh -i ${VPS_KEY} -p ${VPS_PORT} -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
}

# ── Agent 部署對照表 ──────────────────────────────────────────────────────────
# 格式：AGENT_PATHS[agent]="要同步的子路徑（空格分隔）"
# "." 表示整個目錄
declare -A AGENT_PATHS=(
  [kanban-dashboard]="server scripts sre ecosystem.config.js package.json"
  [market-digest]="."
  [security-patrol]="patrol.js patrol-wrapper.sh config.json setup-cron.sh"
  [knowledge-digest]="scripts"
  [deploy-monitor]="scripts"
  [shared]="."
)

# 需要 PM2 重啟的 agent（名稱對應 PM2 process name）
declare -A PM2_PROCESSES=(
  [kanban-dashboard]="kanban-dashboard telegram-poller"
)

# rsync 排除清單
RSYNC_EXCLUDES=(
  "node_modules/"
  "data/"
  "logs/"
  ".env"
  "*.log"
  ".git/"
  "client/src/"
  "client/node_modules/"
  "test/"
  "deprecated/"
)

# ── 參數解析 ──────────────────────────────────────────────────────────────────
DRY_RUN=false
SKIP_AUDIT=false
SKIP_RESTART=false
AGENTS=()

usage() {
  cat <<EOF
用法：
  $(basename "$0") [選項] <agent|all>

選項：
  --dry-run        模擬模式，不實際傳輸
  --skip-audit     跳過部署前 audit
  --skip-restart   跳過 PM2 重啟
  --help           顯示說明

範例：
  $(basename "$0") kanban-dashboard      # 部署單個 agent
  $(basename "$0") market-digest         # 部署單個 agent
  $(basename "$0") all                   # 部署全部
  $(basename "$0") --dry-run all         # 模擬模式
  $(basename "$0") shared kanban-dashboard  # 部署多個

可用 agents：
  $(printf '  %s\n' "${!AGENT_PATHS[@]}" | sort)
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)       DRY_RUN=true ;;
    --skip-audit)    SKIP_AUDIT=true ;;
    --skip-restart)  SKIP_RESTART=true ;;
    --help|-h)       usage ;;
    all)
      AGENTS=("${!AGENT_PATHS[@]}")
      ;;
    *)
      if [[ -n "${AGENT_PATHS[$1]+x}" ]]; then
        AGENTS+=("$1")
      else
        log_error "未知的 agent：$1"
        echo "可用：${!AGENT_PATHS[*]}"
        exit 1
      fi
      ;;
  esac
  shift
done

[[ ${#AGENTS[@]} -eq 0 ]] && { log_error "請指定至少一個 agent 或 'all'"; usage; }

# ── SSH 連線測試 ──────────────────────────────────────────────────────────────
log_info "測試 SSH 連線..."
if ! run_ssh "echo ok" &>/dev/null; then
  log_error "SSH 連線失敗：${VPS_USER}@${VPS_HOST}:${VPS_PORT}"
  exit 1
fi
log_info "SSH 連線正常"

if [[ "$DRY_RUN" == "true" ]]; then
  log_warn "DRY RUN 模式：不會實際傳輸任何檔案"
fi

# ── 組裝 rsync exclude 旗標 ──────────────────────────────────────────────────
EXCLUDE_FLAGS=()
for excl in "${RSYNC_EXCLUDES[@]}"; do
  EXCLUDE_FLAGS+=("--exclude=${excl}")
done

# ── 部署函式 ──────────────────────────────────────────────────────────────────

# audit：偵測 VPS 端是否有未同步的修改
do_audit() {
  local agent="$1"
  local local_dir="${LOCAL_BASE}/${agent}"
  local remote_dir="${REMOTE_BASE}/${agent}"
  local paths="${AGENT_PATHS[$agent]}"

  log_info "Audit：檢查 VPS 端是否有未同步修改..."

  local vps_changes=""

  if [[ "$paths" == "." ]]; then
    # 整個目錄：反向 rsync --dry-run 偵測 VPS 獨有修改
    vps_changes=$(rsync -avzn --itemize-changes \
      -e "$(ssh_e_flag)" \
      "${EXCLUDE_FLAGS[@]}" \
      "${VPS_USER}@${VPS_HOST}:${remote_dir}/" \
      "${local_dir}/" 2>/dev/null | grep '^[<>ch]' || true)
  else
    # 逐個子路徑檢查
    for sub in $paths; do
      local local_path="${local_dir}/${sub}"
      local remote_path="${remote_dir}/${sub}"

      if [[ -d "$local_path" ]]; then
        local changes
        changes=$(rsync -avzn --itemize-changes \
          -e "$(ssh_e_flag)" \
          "${EXCLUDE_FLAGS[@]}" \
          "${VPS_USER}@${VPS_HOST}:${remote_path}/" \
          "${local_path}/" 2>/dev/null | grep '^[<>ch]' || true)
        [[ -n "$changes" ]] && vps_changes+="${changes}\n"
      elif [[ -f "$local_path" ]]; then
        local changes
        changes=$(rsync -avzn --itemize-changes \
          -e "$(ssh_e_flag)" \
          "${VPS_USER}@${VPS_HOST}:${remote_path}" \
          "${local_path}" 2>/dev/null | grep '^[<>ch]' || true)
        [[ -n "$changes" ]] && vps_changes+="${changes}\n"
      fi
    done
  fi

  if [[ -n "$vps_changes" ]]; then
    log_warn "VPS 端有未同步的修改："
    echo -e "$vps_changes" | head -20
    local change_count
    change_count=$(echo -e "$vps_changes" | grep -c '^' || true)
    [[ $change_count -gt 20 ]] && log_warn "... 還有 $((change_count - 20)) 個變更"

    # 自動備份
    log_info "自動備份 VPS 修改到 ${BACKUP_DIR}/${agent}/..."
    if [[ "$DRY_RUN" != "true" ]]; then
      run_ssh "mkdir -p '${BACKUP_DIR}/${agent}' && cp -a '${remote_dir}' '${BACKUP_DIR}/${agent}/$(date +%Y%m%d-%H%M%S)'" 2>/dev/null || true
    fi

    read -r -p "[CONFIRM] VPS 有修改，繼續部署會覆蓋。確認？(y/N) " answer
    [[ "$answer" =~ ^[Yy]$ ]] || { log_info "已取消 ${agent} 部署"; return 1; }
  else
    log_info "Audit 通過：VPS 端無未同步修改"
  fi

  return 0
}

# 同步單個 agent
do_sync() {
  local agent="$1"
  local local_dir="${LOCAL_BASE}/${agent}"
  local remote_dir="${REMOTE_BASE}/${agent}"
  local paths="${AGENT_PATHS[$agent]}"

  local rsync_flags=(-avz --checksum --progress)
  rsync_flags+=("${EXCLUDE_FLAGS[@]}")
  rsync_flags+=(-e "$(ssh_e_flag)")
  [[ "$DRY_RUN" == "true" ]] && rsync_flags+=(--dry-run)

  # 確保遠端目錄存在
  if [[ "$DRY_RUN" != "true" ]]; then
    run_ssh "mkdir -p '${remote_dir}'"
  fi

  if [[ "$paths" == "." ]]; then
    log_info "同步：${local_dir}/ → ${remote_dir}/"
    rsync "${rsync_flags[@]}" \
      "${local_dir}/" \
      "${VPS_USER}@${VPS_HOST}:${remote_dir}/"
  else
    for sub in $paths; do
      local local_path="${local_dir}/${sub}"
      local remote_path="${remote_dir}/${sub}"

      if [[ -d "$local_path" ]]; then
        log_info "同步目錄：${agent}/${sub}/"
        if [[ "$DRY_RUN" != "true" ]]; then
          run_ssh "mkdir -p '${remote_path}'"
        fi
        rsync "${rsync_flags[@]}" \
          "${local_path}/" \
          "${VPS_USER}@${VPS_HOST}:${remote_path}/"
      elif [[ -f "$local_path" ]]; then
        log_info "同步檔案：${agent}/${sub}"
        rsync "${rsync_flags[@]}" \
          "${local_path}" \
          "${VPS_USER}@${VPS_HOST}:${remote_path}"
      else
        log_warn "本機不存在：${local_path}（跳過）"
      fi
    done
  fi
}

# PM2 重啟
do_restart() {
  local agent="$1"
  local processes="${PM2_PROCESSES[$agent]:-}"

  if [[ -z "$processes" ]]; then
    log_info "（${agent} 無需 PM2 重啟，cron-based agent 下次排程自動生效）"
    return 0
  fi

  for proc in $processes; do
    log_info "重啟 PM2 進程：${proc}"
    if [[ "$DRY_RUN" != "true" ]]; then
      run_ssh "export NVM_DIR=\$HOME/.nvm && source \$NVM_DIR/nvm.sh && pm2 restart '${proc}' --update-env" 2>&1 || {
        log_warn "PM2 restart ${proc} 失敗，嘗試 start..."
        run_ssh "export NVM_DIR=\$HOME/.nvm && source \$NVM_DIR/nvm.sh && cd '${REMOTE_BASE}/${agent}' && pm2 start ecosystem.config.js --only '${proc}' --update-env" 2>&1 || true
      }
    fi
  done
}

# 記錄 deploy log
do_log() {
  local agent="$1"
  local status="$2"

  if [[ "$DRY_RUN" != "true" ]]; then
    run_ssh "mkdir -p '$(dirname "$DEPLOY_LOG")' && echo '[$(date -u +%Y-%m-%dT%H:%M:%SZ)] deploy ${agent} ${status} (from $(hostname))' >> '${DEPLOY_LOG}'" 2>/dev/null || true
  fi
}

# ── 主流程 ────────────────────────────────────────────────────────────────────

log_section "開始部署"
log_info "目標 agents：${AGENTS[*]}"
log_info "VPS：${VPS_USER}@${VPS_HOST}"

FAILED=()
SUCCEEDED=()

for agent in "${AGENTS[@]}"; do
  log_section "部署 ${agent}"

  # 1. Audit
  if [[ "$SKIP_AUDIT" != "true" ]]; then
    if ! do_audit "$agent"; then
      FAILED+=("$agent")
      continue
    fi
  fi

  # 2. Sync
  if do_sync "$agent"; then
    # 3. PM2 restart
    if [[ "$SKIP_RESTART" != "true" ]]; then
      do_restart "$agent"
    fi

    do_log "$agent" "OK"
    SUCCEEDED+=("$agent")
  else
    do_log "$agent" "FAILED"
    FAILED+=("$agent")
  fi
done

# ── 結果摘要 ──────────────────────────────────────────────────────────────────
log_section "部署完成"

if [[ ${#SUCCEEDED[@]} -gt 0 ]]; then
  log_info "成功：${SUCCEEDED[*]}"
fi

if [[ ${#FAILED[@]} -gt 0 ]]; then
  log_error "失敗：${FAILED[*]}"
  exit 1
fi

if [[ "$DRY_RUN" == "true" ]]; then
  log_warn "以上為 DRY RUN 結果，未實際傳輸"
fi
