#!/usr/bin/env bash
set -euo pipefail
export HOME="${HOME:-/home/clawbot}"
export PATH="/usr/bin:/bin"
ENVF="$HOME/.config/clawdbot/env"
[ -f "$ENVF" ] && . "$ENVF"
: "${TELEGRAM_BOT_TOKEN:?missing TELEGRAM_BOT_TOKEN}"
: "${TELEGRAM_CHAT_ID:?missing TELEGRAM_CHAT_ID}"

NOW_UTC="$(date -u +%FT%TZ)"
HOST="$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo unknown)"
MSG="${1:-"(no message)"}"
TEXT="[$NOW_UTC][$HOST] $MSG"

curl -fsS --max-time 10 --retry 2 --retry-delay 1 \
  -d "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${TEXT}" \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" >/dev/null

echo "✅ telegram notified: $MSG"
