#!/bin/bash

echo "=== 測試國際財經替代來源 ==="
echo ""

echo "1. SeekingAlpha RSS"
curl -s -m 10 "https://seekingalpha.com/feed.xml" | head -30
echo ""

echo "2. Benzinga RSS"
curl -s -m 10 "https://www.benzinga.com/feed" | head -30
echo ""

echo "3. TheStreet RSS"
curl -s -m 10 "https://www.thestreet.com/rss/index.xml" | head -30
echo ""

echo "4. Barrons RSS"
curl -s -m 10 "https://www.barrons.com/public/resources/syndication/rss_news_and_analysis.xml" | head -30
echo ""

