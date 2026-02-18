#!/bin/bash
# deploy.sh — 將 GitHub main 分支最新版本部署到 VPS
#
# 設計原則：
#   VPS ~/clawd 和 GitHub my-project 是 unrelated histories，
#   因此不能 git merge。改用 git show origin/main:src/... 逐檔同步。
#
# 使用方式：
#   ./sre/deploy.sh                    # 部署所有檔案
#   ./sre/deploy.sh --dry-run          # 列出將要同步的檔案，不實際執行
#   ./sre/deploy.sh --file index.js    # 只部署單一檔案
#
# 前提條件（VPS 上執行）：
#   1. VPS ~/clawd 已配置 GitHub remote（git remote -v 可確認）
#   2. 已執行 git fetch origin 以確保 origin/main 最新
#   3. 本腳本在 ~/clawd/agents/market-digest/sre/ 執行

set -euo pipefail

# ── 路徑設定 ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"   # ~/clawd/agents/market-digest
REPO_ROOT="$(cd "$AGENT_DIR/../.." && pwd)" # ~/clawd

GITHUB_REMOTE="origin"
GITHUB_BRANCH="main"
GITHUB_PREFIX="src/agents/market-digest"  # GitHub repo 中的路徑前綴

# ── 參數解析 ─────────────────────────────────────────────────────────────────
DRY_RUN=false
SINGLE_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --file)    SINGLE_FILE="${2:-}"; shift ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [--file <relative_path>]"
      echo ""
      echo "Syncs src/agents/market-digest/* from GitHub origin/main"
      echo "to the local agents/market-digest/ directory."
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

# ── 要同步的檔案清單 ──────────────────────────────────────────────────────────
# 相對於 src/agents/market-digest/（GitHub）= agents/market-digest/（VPS）
FILES=(
  # 頂層
  "index.js"
  "package.json"
  "config.json"

  # pipeline/
  "pipeline/orchestrator.js"
  "pipeline/phase1-us-collect.js"
  "pipeline/phase2-tw-collect.js"
  "pipeline/phase3-process.js"
  "pipeline/phase4-assemble.js"
  "pipeline/weekly-pipeline.js"

  # collectors/
  "collectors/base-collector.js"
  "collectors/twse-collector.js"
  "collectors/fmp-collector.js"
  "collectors/finmind-collector.js"
  "collectors/sec-edgar-collector.js"
  "collectors/yahoo-collector.js"
  "collectors/rss-collector.js"
  "collectors/perplexity-collector.js"

  # processors/
  "processors/validator.js"
  "processors/deduplicator.js"
  "processors/ai-analyzer.js"
  "processors/importance-scorer.js"

  # renderers/
  "renderers/daily-renderer.js"
  "renderers/weekly-renderer.js"
  "renderers/telegram-formatter.js"
  "renderers/section-templates.js"

  # publishers/
  "publishers/telegram-publisher.js"
  "publishers/archive-publisher.js"
  "publishers/alert-publisher.js"

  # commands/
  "commands/command-router.js"
  "commands/cmd-today.js"
  "commands/cmd-watchlist.js"
  "commands/cmd-financial.js"
  "commands/cmd-weekly.js"
  "commands/cmd-analyze.js"
  "commands/cmd-news.js"
  "commands/cmd-query.js"
  "commands/cmd-alerts.js"

  # shared/
  "shared/config-loader.js"
  "shared/cost-ledger.js"
  "shared/logger.js"
  "shared/deduplicator.js"
  "shared/http-client.js"
  "shared/cache-manager.js"
  "shared/rate-limiter.js"
  "shared/schema-validator.js"
  "shared/schemas/daily-brief.schema.js"

  # sre/
  "sre/cron-wrapper.sh"
  "sre/health-check.js"
  "sre/circuit-breaker.js"
  "sre/graceful-degradation.js"
  "sre/dependency-checker.js"
  "sre/deploy.sh"
  "sre/crontab.example"
)

# ── 工具函式 ─────────────────────────────────────────────────────────────────
log()     { echo "[$(date '+%H:%M:%S')] $*"; }
log_ok()  { echo "[$(date '+%H:%M:%S')] ✅ $*"; }
log_err() { echo "[$(date '+%H:%M:%S')] ❌ $*" >&2; }
log_dry() { echo "[DRY-RUN]  $*"; }

sync_file() {
  local REL_PATH="$1"
  local SRC="${GITHUB_REMOTE}/${GITHUB_BRANCH}:${GITHUB_PREFIX}/${REL_PATH}"
  local DST="${AGENT_DIR}/${REL_PATH}"
  local DST_DIR
  DST_DIR="$(dirname "$DST")"

  if $DRY_RUN; then
    log_dry "git show ${SRC} > ${DST}"
    return 0
  fi

  # 確保目標目錄存在
  mkdir -p "$DST_DIR"

  # 從 GitHub 讀取並寫入
  if git -C "$REPO_ROOT" show "${SRC}" > "$DST" 2>/dev/null; then
    log_ok "${REL_PATH}"
    return 0
  else
    log_err "${REL_PATH} — git show failed (file may not exist in GitHub)"
    return 1
  fi
}

# ── 主流程 ───────────────────────────────────────────────────────────────────
main() {
  log "═══════════════════════════════════════════════════"
  log "Market Digest v2 Deploy — $(date '+%Y-%m-%d %H:%M:%S')"
  log "  Repo:   $REPO_ROOT"
  log "  Agent:  $AGENT_DIR"
  log "  Source: ${GITHUB_REMOTE}/${GITHUB_BRANCH}:${GITHUB_PREFIX}/"
  $DRY_RUN && log "  Mode:   DRY-RUN（不實際寫入）"
  log "═══════════════════════════════════════════════════"

  # 確認 git remote 存在
  if ! git -C "$REPO_ROOT" remote get-url "$GITHUB_REMOTE" &>/dev/null; then
    log_err "Remote '${GITHUB_REMOTE}' not found in ${REPO_ROOT}"
    log_err "請先執行: git remote add origin <github-url>"
    exit 1
  fi

  # 先 git fetch 確保 remote 最新
  if ! $DRY_RUN; then
    log "📡 git fetch ${GITHUB_REMOTE}..."
    git -C "$REPO_ROOT" fetch "$GITHUB_REMOTE" "$GITHUB_BRANCH" --quiet 2>&1 \
      || { log_err "git fetch failed"; exit 1; }
    log_ok "fetch 完成"
  fi

  # 決定要部署的檔案清單
  local -a TARGET_FILES
  if [ -n "$SINGLE_FILE" ]; then
    TARGET_FILES=("$SINGLE_FILE")
  else
    TARGET_FILES=("${FILES[@]}")
  fi

  # 執行同步
  local TOTAL=${#TARGET_FILES[@]}
  local OK=0
  local FAIL=0

  for FILE in "${TARGET_FILES[@]}"; do
    if sync_file "$FILE"; then
      (( OK++ )) || true
    else
      (( FAIL++ )) || true
    fi
  done

  log "═══════════════════════════════════════════════════"
  log_ok "部署完成：${OK}/${TOTAL} 成功，${FAIL} 失敗"

  if [ $FAIL -gt 0 ]; then
    log "⚠️  ${FAIL} 個檔案同步失敗（可能是尚未建立的新檔案，請確認）"
  fi

  # 安裝/更新 npm 依賴
  if ! $DRY_RUN && [ $FAIL -lt $TOTAL ]; then
    log "📦 npm install --production..."
    ( cd "$AGENT_DIR" && npm install --production --quiet 2>&1 ) \
      && log_ok "npm install 完成" \
      || log_err "npm install 失敗（請手動執行）"
  fi

  log "═══════════════════════════════════════════════════"
  $DRY_RUN && echo "" && echo "Dry-run 完成，實際部署請去掉 --dry-run 參數"
}

main "$@"
