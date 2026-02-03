#!/bin/bash
# Setup Security Patrol Cron Jobs

echo "Setting up security patrol cron jobs..."

# 备份当前 crontab
crontab -l > /tmp/crontab-backup-$(date +%Y%m%d-%H%M%S).txt 2>/dev/null || touch /tmp/crontab-backup-$(date +%Y%m%d-%H%M%S).txt

# 准备新的 cron 条目
PATROL_JOB="0 */2 * * * /home/clawbot/clawd/agents/market-digest/security-patrol.sh >> /home/clawbot/clawd/agents/market-digest/data/security-cron.log 2>&1"
SUMMARY_JOB="0 8 * * * /home/clawbot/clawd/agents/market-digest/morning-summary.sh"

# 检查是否已存在
(crontab -l 2>/dev/null | grep -v "security-patrol.sh" | grep -v "morning-summary.sh"; echo "$PATROL_JOB"; echo "$SUMMARY_JOB") | crontab -

echo "✅ Cron jobs installed:"
echo "  - Security patrol: every 2 hours (including midnight)"
echo "  - Morning summary: 08:00 daily"
echo ""
echo "Backup saved: /tmp/crontab-backup-$(date +%Y%m%d)*.txt"
echo ""
echo "To verify:"
echo "  crontab -l | grep security"

exit 0
