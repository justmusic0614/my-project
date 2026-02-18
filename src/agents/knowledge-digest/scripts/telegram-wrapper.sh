#!/bin/bash
# Knowledge Digest Telegram Wrapper v2
# 指令：add-note, query, stats, weekly, weekly-push,
#        daily-review, daily-review-push, inbox, mark-read, archive, semantic-search

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION="${1:-help}"
TARGET_USER="${TELEGRAM_CHAT_ID:?TELEGRAM_CHAT_ID is required}"

case "$ACTION" in
  add-note)
    NOTE_CONTENT="$2"
    TAGS="${3:-台股,筆記}"
    TITLE="${4:-投資筆記}"
    OUTPUT=$(cd "$SCRIPT_DIR" && node digest.js add-note "$NOTE_CONTENT" --tags="$TAGS" --title="$TITLE" 2>&1)
    echo "$OUTPUT"
    ;;

  query)
    KEYWORD="${2}"
    DAYS="${3:-30}"
    OUTPUT=$(cd "$SCRIPT_DIR" && node digest.js query --keyword="$KEYWORD" --days="$DAYS" 2>&1)
    echo "$OUTPUT"
    ;;

  stats)
    OUTPUT=$(cd "$SCRIPT_DIR" && node digest.js stats 2>&1)
    echo "$OUTPUT"
    ;;

  weekly)
    OUTPUT=$(cd "$SCRIPT_DIR" && node digest.js weekly 2>&1)
    echo "$OUTPUT"
    ;;

  weekly-push)
    REPORT=$(cd "$SCRIPT_DIR" && node digest.js weekly 2>&1)
    clawdbot message send \
      --channel telegram \
      --target "$TARGET_USER" \
      --message "$REPORT" \
      2>&1
    echo "✅ 週報推播完成"
    ;;

  # P1: 每日複習
  daily-review)
    OUTPUT=$(cd "$SCRIPT_DIR" && node digest.js daily-review 2>&1)
    echo "$OUTPUT"
    ;;

  daily-review-push)
    REVIEW=$(cd "$SCRIPT_DIR" && node digest.js daily-review 2>&1)
    clawdbot message send \
      --channel telegram \
      --target "$TARGET_USER" \
      --message "$REVIEW" \
      2>&1
    echo "✅ 每日複習推播完成"
    ;;

  # P4: Inbox 管理
  inbox)
    OUTPUT=$(cd "$SCRIPT_DIR" && node digest.js inbox 2>&1)
    echo "$OUTPUT"
    ;;

  mark-read)
    ID="${2}"
    OUTPUT=$(cd "$SCRIPT_DIR" && node digest.js mark-read "$ID" 2>&1)
    echo "$OUTPUT"
    ;;

  archive)
    ID="${2}"
    OUTPUT=$(cd "$SCRIPT_DIR" && node digest.js archive "$ID" 2>&1)
    echo "$OUTPUT"
    ;;

  # P5: 語意搜尋
  semantic-search)
    QUESTION="${2}"
    OUTPUT=$(cd "$SCRIPT_DIR" && node digest.js semantic-search "$QUESTION" 2>&1)
    echo "$OUTPUT"
    ;;

  *)
    cat <<EOF
Knowledge Digest Telegram Wrapper v2

用法：
  $0 add-note "<內容>" "<標籤>" "<標題>"
  $0 query "<關鍵字>" [天數]
  $0 stats
  $0 weekly
  $0 weekly-push
  $0 daily-review              每日複習（直接輸出）
  $0 daily-review-push         每日複習推播 Telegram
  $0 inbox                     顯示收件匣
  $0 mark-read <id>            標記已讀
  $0 archive <id>              封存筆記
  $0 semantic-search "<問題>"  語意搜尋
EOF
    ;;
esac
