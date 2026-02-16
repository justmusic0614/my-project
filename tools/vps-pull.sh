#!/bin/bash
# 從 VPS 拉取最新代碼到本地（反向同步）

set -e

VPS_HOST="clawbot@159.65.136.0"
VPS_BASE="/home/clawbot/clawd"
LOCAL_BASE="/Users/suweicheng/projects/my-project/src"

echo "🔄 從 VPS 拉取最新代碼..."

# 拉取 market-digest
echo "📦 Pulling market-digest..."
rsync -avz --progress \
  --exclude='data/' \
  --exclude='logs/' \
  --exclude='node_modules/' \
  --exclude='*.log' \
  ${VPS_HOST}:${VPS_BASE}/agents/market-digest/ \
  ${LOCAL_BASE}/agents/market-digest/

echo "✅ 同步完成"
echo ""
echo "💡 下一步："
echo "   1. 檢查變更: git status"
echo "   2. 提交變更: git add . && git commit -m 'Sync from VPS'"
