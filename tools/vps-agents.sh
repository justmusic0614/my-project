#!/usr/bin/env bash
# vps-agents.sh - 管理 VPS 上的 openclaw agents（啟動/停止/重啟/清單）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=vps-lib.sh
source "${SCRIPT_DIR}/vps-lib.sh"

usage() {
  cat <<EOF
用法：
  $(basename "$0") list              列出所有 agents 及執行狀態
  $(basename "$0") start <agent>     啟動指定 agent
  $(basename "$0") stop  <agent>     停止指定 agent（SIGTERM → SIGKILL）
  $(basename "$0") restart <agent>   重啟指定 agent
  $(basename "$0") start-all         啟動全部 agents
  $(basename "$0") stop-all          停止全部 agents
EOF
  exit 1
}

load_config
validate_config

ACTION="${1:-}"
AGENT_NAME="${2:-}"

[[ -z "$ACTION" ]] && usage

check_ssh_connection

# 所有遠端邏輯透過 heredoc 傳給 VPS bash 執行
run_ssh bash <<REMOTE
  set -euo pipefail
  AGENTS_DIR="${AGENTS_DIR}"
  ACTION="${ACTION}"
  AGENT_NAME="${AGENT_NAME}"

  do_list() {
    echo "=== 已設定的 Agents ==="
    if [[ ! -d "\${AGENTS_DIR}" ]]; then
      echo "（Agents 目錄不存在：\${AGENTS_DIR}）"
      return 0
    fi
    ls "\${AGENTS_DIR}/" 2>/dev/null || echo "（目錄為空）"

    echo ""
    echo "=== 執行狀態 ==="
    found=false
    for pidfile in "\${AGENTS_DIR}"/*/*.pid "\${AGENTS_DIR}"/*.pid; do
      [[ -f "\$pidfile" ]] || continue
      found=true
      name=\$(basename "\$(dirname "\$pidfile")")
      pid=\$(cat "\$pidfile")
      if kill -0 "\$pid" 2>/dev/null; then
        echo "  [RUNNING] \$name (pid=\$pid)"
      else
        echo "  [STOPPED] \$name (stale pidfile)"
      fi
    done
    [[ "\$found" == "false" ]] && echo "  （無 pidfile）"
  }

  do_start() {
    local agent="\$1"
    local agent_dir="\${AGENTS_DIR}/\${agent}"
    local pidfile="\${agent_dir}/agent.pid"
    local logfile="\${agent_dir}/agent.log"

    [[ -d "\$agent_dir" ]] || { echo "[ERROR] Agent 目錄不存在：\$agent_dir"; exit 1; }

    if [[ -f "\$pidfile" ]] && kill -0 "\$(cat "\$pidfile")" 2>/dev/null; then
      echo "[WARN] \${agent} 已在執行中 (pid=\$(cat "\$pidfile"))"
      return 0
    fi

    # 以背景方式啟動 openclaw agent
    # 根據實際 openclaw 指令調整此行：
    nohup openclaw start --agent "\$agent" >> "\$logfile" 2>&1 &
    local new_pid=\$!
    echo "\$new_pid" > "\$pidfile"
    echo "[OK] 啟動 \${agent} (pid=\${new_pid})"
  }

  do_stop() {
    local agent="\$1"
    local pidfile="\${AGENTS_DIR}/\${agent}/agent.pid"

    if [[ ! -f "\$pidfile" ]]; then
      echo "[WARN] 找不到 \${agent} 的 pidfile，嘗試用 pkill..."
      pkill -f "openclaw.*\${agent}" 2>/dev/null && echo "[OK] 已停止" || echo "[INFO] 無符合程序"
      return 0
    fi

    local pid
    pid=\$(cat "\$pidfile")
    if kill -0 "\$pid" 2>/dev/null; then
      kill "\$pid" && echo "[OK] 停止 \${agent} (pid=\$pid)"
      sleep 2
      if kill -0 "\$pid" 2>/dev/null; then
        kill -9 "\$pid" && echo "[WARN] 強制終止 \${agent}"
      fi
    else
      echo "[INFO] \${agent} 已不在執行中"
    fi
    rm -f "\$pidfile"
  }

  case "\${ACTION}" in
    list)
      do_list
      ;;
    start)
      [[ -n "\${AGENT_NAME}" ]] || { echo "[ERROR] 請指定 agent 名稱"; exit 1; }
      do_start "\${AGENT_NAME}"
      ;;
    stop)
      [[ -n "\${AGENT_NAME}" ]] || { echo "[ERROR] 請指定 agent 名稱"; exit 1; }
      do_stop "\${AGENT_NAME}"
      ;;
    restart)
      [[ -n "\${AGENT_NAME}" ]] || { echo "[ERROR] 請指定 agent 名稱"; exit 1; }
      do_stop "\${AGENT_NAME}"
      sleep 1
      do_start "\${AGENT_NAME}"
      ;;
    start-all)
      if [[ ! -d "\${AGENTS_DIR}" ]]; then
        echo "[ERROR] Agents 目錄不存在：\${AGENTS_DIR}"
        exit 1
      fi
      for d in "\${AGENTS_DIR}"/*/; do
        [[ -d "\$d" ]] || continue
        do_start "\$(basename "\$d")"
      done
      ;;
    stop-all)
      for pidfile in "\${AGENTS_DIR}"/*/*.pid "\${AGENTS_DIR}"/*.pid; do
        [[ -f "\$pidfile" ]] || continue
        agent_name=\$(basename "\$(dirname "\$pidfile")")
        do_stop "\${agent_name}"
      done
      ;;
    *)
      echo "[ERROR] 未知動作：\${ACTION}"
      exit 1
      ;;
  esac
REMOTE
