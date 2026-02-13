#!/usr/bin/env bash
# vps-lib.sh - 共用函式庫
# 由 vps-status.sh、vps-agents.sh、vps-sync.sh source 載入，勿直接執行

# 找到 config 並載入
load_config() {
  local SCRIPT_DIR
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local CONFIG_FILE="${SCRIPT_DIR}/../src/main/resources/config/vps.conf"

  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "[ERROR] 找不到設定檔：${CONFIG_FILE}"
    echo "        請填寫 src/main/resources/config/vps.conf"
    exit 1
  fi
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
}

# 驗證必填設定是否已填入
validate_config() {
  local missing=()
  [[ -z "${VPS_HOST:-}" ]]   && missing+=("VPS_HOST")
  [[ -z "${VPS_USER:-}" ]]   && missing+=("VPS_USER")
  [[ -z "${AGENTS_DIR:-}" ]] && missing+=("AGENTS_DIR")

  if [[ ${#missing[@]} -gt 0 ]]; then
    log_error "下列設定項目尚未填入 vps.conf："
    for key in "${missing[@]}"; do
      echo "        - ${key}"
    done
    exit 1
  fi
}

# 直接執行 SSH 指令（帶 key、port、timeout）
run_ssh() {
  ssh -i "${VPS_KEY}" -p "${VPS_PORT}" \
    -o "ConnectTimeout=${SSH_TIMEOUT}" \
    -o "StrictHostKeyChecking=accept-new" \
    -o "BatchMode=yes" \
    "${VPS_USER}@${VPS_HOST}" "$@"
}

# 輸出 rsync 用的 -e 參數值
ssh_e_flag() {
  echo "ssh -i ${VPS_KEY} -p ${VPS_PORT} -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
}

# 測試 SSH 連線是否可用
check_ssh_connection() {
  log_info "測試 SSH 連線至 ${VPS_USER}@${VPS_HOST}:${VPS_PORT} ..."
  if ! run_ssh "echo ok" &>/dev/null; then
    log_error "SSH 連線失敗，請確認："
    echo "        - VPS_HOST (${VPS_HOST}) 是否正確"
    echo "        - SSH 金鑰 (${VPS_KEY}) 是否存在並有權限"
    echo "        - VPS 是否可達（防火牆 / port）"
    exit 1
  fi
  log_info "SSH 連線正常"
}

# 帶顏色的日誌輸出
log_info()    { echo -e "\033[0;32m[INFO]\033[0m  $*"; }
log_warn()    { echo -e "\033[0;33m[WARN]\033[0m  $*"; }
log_error()   { echo -e "\033[0;31m[ERROR]\033[0m $*"; }
log_section() { echo -e "\n\033[1;34m=== $* ===\033[0m"; }
