#!/usr/bin/env bash
# brain-ingest.sh — Brain Markdown → Knowledge-Digest 端對端 pipeline
#
# 用法:
#   ./tools/brain-ingest.sh <brain-markdown.md> [--yes|--dry-run|--tags=t1,t2]
#
# 流程:
#   1. brain-parser.py 解析 Markdown → data/chunks/{name}.chunks.json
#   2. digest.js ingest 預覽並確認寫入（預設會詢問）
#
# 注意:
#   - 手動使用：預設互動模式會詢問確認
#   - 自動化 / cron / pipeline：請搭配 --yes 跳過詢問
#   - 不同資料夾的同名 markdown 會產生相同 chunks 檔名，請避免

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

INPUT="${1:-}"
if [[ -z "$INPUT" ]]; then
  echo "用法: $0 <brain-markdown.md> [--yes|--dry-run|--tags=t1,t2]"
  exit 1
fi

if [[ ! -f "$INPUT" ]]; then
  echo "Error: 檔案不存在: $INPUT"
  exit 1
fi

# ── Step 1: 解析 brain markdown ─────────────────────────────
echo "🧠 解析 brain markdown: $(basename "$INPUT")"
python3 "$PROJECT_ROOT/tools/brain-parser.py" "$INPUT" --no-transcript

NAME=$(basename "$INPUT" .md)
CHUNKS="$PROJECT_ROOT/data/chunks/${NAME}.chunks.json"

if [[ ! -f "$CHUNKS" ]]; then
  echo "Error: parser 輸出不存在: $CHUNKS"
  exit 1
fi

# 驗證 JSON 合法性
python3 -c "import json; json.load(open('$CHUNKS'))" 2>/dev/null || {
  echo "Error: 無效的 JSON: $CHUNKS"
  exit 1
}

# ── Step 2: 匯入 knowledge-digest ───────────────────────────
echo "📥 匯入至 knowledge-digest..."
node "$PROJECT_ROOT/src/agents/knowledge-digest/scripts/digest.js" ingest "$CHUNKS" "${@:2}"
