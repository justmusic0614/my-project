#!/bin/bash
# Deploy & Monitor Telegram Wrapper

set -e

# Export Telegram token for clawdbot CLI（必須在環境中設定）
export TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN is required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION="${1:-help}"
SERVICE="${2}"

case "$ACTION" in
  deploy)
    if [ -z "$SERVICE" ]; then
      echo "用法: $0 deploy <service>"
      exit 1
    fi
    
    echo "🚀 部署 $SERVICE..."
    OUTPUT=$(cd "$SCRIPT_DIR" && node deploy.js deploy "$SERVICE" 2>&1)
    
    if echo "$OUTPUT" | grep -q '"success": true'; then
      echo "✅ $SERVICE 部署完成"
    else
      echo "❌ 部署失败"
      echo "$OUTPUT"
      exit 1
    fi
    ;;
    
  health)
    cd "$SCRIPT_DIR" && bash simple-health.sh
    ;;
    
  logs)
    if [ -z "$SERVICE" ]; then
      echo "用法: $0 logs <service> [--error]"
      exit 1
    fi
    
    ERROR_FLAG=""
    [ "$3" = "--error" ] && ERROR_FLAG="--error"
    
    echo "📝 $SERVICE 最近日志"
    echo ""
    cd "$SCRIPT_DIR" && node deploy.js logs "$SERVICE" --lines=30 $ERROR_FLAG 2>&1 | tail -40
    ;;
    
  rollback)
    if [ -z "$SERVICE" ]; then
      echo "用法: $0 rollback <service>"
      exit 1
    fi
    
    echo "🔄 回滚 $SERVICE..."
    OUTPUT=$(cd "$SCRIPT_DIR" && node deploy.js rollback "$SERVICE" 2>&1)
    
    if echo "$OUTPUT" | grep -q '"success": true'; then
      echo "✅ 回滚完成"
      echo "$OUTPUT" | jq -r '"使用备份: \(.backup)"'
    else
      echo "❌ 回滚失败"
      echo "$OUTPUT"
      exit 1
    fi
    ;;
    
  benchmark)
    if [ -z "$SERVICE" ]; then
      echo "用法: $0 benchmark <service>"
      exit 1
    fi
    
    echo "🔬 运行性能基准测试：$SERVICE"
    echo ""
    cd "$SCRIPT_DIR" && node benchmark.js "$SERVICE" 2>&1 | grep -v "^---"
    ;;
    
  deploy-with-benchmark)
    if [ -z "$SERVICE" ]; then
      echo "用法: $0 deploy-with-benchmark <service>"
      exit 1
    fi
    
    echo "🚀 部署 $SERVICE（含基准测试）..."
    # 部署前基准测试
    echo "📊 部署前基准测试..."
    cd "$SCRIPT_DIR" && node benchmark.js "$SERVICE" 2>&1 | grep -v "^---" | head -20
    
    # 执行部署（暂时跳过，因为没有实际改动）
    echo ""
    echo "✅ 部署模拟完成"
    echo ""
    
    # 部署后基准测试
    echo "📊 部署后基准测试..."
    cd "$SCRIPT_DIR" && node benchmark.js "$SERVICE" 2>&1 | grep -A 20 "性能比较报告"
    ;;
    
  health-push)
    # 推播健康状态到 Telegram
    REPORT=$(cd "$SCRIPT_DIR" && bash simple-health.sh 2>&1)
    
    echo "$REPORT" | clawdbot message send \
      --channel telegram \
      --target "${TELEGRAM_CHAT_ID:?TELEGRAM_CHAT_ID is required}" \
      --message "$(cat)" \
      2>&1
    
    echo "✅ 健康状态已推播"
    ;;
    
  *)
    echo "Deploy & Monitor Telegram Wrapper"
    echo ""
    echo "用法："
    echo "  $0 deploy <service>"
    echo "  $0 health"
    echo "  $0 logs <service> [--error]"
    echo "  $0 rollback <service>"
    echo "  $0 health-push"
    echo ""
    echo "可用服务："
    echo "  - market-digest"
    echo "  - knowledge-digest"
    echo "  - security-patrol"
    echo "  - clawdbot-gateway"
    ;;
esac
