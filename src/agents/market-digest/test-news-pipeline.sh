#!/bin/bash
# 測試新聞搜集與分析流程

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📰 新聞搜集與分析流程測試"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 1: 測試 news-fetcher.js
echo "📡 Step 1: 測試 RSS 抓取（news-fetcher.js）"
node news-fetcher.js --keywords "台積電,AI,Fed" --core-only > /dev/null 2>&1
if [ -f "data/runtime/fetched-news.json" ]; then
  COUNT=$(jq '.total' data/runtime/fetched-news.json)
  echo "  ✅ RSS 抓取成功：$COUNT 則新聞"
else
  echo "  ❌ RSS 抓取失敗"
  exit 1
fi
echo ""

# Step 2: 測試 news-collector.js
echo "📦 Step 2: 測試新聞搜集（news-collector.js）"
node news-collector.js > /dev/null 2>&1
if [ -f "data/news-collect/$(date +%Y-%m-%d).json" ]; then
  COUNT=$(jq '.count' data/news-collect/$(date +%Y-%m-%d).json)
  echo "  ✅ 新聞搜集成功：$COUNT 則新聞"
else
  echo "  ❌ 新聞搜集失敗"
  exit 1
fi
echo ""

# Step 3: 測試 news-analyzer.js
echo "🔬 Step 3: 測試新聞分析（news-analyzer.js）"
node news-analyzer.js > /dev/null 2>&1
if [ -f "data/news-analyzed/$(date +%Y-%m-%d).json" ]; then
  COUNT=$(jq '.count' data/news-analyzed/$(date +%Y-%m-%d).json)
  echo "  ✅ 新聞分析成功：$COUNT 則新聞"
else
  echo "  ❌ 新聞分析失敗"
  exit 1
fi
echo ""

# Step 4: 檢查格式統一
echo "🔍 Step 4: 檢查資料格式"
COLLECTED=$(jq -r '.news[0] | keys | @json' data/news-collect/$(date +%Y-%m-%d).json)
ANALYZED=$(jq -r '.news[0] | keys | @json' data/news-analyzed/$(date +%Y-%m-%d).json)

if echo "$COLLECTED" | grep -q "summary" && echo "$COLLECTED" | grep -q "publishedAt"; then
  echo "  ✅ 格式統一：summary, publishedAt"
else
  echo "  ❌ 格式不統一"
  exit 1
fi
echo ""

# Step 5: 統計摘要
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 測試摘要"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

FETCHED=$(jq '.total' data/runtime/fetched-news.json)
COLLECTED=$(jq '.count' data/news-collect/$(date +%Y-%m-%d).json)
ANALYZED=$(jq '.count' data/news-analyzed/$(date +%Y-%m-%d).json)

echo "抓取：$FETCHED 則（RSS）"
echo "搜集：$COLLECTED 則（關鍵字過濾後）"
echo "分析：$ANALYZED 則（AI 評分後）"
echo ""

# Step 6: 新聞來源統計
echo "📡 新聞來源："
jq -r '.news | group_by(.source) | map("  \(.[0].source)：\(length) 則") | .[]' data/news-collect/$(date +%Y-%m-%d).json
echo ""

# Step 7: 重要性分布
echo "⭐ 重要性分布："
jq -r '.news | group_by(.analysis.importance) | map("  \(.[0].analysis.importance) 分：\(length) 則") | .[]' data/news-analyzed/$(date +%Y-%m-%d).json
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 所有測試通過！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
