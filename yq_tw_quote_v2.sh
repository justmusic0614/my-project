#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-cdp97}"
SYMBOLS="${2:-2330.TW}"

# ----- helpers -----
log() { printf "[%s] %s\n" "$(date +'%H:%M:%S')" "$*" >&2; }

# Retry wrapper for flaky gateway/control server hiccups
retry() {
  local tries="${1}"; shift
  local sleep_s="${1}"; shift
  local n=1
  while true; do
    if "$@"; then return 0; fi
    if (( n >= tries )); then return 1; fi
    log "retry $n/$tries failed: $*"
    sleep "$sleep_s"
    n=$((n+1))
  done
}

# Run a clawdbot browser command with retries (helps when gateway briefly blips)
b() { retry 5 0.6 clawdbot browser --browser-profile "$PROFILE" "$@"; }

# Open a clean tab and return its id
open_clean_tab_id() {
  # open about:blank and capture id line: "id: XXXXX"
  local out
  out="$(b open about:blank)"
  # echo to stderr so logs remain visible if piping output
  echo "$out" >&2
  echo "$out" | awk -F': ' '/^id: /{print $2; exit}'
}

# Navigate within the focused tab (no new tabs)
nav() {
  local url="$1"
  b navigate "$url" >/dev/null
}

wait_ms() { b wait --time "$1" >/dev/null; }

eval_js() {
  local fn="$1"
  b evaluate --fn "$fn"
}

# ----- main -----
TAB_ID="$(open_clean_tab_id)"
if [[ -z "${TAB_ID}" ]]; then
  echo "ERROR: failed to create a clean tab id" >&2
  exit 1
fi

b focus "$TAB_ID" >/dev/null
log "Using tab: $TAB_ID"

# 1) Warm up session/cookies by visiting quote page (same tab)
FIRST="${SYMBOLS%%,*}"
log "Warm-up: https://finance.yahoo.com/quote/$FIRST"
nav "https://finance.yahoo.com/quote/${FIRST}"
wait_ms 2500

# 2) Get crumb (same tab)
log "Get crumb"
nav "https://query1.finance.yahoo.com/v1/test/getcrumb"
wait_ms 1200
CRUMB="$(eval_js '() => document.body?.innerText?.trim?.() || ""' | tr -d '"')"

if [[ -z "$CRUMB" ]]; then
  echo "ERROR: crumb empty (cookie/session not set or blocked)" >&2
  exit 1
fi
log "Crumb: $CRUMB"

# 3) Fetch quote JSON with crumb (same tab)
URL="https://query1.finance.yahoo.com/v7/finance/quote?symbols=${SYMBOLS}&crumb=${CRUMB}"
log "Quote JSON: $URL"
nav "$URL"
wait_ms 1400

# 4) Normalize output fields
eval_js '() => {
  const rawText = document.body?.innerText || "";
  let raw;
  try { raw = JSON.parse(rawText); } catch (e) {
    return { error: "json_parse_failed", head: rawText.slice(0,300) };
  }
  const q = raw?.quoteResponse?.result?.[0];
  if (!q) return raw;

  return {
    source: "yahoo_quote_v7",
    symbol: q.symbol ?? null,
    name: q.longName || q.shortName || null,
    currency: q.currency || null,
    regularMarketTime: q.regularMarketTime ?? null,
    price: q.regularMarketPrice ?? null,
    chg: q.regularMarketChange ?? null,
    chgPct: q.regularMarketChangePercent ?? null,
    prevClose: q.regularMarketPreviousClose ?? null,
    open: q.regularMarketOpen ?? null,
    dayRange: q.regularMarketDayRange ?? null,
    dayHigh: q.regularMarketDayHigh ?? null,
    dayLow: q.regularMarketDayLow ?? null,
    volume: q.regularMarketVolume ?? null,
    marketCap: q.marketCap ?? null
  };
}'
