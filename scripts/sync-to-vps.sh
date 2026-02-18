#!/bin/bash
# VPS 同步腳本 - 選擇性同步本地變更到 VPS
# 用途：避免本地做的變更沒有 update 到 VPS

set -e

VPS_HOST="clawbot@159.65.136.0"
VPS_BASE="/home/clawbot/clawd"
LOCAL_BASE="/Users/suweicheng/projects/my-project"

echo "🔄 開始同步到 VPS..."
echo ""

# 需要同步的檔案/目錄列表
# 注意：此腳本為過渡期用，新部署請改用 tools/deploy.sh
SYNC_ITEMS=(
  "src/agents/shared"                           # Dispatcher 相關
  "src/agents/knowledge-digest/scripts"         # Knowledge Digest
  "src/agents/kanban-dashboard/server"          # Kanban server（完整）
  "src/agents/kanban-dashboard/scripts"         # Telegram poller 等
  "src/agents/kanban-dashboard/sre"             # SRE 健康檢查
  "src/agents/kanban-dashboard/ecosystem.config.js"  # PM2 設定
  "src/agents/kanban-dashboard/package.json"    # Dependencies
)

# 同步每個項目
for item in "${SYNC_ITEMS[@]}"; do
  echo "📦 同步: $item"

  # 取得目標路徑（移除 src/ 前綴）
  TARGET_PATH="${item#src/}"
  VPS_PATH="$VPS_BASE/$TARGET_PATH"
  LOCAL_PATH="$LOCAL_BASE/$item"

  if [ -d "$LOCAL_PATH" ]; then
    # 目錄 - 使用 rsync
    ssh "$VPS_HOST" "mkdir -p $(dirname "$VPS_PATH")"
    rsync -avz --delete "$LOCAL_PATH/" "$VPS_HOST:$VPS_PATH/"
    echo "  ✅ 目錄已同步"
  elif [ -f "$LOCAL_PATH" ]; then
    # 單檔 - 使用 scp
    ssh "$VPS_HOST" "mkdir -p $(dirname "$VPS_PATH")"
    scp "$LOCAL_PATH" "$VPS_HOST:$VPS_PATH"
    echo "  ✅ 檔案已同步"
  else
    echo "  ⚠️  本地不存在: $LOCAL_PATH"
  fi
  echo ""
done

echo "🎉 同步完成！"
echo ""
echo "📊 VPS 狀態："
ssh "$VPS_HOST" "cd $VPS_BASE && ls -lh agents/shared/ 2>/dev/null || echo '  ⚠️  agents/shared 尚未建立'"

echo ""
echo "💡 提示："
echo "  - 記得重啟相關服務: ssh $VPS_HOST 'pm2 restart kanban-dashboard'"
echo "  - 檢查 VPS log: ssh $VPS_HOST 'tail -f $VPS_BASE/agents/dashboard/logs/agent.log'"
