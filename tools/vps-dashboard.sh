#!/usr/bin/env bash
# ============================================================
# vps-dashboard.sh - Deploy Kanban Dashboard to VPS
# Usage: bash tools/vps-dashboard.sh [build|deploy|restart|status]
# ============================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/vps-lib.sh"

# Load VPS config
load_config

DASHBOARD_DIR="src/agents/kanban-dashboard"
REMOTE_DASHBOARD="${REMOTE_DEST}/${DASHBOARD_DIR}"

cmd_build() {
  log_info "Building React client..."
  cd "${LOCAL_SRC}/${DASHBOARD_DIR}/client"
  npm run build
  log_info "Build complete: client/dist/"
}

cmd_deploy() {
  log_info "Syncing dashboard to VPS..."
  rsync -avz --delete \
    -e "ssh -i ${VPS_KEY} -p ${VPS_PORT} -o ConnectTimeout=${SSH_TIMEOUT}" \
    --exclude 'client/node_modules' \
    --exclude 'data/uploads' \
    --exclude 'data/*.lock' \
    --include 'client/dist/***' \
    --exclude 'client/src' \
    "${LOCAL_SRC}/${DASHBOARD_DIR}/" \
    "${VPS_USER}@${VPS_HOST}:${REMOTE_DASHBOARD}/"

  log_info "Installing server dependencies on VPS..."
  run_ssh "export NVM_DIR=\$HOME/.nvm && source \$NVM_DIR/nvm.sh && cd ${REMOTE_DASHBOARD} && npm install --omit=dev"

  log_info "Restarting dashboard on VPS..."
  run_ssh "export NVM_DIR=\$HOME/.nvm && source \$NVM_DIR/nvm.sh && cd ${REMOTE_DASHBOARD} && pm2 restart ecosystem.config.js --update-env 2>/dev/null || pm2 start ecosystem.config.js"

  log_info "Dashboard deployed! Access via Tailscale."
}

cmd_restart() {
  log_info "Restarting dashboard on VPS..."
  run_ssh "cd ${REMOTE_DASHBOARD} && pm2 restart kanban-dashboard"
}

cmd_status() {
  log_info "Dashboard status:"
  run_ssh "pm2 show kanban-dashboard 2>/dev/null || echo 'Not running'"
}

# Main
ACTION="${1:-deploy}"
case "$ACTION" in
  build)   cmd_build ;;
  deploy)  cmd_build && cmd_deploy ;;
  restart) cmd_restart ;;
  status)  cmd_status ;;
  *)       echo "Usage: $0 [build|deploy|restart|status]"; exit 1 ;;
esac
