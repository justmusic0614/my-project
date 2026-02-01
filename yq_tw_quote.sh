#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-cdp93}"
SYMBOLS="${2:-2330.TW}"

# 1) 打開 quote 頁：讓 Yahoo 設 cookie/session（同一個 browser profile 很重要）
clawdbot browser --browser-profile "$PROFILE" open "https://finance.yahoo.com/quote/${SYMBOLS%%,*}"
clawdbot browser --browser-profile "$PROFILE" wait --time 2000 >/dev/null

# 2) 取 crumb
clawdbot browser --browser-profile "$PROFILE" open "https://query1.finance.yahoo.com/v1/test/getcrumb"
clawdbot browser --browser-profile "$PROFILE" wait --time 1200 >/dev/null
CRUMB="$(clawdbot browser --browser-profile "$PROFILE" evaluate --fn '() => document.body.innerText.trim()' | tr -d '"')"

if [[ -z "$CRUMB" ]]; then
  echo "ERROR: crumb empty" >&2
  exit 1
fi

# 3) 打開 quote JSON（用 crumb）
URL="https://query1.finance.yahoo.com/v7/finance/quote?symbols=${SYMBOLS}&crumb=${CRUMB}"
clawdbot browser --browser-profile "$PROFILE" open "$URL"
clawdbot browser --browser-profile "$PROFILE" wait --time 1200 >/dev/null

# 4) Normalize：只輸出你 pipeline 常用欄位（可再擴）
clawdbot browser --browser-profile "$PROFILE" evaluate --fn '() => {
  const raw = JSON.parse(document.body.innerText);
  const q = raw?.quoteResponse?.result?.[0];
  if (!q) return raw;
  return {
    source: "yahoo_quote_v7",
    symbol: q.symbol,
    name: q.longName || q.shortName || null,
    currency: q.currency || null,
    regularMarketTime: q.regularMarketTime || null,
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
