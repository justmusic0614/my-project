#!/bin/bash
# Phase 1: 測試新聞來源可用性

echo "=== 第一層（核心）==="
echo ""

echo "1. 工商時報 RSS"
curl -s -m 10 "https://www.chinatimes.com/rss/money" | head -20
echo ""

echo "2. 經濟日報 RSS"
curl -s -m 10 "https://money.udn.com/rssfeed/news/1001/5591/latest" | head -20
echo ""

echo "3. CNBC RSS"
curl -s -m 10 "https://www.cnbc.com/id/10000664/device/rss/rss.html" | head -20
echo ""

echo "=== 第二層（補充）==="
echo ""

echo "4. 鉅亨網 RSS"
curl -s -m 10 "https://news.cnyes.com/rss/tw" | head -20
echo ""

echo "5. MoneyDJ RSS"
curl -s -m 10 "https://www.moneydj.com/rss/rank.djrss" | head -20
echo ""

echo "=== Yahoo Finance（需進一步測試 API）==="
echo "6. Yahoo Finance - 需使用 API，暫時略過"
echo ""

echo "=== Reuters（需進一步測試）==="
echo "7. Reuters - 需確認繁中或英文來源"
