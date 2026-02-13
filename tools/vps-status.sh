#!/usr/bin/env bash
# vps-status.sh - 查看 VPS 基本資訊與 openclaw agents 執行狀態
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=vps-lib.sh
source "${SCRIPT_DIR}/vps-lib.sh"

load_config
validate_config
check_ssh_connection

log_section "VPS 基本資訊"
run_ssh "hostname && uptime && free -h"

log_section "openclaw Agents 狀態"
run_ssh bash <<REMOTE
  set -euo pipefail
  AGENTS_DIR="${AGENTS_DIR}"

  if [[ ! -d "\${AGENTS_DIR}" ]]; then
    echo "[WARN] Agents 目錄不存在：\${AGENTS_DIR}"
    exit 0
  fi

  echo "--- 目錄內容 ---"
  ls -la "\${AGENTS_DIR}"

  echo ""
  echo "--- 執行中的 openclaw 程序 ---"
  ps aux | grep -E 'openclaw|claude' | grep -v grep || echo "（無執行中程序）"

  echo ""
  echo "--- 各 Agent PID 狀態 ---"
  found=false
  for pidfile in "\${AGENTS_DIR}"/*/*.pid "\${AGENTS_DIR}"/*.pid; do
    [[ -f "\$pidfile" ]] || continue
    found=true
    agent_name=\$(basename "\$(dirname "\$pidfile")")
    pid=\$(cat "\$pidfile")
    if kill -0 "\$pid" 2>/dev/null; then
      echo "  [RUNNING] \${agent_name} (pid=\${pid})"
    else
      echo "  [STOPPED] \${agent_name} (pid=\${pid}, stale pidfile)"
    fi
  done
  [[ "\$found" == "false" ]] && echo "  （無 pidfile，無法追蹤 agent 狀態）"
REMOTE

log_section "磁碟使用狀況"
run_ssh "df -h / && du -sh '${REMOTE_DEST}' 2>/dev/null || echo '（遠端目錄尚不存在）'"
