#\!/bin/bash
# 简单健康检查输出

cd "$(dirname "$0")"

# Set PATH for cron environment
export PATH="/home/clawbot/.nvm/versions/node/v22.22.0/bin:$PATH"

# 参数：--only-errors 只显示异常
ONLY_ERRORS=false
if [ "$1" = "--only-errors" ]; then
  ONLY_ERRORS=true
fi

echo "📊 服务健康状态"
echo ""

# 分别检查每个服务
for service in market-digest knowledge-digest security-patrol clawdbot-gateway; do
  RESULT=$(node deploy.js health "$service" 2>/dev/null)
  HEALTHY=$(echo "$RESULT" | jq -r '.healthy')
  TYPE=$(echo "$RESULT" | jq -r '.type')
  
  if [ "$HEALTHY" = "true" ]; then
    ICON="✅"
    STATUS="正常"
  else
    ICON="❌"
    STATUS="异常"
  fi
  
  # 如果只显示异常，跳过正常的服务
  if [ "$ONLY_ERRORS" = "true" ] && [ "$HEALTHY" = "true" ]; then
    continue
  fi
  
  echo "🔧 $service"
  echo "  $ICON $STATUS"
  
  # systemd 服务显示运行时间
  if echo "$RESULT" | jq -e '.checks.systemd' >/dev/null 2>&1; then
    UPTIME=$(echo "$RESULT" | jq -r '.checks.systemd.uptime // "N/A"')
    echo "  运行时间: $UPTIME"
  fi
  
  echo ""
done
