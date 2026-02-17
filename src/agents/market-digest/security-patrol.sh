#!/bin/bash
# @deprecated 2026-02-17
# 此腳本已廢棄。功能由 ~/clawd/agents/security-patrol/patrol-wrapper.sh 覆蓋（更完整）
# 原因：security-patrol agent 監控 8 項系統指標，涵蓋並超越此腳本的代碼掃描功能
# 可於 2026-08-17 後刪除
#
# Security Patrol - 每 2 小时巡逻检查
# 执行时间：每天 06:00, 08:00, 10:00, 12:00, 14:00, 16:00, 18:00, 20:00, 22:00
# （避免深夜打扰：00:00-06:00 不执行）

WORKSPACE="/home/clawbot/clawd/agents/market-digest"
REPORT_FILE="/home/clawbot/clawd/agents/market-digest/data/security-patrol.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# 确保 data 目录存在
mkdir -p "$(dirname "$REPORT_FILE")"

echo "============================================" >> "$REPORT_FILE"
echo "Security Patrol Report - $TIMESTAMP" >> "$REPORT_FILE"
echo "============================================" >> "$REPORT_FILE"

# ============================================================================
# 1. 检查敏感信息泄露
# ============================================================================
echo "" >> "$REPORT_FILE"
echo "[1] Checking for exposed secrets..." >> "$REPORT_FILE"

SECRETS_FOUND=$(grep -r "api.key\|apiKey\|API_KEY\|password\|secret\|token\|Bearer " \
  --include="*.js" --include="*.json" --include="*.yaml" \
  --exclude-dir=node_modules \
  "$WORKSPACE" 2>/dev/null | wc -l)

if [ "$SECRETS_FOUND" -gt 0 ]; then
  echo "⚠️  WARNING: Found $SECRETS_FOUND potential secret leaks" >> "$REPORT_FILE"
  grep -r "api.key\|apiKey\|API_KEY\|password\|secret\|token" \
    --include="*.js" --include="*.json" --include="*.yaml" \
    --exclude-dir=node_modules \
    "$WORKSPACE" 2>/dev/null >> "$REPORT_FILE"
else
  echo "✅ No exposed secrets found" >> "$REPORT_FILE"
fi

# ============================================================================
# 2. 检查文件权限
# ============================================================================
echo "" >> "$REPORT_FILE"
echo "[2] Checking file permissions..." >> "$REPORT_FILE"

WRITABLE_BY_OTHERS=$(find "$WORKSPACE" -type f -perm -002 2>/dev/null | wc -l)

if [ "$WRITABLE_BY_OTHERS" -gt 0 ]; then
  echo "⚠️  WARNING: Found $WRITABLE_BY_OTHERS files writable by others" >> "$REPORT_FILE"
  find "$WORKSPACE" -type f -perm -002 2>/dev/null >> "$REPORT_FILE"
else
  echo "✅ File permissions OK" >> "$REPORT_FILE"
fi

# ============================================================================
# 3. 检查 .gitignore 保护
# ============================================================================
echo "" >> "$REPORT_FILE"
echo "[3] Checking .gitignore protection..." >> "$REPORT_FILE"

if [ ! -f "$WORKSPACE/.gitignore" ]; then
  echo "⚠️  WARNING: No .gitignore found" >> "$REPORT_FILE"
else
  # 检查敏感文件是否被 .gitignore 保护
  PROTECTED_PATTERNS="*.env|*.key|*.pem|secrets/|credentials/"
  if grep -qE "$PROTECTED_PATTERNS" "$WORKSPACE/.gitignore" 2>/dev/null; then
    echo "✅ .gitignore includes secret protection patterns" >> "$REPORT_FILE"
  else
    echo "⚠️  WARNING: .gitignore missing secret protection" >> "$REPORT_FILE"
  fi
fi

# ============================================================================
# 4. 检查未提交的敏感文件
# ============================================================================
echo "" >> "$REPORT_FILE"
echo "[4] Checking for uncommitted sensitive files..." >> "$REPORT_FILE"

cd "$WORKSPACE" || exit
SENSITIVE_FILES=$(find . -type f \( -name "*.env" -o -name "*.key" -o -name "*secret*" -o -name "*token*" \) 2>/dev/null | wc -l)

if [ "$SENSITIVE_FILES" -gt 0 ]; then
  echo "⚠️  Found $SENSITIVE_FILES sensitive files:" >> "$REPORT_FILE"
  find . -type f \( -name "*.env" -o -name "*.key" -o -name "*secret*" -o -name "*token*" \) 2>/dev/null >> "$REPORT_FILE"
else
  echo "✅ No sensitive files found in workspace" >> "$REPORT_FILE"
fi

# ============================================================================
# 5. 检查可疑的代码变更（如果在 git repo 中）
# ============================================================================
echo "" >> "$REPORT_FILE"
echo "[5] Checking for suspicious code changes..." >> "$REPORT_FILE"

cd ~/clawd 2>/dev/null
if [ -d ".git" ]; then
  # 检查最近 2 小时的变更
  RECENT_CHANGES=$(git log --since="2 hours ago" --oneline 2>/dev/null | wc -l)
  
  if [ "$RECENT_CHANGES" -gt 0 ]; then
    echo "ℹ️  Found $RECENT_CHANGES commits in last 2 hours:" >> "$REPORT_FILE"
    git log --since="2 hours ago" --oneline 2>/dev/null >> "$REPORT_FILE"
  else
    echo "✅ No recent commits" >> "$REPORT_FILE"
  fi
  
  # 检查未追踪的文件
  UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l)
  if [ "$UNTRACKED" -gt 5 ]; then
    echo "⚠️  WARNING: $UNTRACKED untracked files (might need review)" >> "$REPORT_FILE"
  fi
else
  echo "ℹ️  Not a git repository" >> "$REPORT_FILE"
fi

# ============================================================================
# 6. 检查日志中的异常
# ============================================================================
echo "" >> "$REPORT_FILE"
echo "[6] Checking for errors in logs..." >> "$REPORT_FILE"

ERROR_COUNT=$(journalctl --user -u clawdbot-gateway --since "2 hours ago" 2>/dev/null | grep -i "error\|exception\|failed" | wc -l)

if [ "$ERROR_COUNT" -gt 10 ]; then
  echo "⚠️  WARNING: Found $ERROR_COUNT errors in logs (last 2h)" >> "$REPORT_FILE"
  journalctl --user -u clawdbot-gateway --since "2 hours ago" 2>/dev/null | grep -i "error\|exception\|failed" | tail -5 >> "$REPORT_FILE"
else
  echo "✅ Log health OK (< 10 errors in 2h)" >> "$REPORT_FILE"
fi

# ============================================================================
# 总结
# ============================================================================
echo "" >> "$REPORT_FILE"
echo "============================================" >> "$REPORT_FILE"
echo "Patrol completed at $(date '+%Y-%m-%d %H:%M:%S')" >> "$REPORT_FILE"
echo "============================================" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# 如果发现严重问题，输出到 stderr（会被 Clawdbot 捕获）
if [ "$SECRETS_FOUND" -gt 0 ] || [ "$WRITABLE_BY_OTHERS" -gt 0 ]; then
  echo "⚠️  Security patrol found issues. Check $REPORT_FILE" >&2
fi

exit 0
