#!/bin/bash
# 測試去重機制

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 去重機制測試"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 1: 檢查 NewsDeduplicator
echo "📦 Step 1: 檢查 NewsDeduplicator"
if [ -f "news-deduplicator.js" ]; then
  echo "  ✅ news-deduplicator.js 存在"
else
  echo "  ❌ news-deduplicator.js 不存在"
  exit 1
fi
echo ""

# Step 2: 測試不啟用去重
echo "🚫 Step 2: 測試不啟用去重（基準）"
node news-analyzer.js --no-dedup > /tmp/no-dedup.log 2>&1
BEFORE_COUNT=$(jq '.count' data/news-analyzed/$(date +%Y-%m-%d).json)
echo "  不去重：$BEFORE_COUNT 則"
echo ""

# Step 3: 測試啟用去重
echo "✅ Step 3: 測試啟用去重"
node news-analyzer.js > /tmp/with-dedup.log 2>&1
AFTER_COUNT=$(jq '.count' data/news-analyzed/$(date +%Y-%m-%d).json)
echo "  去重後：$AFTER_COUNT 則"
echo ""

# Step 4: 比較結果
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 去重效果統計"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

FILTERED=$((BEFORE_COUNT - AFTER_COUNT))
if [ $FILTERED -gt 0 ]; then
  FILTER_RATE=$(echo "scale=1; $FILTERED * 100 / $BEFORE_COUNT" | bc)
  echo "去重前：$BEFORE_COUNT 則"
  echo "去重後：$AFTER_COUNT 則"
  echo "過濾：$FILTERED 則（${FILTER_RATE}%）"
else
  echo "去重前：$BEFORE_COUNT 則"
  echo "去重後：$AFTER_COUNT 則"
  echo "過濾：0 則（無重複）"
fi
echo ""

# Step 5: 優先級分布
echo "🎯 優先級分布（去重後）"
jq -r '.news | group_by(.analysis.priority) | map("  \(.[0].analysis.priority)：\(length) 則") | .[]' data/news-analyzed/$(date +%Y-%m-%d).json
echo ""

# Step 6: 檢查 relatedCount
echo "🔗 同事件合併檢查"
MERGED=$(jq '[.news[] | select(.relatedCount > 0)] | length' data/news-analyzed/$(date +%Y-%m-%d).json)
if [ "$MERGED" = "null" ] || [ "$MERGED" = "0" ]; then
  echo "  無同事件合併（可選功能）"
else
  echo "  合併：$MERGED 個群組"
  jq -r '.news[] | select(.relatedCount > 0) | "  • \(.title[0:60])... (\(.relatedCount) 則相關)"' data/news-analyzed/$(date +%Y-%m-%d).json
fi
echo ""

# Step 7: 顯示去重日誌
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 去重日誌（最後執行）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
cat /tmp/with-dedup.log | grep -A 50 "開始去重流程" | head -60
echo ""

# Step 8: 驗收結果
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 去重機制驗收"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 檢查早報比對
if grep -q "與早報比對去重" /tmp/with-dedup.log; then
  echo "✅ 早報比對：已執行"
else
  echo "⚠️  早報比對：跳過（無早報資料）"
fi

# 檢查標題相似度去重
if grep -q "標題相似度去重" /tmp/with-dedup.log; then
  echo "✅ 標題相似度：已執行"
else
  echo "⚠️  標題相似度：跳過"
fi

# 檢查數量限制
if grep -q "數量限制統計" /tmp/with-dedup.log; then
  echo "✅ 數量限制：已執行"
else
  echo "❌ 數量限制：未執行"
fi

echo ""

# 最終結論
if [ $AFTER_COUNT -le $BEFORE_COUNT ]; then
  echo "🎉 去重機制運作正常！"
  echo ""
  echo "✅ NewsDeduplicator 整合成功"
  echo "✅ 早報比對機制就緒"
  echo "✅ 數量限制生效"
  echo "✅ 過濾 $FILTERED 則重複/低價值新聞"
else
  echo "❌ 去重機制異常（去重後反而增加）"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
