#!/bin/bash

echo "=== Reuters 測試 ==="
echo ""

echo "1. Reuters Business RSS"
curl -s -m 10 "https://www.reuters.com/business/feed/" | head -30
echo ""

echo "2. Reuters Markets RSS"
curl -s -m 10 "https://www.reuters.com/markets/feed/" | head -30
echo ""

echo "3. Reuters Finance RSS (舊版)"
curl -s -m 10 "http://feeds.reuters.com/reuters/businessNews" | head -30
echo ""

echo "=== CNBC 測試 ==="
echo ""

echo "4. CNBC Business RSS (替代)"
curl -s -m 10 "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147" | head -30
echo ""

echo "5. CNBC Markets RSS"
curl -s -m 10 "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069" | head -30
echo ""

echo "6. CNBC Top News RSS"
curl -s -m 10 "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" | head -30
echo ""

echo "7. CNBC Asia RSS"
curl -s -m 10 "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19832390" | head -30
echo ""

echo "=== Bloomberg 免費入口測試 ==="
echo ""

echo "8. Bloomberg Markets (嘗試)"
curl -s -m 10 "https://www.bloomberg.com/feed/podcast/markets-daily.xml" | head -30
echo ""

