#!/usr/bin/env bash
set -euo pipefail

# notify-telegram.sh [FAILED_UNIT]
# - minimal info only: hit_count + file:line
# - no secret content

FAILED_UNIT="${1:-unknown}"

export HOME="${HOME:-/home/clawbot}"
export PATH="/usr/bin:/bin"

ENVF="$HOME/.config/clawdbot/env"
[ -f "$ENVF" ] && . "$ENVF"

: "${TELEGRAM_BOT_TOKEN:?missing TELEGRAM_BOT_TOKEN}"
: "${TELEGRAM_CHAT_ID:?missing TELEGRAM_CHAT_ID}"

NOW_UTC="$(date -u +%FT%TZ)"
HOST="$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo unknown)"

EXPORT_ROOT="$HOME/.local/share/clawbot/exports"
LATEST="$(ls -1dt "$EXPORT_ROOT"/host-leakscan-v1-* 2>/dev/null | head -n 1 || true)"
[ -n "${LATEST:-}" ] || exit 0

REPORT="$LATEST/report.json"
HITS_TXT="$LATEST/02-hits.txt"

HC="0"
if [ -f "$REPORT" ]; then
  HC="$(python3 - <<'PY' "$REPORT"
import json,sys
p=sys.argv[1]
try:
  r=json.load(open(p,'r',encoding='utf-8'))
  print(int(r.get('hit_count',0)))
except Exception:
  print(0)
PY
)"
fi

# If somehow OnFailure triggered but hit_count is 0, still notify but keep it minimal.
# Limit lines to avoid telegram spam.
HITS_SNIP="(no hits file)"
if [ -f "$HITS_TXT" ]; then
  HITS_SNIP="$(sed -n '1,20p' "$HITS_TXT" 2>/dev/null || true)"
  [ -n "$HITS_SNIP" ] || HITS_SNIP="(empty)"
fi

MSG="🚨 leakscan v1
host: ${HOST}
time: ${NOW_UTC}
unit: ${FAILED_UNIT}
hits: ${HC}
outdir: ${LATEST}
files:
${HITS_SNIP}"

curl -fsS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${MSG}" \
  -d "disable_web_page_preview=true" >/dev/null

echo "✅ telegram notified: time=${NOW_UTC} host=${HOST} unit=${FAILED_UNIT} hits=${HC} outdir=${LATEST}"
