#!/bin/bash
# Security Patrol Wrapper for Clawdbot Integration

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODE="${1:-patrol}"

case "$MODE" in
  patrol)
    # 執行巡邏
    node patrol.js patrol
    
    # 檢查是否有異常需要推播
    if [ -f data/runtime/latest.json ]; then
      ALERTS=$(jq '.alerts | length' data/runtime/latest.json)
      if [ "$ALERTS" -gt 0 ]; then
        # 生成警報報告
        REPORT=$(node patrol.js report 2>&1)
        echo "發現 $ALERTS 個異常，推播中..."
        
        # 推播到 Telegram
        clawdbot message send \
          --channel telegram \
          --target 1377531222 \
          --message "$REPORT" \
          2>&1 | tee -a logs/push.log
          
        echo "✅ 推播完成"
      fi
    fi
    ;;
    
  report)
    # 生成日報並推播
    REPORT=$(node patrol.js report 2>&1)
    echo "$REPORT"
    
    # 推播到 Telegram
    clawdbot message send \
      --channel telegram \
      --target 1377531222 \
      --message "$REPORT" \
      2>&1 | tee -a logs/push.log
      
    echo "✅ 日報推播完成"
    ;;
    
  status)
    # 查看狀態
    node patrol.js status
    ;;
    
  *)
    echo "用法: $0 {patrol|report|status}"
    exit 1
    ;;
esac
