#!/bin/bash
# run-brain-distill.sh — 環境初始化 + 呼叫 brain-distill.js
# 用法：run-brain-distill.sh '<payload>' --job-id=brain-xxx
#
# 隱含契約：.env 必須是 shell-safe 格式（KEY=VALUE 或 KEY="quoted value"）

set -euo pipefail

# ── 環境初始化（NVM + PATH + API keys）──────────────────
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 向上找 .env（優先 agent 層，再往上到 project root）
for d in "$AGENT_ROOT" "$AGENT_ROOT/.." "$AGENT_ROOT/../.." "$AGENT_ROOT/../../.."; do
  if [ -f "$d/.env" ]; then
    set -a
    source "$d/.env"
    set +a
    break
  fi
done

export SUMMARIZE_DISABLE_LOCAL_WHISPER_CPP=1

# ── 執行 ────────────────────────────────────────────────
exec node "$SCRIPT_DIR/brain-distill.js" "$@"
