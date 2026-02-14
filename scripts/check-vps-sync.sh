#!/bin/bash
# VPS 同步檢查腳本 - 每日提醒
# 用途：檢查本地 main branch 是否領先 VPS，提醒同步

set -e

LOCAL_REPO="/Users/suweicheng/projects/my-project"
VPS_HOST="clawbot@159.65.136.0"
VPS_REPO="/home/clawbot/clawd"

cd "$LOCAL_REPO"

# 取得本地 HEAD commit
LOCAL_COMMIT=$(git rev-parse HEAD)
LOCAL_COMMIT_SHORT=$(git rev-parse --short HEAD)
LOCAL_COMMIT_MSG=$(git log -1 --pretty=%s)

# 取得 VPS HEAD commit
VPS_COMMIT=$(ssh "$VPS_HOST" "cd $VPS_REPO && git rev-parse HEAD 2>/dev/null || echo 'unknown'")
VPS_COMMIT_SHORT=$(ssh "$VPS_HOST" "cd $VPS_REPO && git rev-parse --short HEAD 2>/dev/null || echo 'unknown'")

echo "📊 Git Sync 狀態檢查"
echo "===================="
echo ""
echo "本地 (macOS): $LOCAL_COMMIT_SHORT - $LOCAL_COMMIT_MSG"
echo "VPS (159.65.136.0): $VPS_COMMIT_SHORT"
echo ""

if [ "$LOCAL_COMMIT" = "$VPS_COMMIT" ]; then
  echo "✅ 本地與 VPS 已同步！"
  exit 0
fi

# 檢查本地是否領先 VPS
COMMITS_AHEAD=$(git rev-list --count $VPS_COMMIT..$LOCAL_COMMIT 2>/dev/null || echo "unknown")

if [ "$COMMITS_AHEAD" != "unknown" ] && [ "$COMMITS_AHEAD" -gt 0 ]; then
  echo "⚠️  本地領先 VPS $COMMITS_AHEAD 個 commit！"
  echo ""
  echo "尚未同步的 commits："
  git log --oneline $VPS_COMMIT..$LOCAL_COMMIT | sed 's/^/  /'
  echo ""
  echo "💡 執行以下指令同步："
  echo "   $LOCAL_REPO/scripts/sync-to-vps.sh"
  echo ""

  # 發送通知（如果有設定 Telegram）
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
      -d "chat_id=$TELEGRAM_CHAT_ID" \
      -d "text=⚠️ VPS 同步提醒：本地領先 $COMMITS_AHEAD 個 commit，請執行同步！" \
      > /dev/null
  fi
else
  echo "⚠️  VPS 的 commit 歷史與本地不同（可能是獨立分支）"
  echo ""
  echo "💡 建議手動檢查並同步："
  echo "   $LOCAL_REPO/scripts/sync-to-vps.sh"
fi
