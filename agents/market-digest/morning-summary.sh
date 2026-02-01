#!/bin/bash
# Morning Summary - 早上 8:00 汇总深夜巡逻结果
# 只在发现问题时推送通知

REPORT_FILE="/home/clawbot/clawd/agents/market-digest/data/security-patrol.log"
SUMMARY_FILE="/home/clawbot/clawd/agents/market-digest/data/morning-summary.txt"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# 检查今天早上 00:00-08:00 的巡逻记录
TODAY=$(date '+%Y-%m-%d')
MIDNIGHT="${TODAY} 00:00:00"
NOW="${TODAY} 08:00:00"

# 提取今天凌晨到现在的巡逻报告
NIGHT_REPORTS=$(grep -A 50 "Security Patrol Report - ${TODAY}" "$REPORT_FILE" 2>/dev/null | grep -B 5 "WARNING\|⚠️" || echo "")

# 如果有警告，生成摘要
if [ -n "$NIGHT_REPORTS" ]; then
  echo "🌅 晨间资安摘要 - $TIMESTAMP" > "$SUMMARY_FILE"
  echo "" >> "$SUMMARY_FILE"
  echo "深夜巡逻发现以下问题：" >> "$SUMMARY_FILE"
  echo "" >> "$SUMMARY_FILE"
  echo "$NIGHT_REPORTS" >> "$SUMMARY_FILE"
  echo "" >> "$SUMMARY_FILE"
  echo "完整日志：$REPORT_FILE" >> "$SUMMARY_FILE"
  
  # 输出到 stdout（会被 Clawdbot 捕获）
  cat "$SUMMARY_FILE"
else
  echo "✅ 深夜巡逻无异常（$(date '+%Y-%m-%d 00:00-08:00')）"
fi

exit 0
