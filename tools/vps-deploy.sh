#!/usr/bin/env bash
# vps-deploy.sh - 同步程式碼到 VPS，並處理指定 agent 的執行中程序
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=vps-lib.sh
source "${SCRIPT_DIR}/vps-lib.sh"

AGENT="${1:-}"
CLAWD_ONLY="${2:-}"   # 支援 --clawd-only：跳過 Step 1+2，只做 Step 3（clawd 同步）

usage() {
  cat <<EOF
用法：
  $(basename "$0") <agent>               同步程式碼 + 終止程序 + 同步到執行目錄
  $(basename "$0") <agent> --clawd-only  只將程式碼同步到 clawd/agents/（跳過 rsync 和 kill）
  $(basename "$0")                       僅同步程式碼到 VPS 暫存目錄（不處理程序）

可用 agents：
  deploy-monitor
  knowledge-digest
  market-digest
  optimization-advisor
  security-patrol
EOF
  exit 1
}

[[ "${1:-}" == "--help" ]] && usage

# --clawd-only 模式必須指定 agent
[[ "$CLAWD_ONLY" == "--clawd-only" && -z "$AGENT" ]] && {
  log_error "--clawd-only 需要指定 agent"
  usage
}

load_config
validate_config
check_ssh_connection

if [[ "$CLAWD_ONLY" != "--clawd-only" ]]; then
  # --- Step 1: 同步程式碼 ---
  log_section "Step 1／3  同步程式碼到 VPS"
  bash "${SCRIPT_DIR}/vps-sync.sh"

  [[ -z "$AGENT" ]] && { log_info "未指定 agent，同步完成"; exit 0; }

  # --- Step 2: 處理指定 agent 的程序 ---
  log_section "Step 2／3  處理 ${AGENT} 程序"

  run_ssh bash <<REMOTE
  set -euo pipefail
  AGENT="${AGENT}"
  AGENTS_DIR="${AGENTS_DIR}"
  AGENT_DIR="\${AGENTS_DIR}/\${AGENT}"

  if [[ ! -d "\${AGENT_DIR}" ]]; then
    echo "[ERROR] Agent 目錄不存在：\${AGENT_DIR}"
    exit 1
  fi

  echo "--- 執行中程序 ---"
  pids=\$(pgrep -f "\${AGENT_DIR}" 2>/dev/null || true)

  if [[ -n "\$pids" ]]; then
    echo "找到程序 PID：\$pids"
    kill \$pids 2>/dev/null && echo "[OK] 已送出 SIGTERM"
    sleep 2
    # 確認是否還在跑，若是則強制終止
    pids_left=\$(pgrep -f "\${AGENT_DIR}" 2>/dev/null || true)
    if [[ -n "\$pids_left" ]]; then
      kill -9 \$pids_left 2>/dev/null
      echo "[WARN] 已強制終止（SIGKILL）"
    else
      echo "[OK] 程序已正常停止"
    fi
  else
    echo "[INFO] 目前無執行中程序（此 agent 為 cron-based，下次排程自動使用新程式碼）"
  fi

  # 清理 stale pidfile
  rm -f "\${AGENT_DIR}/agent.pid" 2>/dev/null || true

  echo ""
  echo "--- 此 agent 的 cron 排程 ---"
  crontab -l 2>/dev/null | grep --color=never "\${AGENT}" || echo "（無對應的 cron 排程）"
REMOTE
fi

# --- Step 3: 從 rsync 目標同步到 clawd/agents/（執行目錄）---
log_section "Step 3／3  同步到 ${AGENTS_DIR}/${AGENT}/"

run_ssh bash <<REMOTE
  set -euo pipefail
  SRC="${REMOTE_DEST}/src/agents/${AGENT}/"
  DEST="${AGENTS_DIR}/${AGENT}/"

  if [[ ! -d "\${SRC}" ]]; then
    echo "[ERROR] 來源目錄不存在：\${SRC}" >&2
    exit 1
  fi
  if [[ ! -d "\${DEST}" ]]; then
    echo "[ERROR] 目標目錄不存在：\${DEST}（VPS 可能缺少此 agent）" >&2
    exit 1
  fi

  rsync -av --checksum \
    --exclude='node_modules/' \
    --exclude='data/' \
    --exclude='logs/' \
    --exclude='.env' \
    --exclude='*.log' \
    "\${SRC}" "\${DEST}"
  echo "[OK] 已同步到 \${DEST}"
REMOTE

log_section "部署完成：${AGENT}"
log_info "新程式碼已就位，下次排程觸發時生效"
