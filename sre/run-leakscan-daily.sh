#!/usr/bin/env bash
set -euo pipefail

# ensure HOME env, and keep minimal PATH (scanner doesn't need node)
export HOME="${HOME:-/home/clawbot}"
export PATH="/usr/bin:/bin"

TS="$(date -u +%F)"
LOGDIR="$HOME/clawd/sre/logs"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/leakscan-$TS.log"

echo "==== leakscan start $(date -u +%FT%TZ) ====" | tee -a "$LOG"
set +e
"$HOME/clawd/sre/host-leak-scan-v1.sh" 2>&1 | tee -a "$LOG"
RC=${PIPESTATUS[0]}
set -e
echo "==== leakscan end rc=$RC $(date -u +%FT%TZ) ====" | tee -a "$LOG"

# pass through exit code:
exit "$RC"
