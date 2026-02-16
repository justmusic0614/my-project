#!/bin/bash

echo "=== 測試替代來源 ==="
echo ""

echo "1. Yahoo Finance 台股（RSS）"
curl -s -m 10 "https://tw.stock.yahoo.com/rss?category=tw-market" | head -30
echo ""

echo "2. 鉅亨網（替代路徑）"
curl -s -m 10 "https://news.cnyes.com/news/cat/tw_stock" | grep -o '<title>.*</title>' | head -5
echo ""

echo "3. MoneyDJ（替代路徑）"
curl -s -m 10 "https://www.moneydj.com/funddj/ya/yp010000.djhtm" | grep -o '<title>.*</title>' | head -5
echo ""

echo "4. 自由時報財經"
curl -s -m 10 "https://ec.ltn.com.tw/rss/news.xml" | head -30
echo ""

echo "5. 中央社財經"
curl -s -m 10 "https://www.cna.com.tw/rss/aie.xml" | head -30
echo ""

echo "6. 工商時報（替代路徑）"
curl -s -m 10 -L "https://ctee.com.tw/feed" | head -30
echo ""
