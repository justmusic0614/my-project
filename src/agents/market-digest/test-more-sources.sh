#!/bin/bash

echo "=== 台灣本地媒體測試 ==="
echo ""

echo "1. 聯合新聞網 - 產經"
curl -s -m 10 "https://udn.com/rssfeed/news/2/6644/latest" | head -30
echo ""

echo "2. 東森新聞 - 財經"
curl -s -m 10 "https://fnc.ebc.net.tw/rss.xml" | head -30
echo ""

echo "3. PChome 新聞 - 財經"
curl -s -m 10 "https://news.pchome.com.tw/rss/BusinessNews.xml" | head -30
echo ""

echo "4. 蘋果新聞 - 財經 (SKIP: not RSS / moved)"
echo ""

echo "=== 國際財經媒體測試 ==="
echo ""

echo "5. MarketWatch - Top Stories"
curl -s -m 10 "https://www.marketwatch.com/rss/topstories" | head -30
echo ""

echo "6. MarketWatch - World Markets"
curl -s -m 10 "https://www.marketwatch.com/rss/marketpulse" | head -30
echo ""

echo "7. Investing.com RSS"
curl -s -m 10 "https://www.investing.com/rss/news.rss" | head -30
echo ""

echo "8. Financial Times (測試)"
curl -s -m 10 "https://www.ft.com/rss/home" | head -30
echo ""

echo "=== 新浪財經 ==="
echo ""

echo "9. 新浪財經 - 台股"
curl -s -m 10 "https://finance.sina.com.cn/roll/index.d.html?col=tw" | grep -o '<title>.*</title>' | head -10
echo ""

echo "=== Anue 鉅亨網（替代路徑）==="
echo ""

echo "10. 鉅亨網 - 台股新聞 JSON API"
curl -s -m 10 "https://news.cnyes.com/api/v3/news/category/tw_stock?limit=10" | head -50
echo ""

