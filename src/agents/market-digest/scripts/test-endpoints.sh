#!/bin/bash
# =============================================================================
# test-endpoints.sh — FMP Starter + FinMind Backer 端點探測
# 在 VPS 上執行：cd ~/clawd/agents/market-digest && bash scripts/test-endpoints.sh
# =============================================================================
set -a && source .env && set +a

TODAY=$(date +%F)
NEXT_WEEK=$(date -d '+7 days' +%F 2>/dev/null || date -v+7d +%F)

echo "========================================="
echo "  端點探測  $TODAY"
echo "========================================="

echo ""
echo "=== 1. FMP Starter 端點測試 ==="
echo ""

echo "--- 1a. gainers ---"
curl -s "https://financialmodelingprep.com/stable/gainers?apikey=$FMP_API_KEY" | head -c 300
echo ""

echo "--- 1b. losers ---"
curl -s "https://financialmodelingprep.com/stable/losers?apikey=$FMP_API_KEY" | head -c 300
echo ""

echo "--- 1c. earning-calendar ---"
curl -s "https://financialmodelingprep.com/stable/earning-calendar?from=$TODAY&to=$NEXT_WEEK&apikey=$FMP_API_KEY" | head -c 300
echo ""

echo "--- 1d. economic-calendar ---"
curl -s "https://financialmodelingprep.com/stable/economic-calendar?from=$TODAY&to=$NEXT_WEEK&apikey=$FMP_API_KEY" | head -c 300
echo ""

echo "--- 1e. quote (對照用，應該正常) ---"
curl -s "https://financialmodelingprep.com/stable/quote?symbol=NVDA&apikey=$FMP_API_KEY" | head -c 300
echo ""

echo ""
echo "=== 2. FinMind Backer 端點測試 ==="
echo ""

echo "--- 2a. TaiwanStockTotalMarginPurchaseShortSale (全市場融資融券) ---"
curl -s "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockTotalMarginPurchaseShortSale&start_date=$TODAY&end_date=$TODAY&token=$FINMIND_API_TOKEN" | python3 -m json.tool 2>/dev/null | head -40
echo ""

echo "--- 2b. TaiwanStockPrice TW50 (5支測試，確認 spread 欄位) ---"
curl -s "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=2330,2454,2317,2382,2881&start_date=$TODAY&end_date=$TODAY&token=$FINMIND_API_TOKEN" | python3 -m json.tool 2>/dev/null | head -60
echo ""

echo "--- 2c. TaiwanStockInfo (股票名稱查詢，確認 stock_name 欄位) ---"
curl -s "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo&token=$FINMIND_API_TOKEN" | python3 -m json.tool 2>/dev/null | head -30
echo ""

echo ""
echo "=== 3. TWSE 融資融券現況 ==="
echo ""
curl -s "https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN" | python3 -m json.tool 2>/dev/null | head -30
echo ""

echo ""
echo "========================================="
echo "  探測完成！請將輸出貼回給我"
echo "========================================="
