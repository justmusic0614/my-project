#!/bin/bash
# 格式化健康检查输出

cd "$(dirname "$0")"

echo "📊 服务健康状态"
echo ""

node deploy.js health 2>&1 | jq -r '
to_entries[] | 
"🔧 " + .key + "\n" +
(if .value.healthy then "  ✅ 正常" else "  ❌ 异常" end) +
(if .value.checks.systemd then 
  "\n  状态: " + .value.checks.systemd.status
else "" end) +
"\n"
'
