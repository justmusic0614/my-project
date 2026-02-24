#!/bin/bash
# Optimization Advisor 每日汇总报告

set -e

# 设置 PATH（确保可以找到 clawdbot）
export PATH="/home/clawbot/.nvm/versions/node/v22.22.0/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/../data"

echo "📊 每日优化建议汇总"
echo "📅 $(date '+%Y-%m-%d')"
echo ""

# 读取今日所有建议
if [ -f "$DATA_DIR/suggestions.jsonl" ]; then
  TODAY=$(date '+%Y-%m-%d')
  TODAY_SUGGESTIONS=$(grep "$TODAY" "$DATA_DIR/suggestions.jsonl" 2>/dev/null || echo "")
  
  if [ -n "$TODAY_SUGGESTIONS" ]; then
    COUNT=$(echo "$TODAY_SUGGESTIONS" | wc -l)
    echo "今日共收集 $COUNT 条建议"
    echo ""
    
    # 按优先级分类统计
    HIGH=$(echo "$TODAY_SUGGESTIONS" | grep -c '"priority":"high"' || echo "0")
    MEDIUM=$(echo "$TODAY_SUGGESTIONS" | grep -c '"priority":"medium"' || echo "0")
    LOW=$(echo "$TODAY_SUGGESTIONS" | grep -c '"priority":"low"' || echo "0")
    
    echo "优先级分布："
    [ "$HIGH" != "0" ] && echo "  🔴 高优先级：$HIGH"
    [ "$MEDIUM" != "0" ] && echo "  🟡 中优先级：$MEDIUM"
    [ "$LOW" != "0" ] && echo "  🟢 低优先级：$LOW"
    echo ""
    
    # 列出高优先级建议
    if [ "$HIGH" != "0" ]; then
      echo "🔴 高优先级建议："
      echo "$TODAY_SUGGESTIONS" | jq -r 'select(.priority=="high") | "  - \(.title)\n    \(.suggestion)"' 2>/dev/null || echo "  (解析失败)"
      echo ""
    fi
    
    # LLM 深度分析（如启用）
    ENABLE_LLM=$(jq -r '.llm.daily_analysis' "$SCRIPT_DIR/config.json" 2>/dev/null || echo "false")
    if [ "$ENABLE_LLM" = "true" ]; then
      echo "🤖 LLM 深度分析"
      echo "  (功能开发中...)"
      echo ""
    fi
  else
    echo "✅ 今日系统运行良好，无建议"
  fi
else
  echo "📭 尚无建议记录"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━"
echo "查看完整建议：~/clawd/agents/optimization-advisor/data/suggestions.jsonl"
