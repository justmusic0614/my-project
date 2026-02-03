#!/usr/bin/env bash
set -euo pipefail
export HOME="${HOME:-/home/clawbot}"
export PATH="/usr/bin:/bin"

ENVF="$HOME/.config/clawdbot/env"
[ -f "$ENVF" ] && . "$ENVF"

: "${TELEGRAM_BOT_TOKEN:?missing TELEGRAM_BOT_TOKEN}"
: "${TELEGRAM_CHAT_ID:?missing TELEGRAM_CHAT_ID}"

STATE_DIR="$HOME/.local/state/clawdbot"
mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/telegram_watchdog.state"

NOW="$(date -u +%FT%TZ)"
HOST="$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo unknown)"

# systemctl --user needs user bus; in env -i debug it may not exist
GW_ACTIVE="unknown"
if systemctl --user show-environment >/dev/null 2>&1; then
  GW_ACTIVE="$(systemctl --user is-active clawdbot-gateway.service 2>/dev/null || true)"
fi

# Fetch then parse (NO PIPE) to avoid curl/sigpipe weirdness
RESP="$(curl -fsS --max-time 10 --retry 1 --retry-delay 1 \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" \
  2>/dev/null || true)"

PENDING="$(
  python3 - <<'PY' "$RESP"
import json,sys
s=sys.argv[1]
if not s:
  print(-1); raise SystemExit(0)
try:
  d=json.loads(s)
  print(int(d.get("result",{}).get("pending_update_count",0)))
except Exception:
  print(-1)
PY
)"

STUCK=0
if [ -f "$STATE_FILE" ]; then
  # shellcheck disable=SC1090
  . "$STATE_FILE" || true
fi

ACTION="ok"
NEW_STUCK="$STUCK"

if [ "$PENDING" -lt 0 ]; then
  ACTION="telegram_api_error"
  NEW_STUCK=0
elif [ "$GW_ACTIVE" != "active" ] && [ "$GW_ACTIVE" != "unknown" ]; then
  ACTION="gateway_down"
  NEW_STUCK=$((STUCK+1))
elif [ "$PENDING" -gt 0 ]; then
  ACTION="pending_nonzero"
  NEW_STUCK=$((STUCK+1))
else
  ACTION="ok"
  NEW_STUCK=0
fi

# persist state
cat >"$STATE_FILE" <<EOF_STATE
STUCK=$NEW_STUCK
EOF_STATE

MSG="clawdbot telegram watchdog: action=$ACTION pending=$PENDING gw=$GW_ACTIVE stuck=$NEW_STUCK"
echo "watchdog [$NOW] host=$HOST $MSG"

# alert policy
THRESH=999
if [ "$ACTION" = "gateway_down" ]; then THRESH=2; fi
if [ "$ACTION" = "pending_nonzero" ]; then THRESH=3; fi

if [ "$NEW_STUCK" -ge "$THRESH" ]; then
  "$HOME/clawd/sre/notify-telegram-generic.sh" "$MSG" || true
fi

exit 0
