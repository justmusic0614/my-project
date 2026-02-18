#!/bin/bash
# Security Patrol Wrapper
# 統一入口：資安巡邏 + 每日 SRE 日報（含技術債掃描）
#
# 模式:
#   patrol  - 執行資安巡邏（每 2 小時），發現異常時立即推播 Telegram
#   report  - 生成 SRE 日報（每天 UTC 00:00 = 台北 08:00），整合技術債掃描
#   status  - 查看最新巡邏狀態

set -euo pipefail

# ==================== 環境設定 ====================

# 載入 NVM（cron 環境無 PATH）
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="/usr/local/bin:/usr/bin:/bin:/home/clawbot/.nvm/versions/node/v22.22.0/bin:$PATH"

# 從 ~/clawd/.env 載入環境變數（統一來源，與 market-digest 一致）
ENV_FILE="$HOME/clawd/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=../../.env
  source "$ENV_FILE"
  set +a
else
  echo "ERROR: .env 不存在: $ENV_FILE" >&2
  exit 1
fi

# 驗證必要環境變數
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "ERROR: TELEGRAM_BOT_TOKEN 未在 .env 中設定" >&2
  exit 1
fi

# chat_id 必須在 .env 中設定
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:?TELEGRAM_CHAT_ID 未在 .env 中設定}"

# ==================== 路徑設定 ====================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATROL_JS="$SCRIPT_DIR/patrol.js"
DATA_DIR="$SCRIPT_DIR/data/runtime"
HISTORY_DIR="$SCRIPT_DIR/data/history"
LOG_DIR="$SCRIPT_DIR/logs"
LATEST_JSON="$DATA_DIR/latest.json"
COOLDOWN_FILE="$DATA_DIR/cooldown.json"
COOLDOWN_HOURS="${COOLDOWN_HOURS:-24}"

mkdir -p "$DATA_DIR" "$HISTORY_DIR" "$LOG_DIR"

DATE=$(date +%Y-%m-%d)
TIME=$(date +%H:%M:%S)

# ==================== 工具函數 ====================

log() {
  echo "[$TIME] $*"
}

log_error() {
  echo "[$TIME] ERROR: $*" >&2
}

# 透過 curl 直接推播 Telegram（不依賴 clawdbot 進程，更可靠）
send_telegram() {
  local MESSAGE="$1"

  # 使用 python3 做 JSON 轉義（確保特殊字元正確處理）
  local ESCAPED_MSG
  ESCAPED_MSG=$(python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' <<< "$MESSAGE" 2>/dev/null || \
    echo "\"$(echo "$MESSAGE" | sed 's/"/\\"/g' | tr '\n' '|')\"")

  local RESPONSE
  RESPONSE=$(curl -s -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": \"${TELEGRAM_CHAT_ID}\", \"text\": ${ESCAPED_MSG}}" \
    --max-time 15 2>/dev/null || echo '{"ok":false,"error":"curl failed"}')

  if echo "$RESPONSE" | grep -q '"ok":true'; then
    log "✅ Telegram 推播成功"
    return 0
  else
    log_error "Telegram 推播失敗: $RESPONSE"
    echo "[$DATE $TIME] PUSH_FAILED: $RESPONSE" >> "$LOG_DIR/push.log"
    return 1
  fi
}

# 判斷某類型告警是否應推播（考慮冷卻期）
# CRITICAL 告警永遠推播；MEDIUM/HIGH 在冷卻期內不重複推播
should_send_alert() {
  local ALERT_TYPE="$1"
  local SEVERITY="$2"

  # CRITICAL 永遠推播，不受冷卻限制
  [ "$SEVERITY" = "CRITICAL" ] && return 0

  # 讀取上次推播時間
  local LAST_SENT
  LAST_SENT=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('$COOLDOWN_FILE','utf8'));
      console.log(d['$ALERT_TYPE'] || '');
    } catch(e) { console.log(''); }
  " 2>/dev/null || echo "")

  # 從未推播 → 可推播
  [ -z "$LAST_SENT" ] && return 0

  # 計算距離上次推播的小時數
  local HOURS_SINCE
  HOURS_SINCE=$(node -e "
    const last = new Date('$LAST_SENT');
    if (isNaN(last)) { console.log(999); process.exit(0); }
    console.log(Math.floor((Date.now() - last) / 3600000));
  " 2>/dev/null || echo "999")

  # 超過冷卻期 → 可推播
  [ "${HOURS_SINCE:-999}" -ge "$COOLDOWN_HOURS" ] && return 0

  return 1  # 冷卻中，不推播
}

# 更新冷卻記錄
update_cooldown() {
  local ALERT_TYPE="$1"
  node -e "
    const f = '$COOLDOWN_FILE';
    let d = {};
    try { d = JSON.parse(require('fs').readFileSync(f, 'utf8')); } catch(e) {}
    d['$ALERT_TYPE'] = new Date().toISOString();
    require('fs').writeFileSync(f, JSON.stringify(d, null, 2));
  " 2>/dev/null || true
}

# ==================== 模式：patrol ====================

mode_patrol() {
  log "=== 開始資安巡邏 ==="

  # 執行 Node.js 巡邏腳本
  if ! node "$PATROL_JS" patrol >> "$LOG_DIR/patrol.log" 2>&1; then
    log_error "patrol.js 執行失敗"
    send_telegram "🔴 CRITICAL: security-patrol 巡邏腳本執行失敗（$DATE $TIME）\n請檢查: $LOG_DIR/patrol.log" || true
    return 1
  fi

  # 確認 latest.json 存在
  if [ ! -f "$LATEST_JSON" ]; then
    log_error "latest.json 不存在，巡邏可能失敗"
    return 1
  fi

  # 讀取 alerts 數量（直接從 JSON 解析）
  ALERT_COUNT=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('$LATEST_JSON', 'utf8'));
      console.log(d.alerts ? d.alerts.length : 0);
    } catch(e) { console.log(0); }
  " 2>/dev/null || echo "0")

  if [ "$ALERT_COUNT" -gt 0 ]; then
    # 逐一判斷每個 alert 是否在冷卻期內
    SENDABLE_ALERTS=$(node -e "
      const d = JSON.parse(require('fs').readFileSync('$LATEST_JSON', 'utf8'));
      const alerts = d.alerts || [];
      // 輸出格式: TYPE:SEVERITY，每行一個
      alerts.forEach(a => console.log(a.type + ':' + (a.severity || 'MEDIUM')));
    " 2>/dev/null || echo "")

    ALERTS_TO_SEND=""
    SENT_TYPES=""
    while IFS= read -r ALERT_LINE; do
      [ -z "$ALERT_LINE" ] && continue
      ALERT_TYPE="${ALERT_LINE%%:*}"
      ALERT_SEV="${ALERT_LINE##*:}"
      if should_send_alert "$ALERT_TYPE" "$ALERT_SEV"; then
        ALERTS_TO_SEND="${ALERTS_TO_SEND}${ALERT_LINE}\n"
        SENT_TYPES="${SENT_TYPES}${ALERT_TYPE} "
      fi
    done <<< "$SENDABLE_ALERTS"

    if [ -n "$ALERTS_TO_SEND" ]; then
      # 生成告警訊息（包含套件名稱等詳細資訊）
      ALERT_MSG=$(node -e "
        const d = JSON.parse(require('fs').readFileSync('$LATEST_JSON', 'utf8'));
        const alerts = d.alerts || [];
        const hasCritical = alerts.some(a => a.severity === 'CRITICAL');
        const emoji = hasCritical ? '🔴' : '🟡';
        const lines = [emoji + ' Security Patrol Alert - $DATE $TIME', ''];
        alerts.forEach(a => {
          const e = a.severity === 'CRITICAL' ? '🔴' : a.severity === 'HIGH' ? '🟠' : '🟡';
          lines.push(e + ' ' + a.type.toUpperCase());
          if (a.type === 'updates' && a.data && a.data.security_packages && a.data.security_packages.length > 0) {
            lines.push('  套件: ' + a.data.security_packages.join(', '));
            lines.push('  需 root: sudo apt upgrade ' + a.data.security_packages.join(' '));
          } else if (a.type === 'firewall' && a.data && a.data.open_ports) {
            lines.push('  監聽 port: ' + a.data.open_ports.slice(0,10).join(', '));
          } else {
            const msg = JSON.stringify(a.data || {}).replace(/[\"{}\[\]]/g,'').slice(0,80);
            lines.push('  ' + msg);
          }
        });
        lines.push('');
        lines.push('共 ' + alerts.length + ' 個異常');
        console.log(lines.join('\n'));
      " 2>/dev/null || echo "Security Patrol: $ALERT_COUNT 個異常（$DATE $TIME）")

      send_telegram "$ALERT_MSG" || true
      log "⚠️  告警已推播（$ALERT_COUNT 個異常）"

      # 更新已推播告警的冷卻記錄
      for SENT_TYPE in $SENT_TYPES; do
        update_cooldown "$SENT_TYPE"
      done
    else
      log "✅ 巡邏完成，$ALERT_COUNT 個異常已在冷卻期內（${COOLDOWN_HOURS}h 內不重複推播）"
    fi
  else
    log "✅ 巡邏完成，無異常"
  fi

  # 儲存每日歷史記錄
  [ -f "$LATEST_JSON" ] && cp "$LATEST_JSON" "$HISTORY_DIR/${DATE}.json" 2>/dev/null || true

  log "=== 巡邏結束 ==="
}

# ==================== 模式：report（整合技術債）====================

mode_report() {
  log "=== 生成 SRE 日報（含技術債掃描）==="

  # 1. 先執行最新巡邏取得當前狀態
  log "  [1/3] 執行巡邏..."
  node "$PATROL_JS" patrol >> "$LOG_DIR/patrol.log" 2>&1 || true

  # 2. 讀取巡邏摘要
  PATROL_SUMMARY="（無巡邏資料）"
  if [ -f "$LATEST_JSON" ]; then
    PATROL_SUMMARY=$(node -e "
      try {
        const d = JSON.parse(require('fs').readFileSync('$LATEST_JSON', 'utf8'));
        const alerts = d.alerts || [];
        const checks = Object.keys(d.checks || {});
        const ts = d.timestamp ? new Date(d.timestamp).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}) : 'unknown';
        if (alerts.length === 0) {
          console.log('✅ 系統正常（' + checks.length + ' 項全通過）');
        } else {
          const parts = alerts.map(a => {
            const e = a.severity === 'CRITICAL' ? '🔴' : a.severity === 'HIGH' ? '🟠' : '🟡';
            return e + ' ' + a.type;
          });
          console.log('⚠️ ' + alerts.length + ' 個異常：' + parts.join(' | '));
        }
        // 系統資源摘要
        const c = d.checks || {};
        const stats = [];
        if (c.disk) stats.push('磁碟' + c.disk.usage_percent + '%');
        if (c.cpu) stats.push('CPU ' + c.cpu.usage_percent + '%');
        if (c.memory) stats.push('RAM ' + c.memory.usage_percent + '%');
        if (c.processes) {
          const running = Object.values(c.processes.processes || {}).filter(p => p.running).length;
          const total = Object.keys(c.processes.processes || {}).length;
          stats.push('Process ' + running + '/' + total);
        }
        if (stats.length) console.log(stats.join(' | '));
        console.log('巡邏時間: ' + ts);
      } catch(e) { console.log('解析失敗: ' + e.message); }
    " 2>/dev/null || echo "巡邏結果解析失敗")
  fi

  # 3. 技術債掃描（6 項，內嵌 bash 邏輯）
  log "  [2/3] 技術債掃描..."
  WORKSPACE="$HOME/clawd"
  DEBT_ISSUES=0
  DEBT_LINES=""

  # 項目 1：磁碟使用率 >80%
  DISK_PCT=$(df "$WORKSPACE" 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}' || echo "0")
  if [ "${DISK_PCT:-0}" -gt 80 ]; then
    DEBT_LINES="${DEBT_LINES}⚠️ 磁碟使用率 ${DISK_PCT}%（>80%）\n"
    DEBT_ISSUES=$((DEBT_ISSUES + 1))
  else
    DEBT_LINES="${DEBT_LINES}✅ 磁碟 ${DISK_PCT}%\n"
  fi

  # 項目 2：.bak 備份檔 >5 個（排除 backups/ 歸檔目錄，避免誤計）
  BAK_COUNT=$(find "$WORKSPACE" -maxdepth 4 \( -name "*.bak" -o -name "*.BAK" -o -name "*.backup" \) \
    -not -path "*/node_modules/*" \
    -not -path "*/backups/*" \
    2>/dev/null | wc -l | tr -d ' ')
  if [ "${BAK_COUNT:-0}" -gt 5 ]; then
    DEBT_LINES="${DEBT_LINES}⚠️ 備份檔累積 ${BAK_COUNT} 個（>5）\n"
    DEBT_ISSUES=$((DEBT_ISSUES + 1))
  else
    DEBT_LINES="${DEBT_LINES}✅ 備份檔 ${BAK_COUNT} 個\n"
  fi

  # 項目 3：大型日誌 >50MB
  LARGE_LOG_COUNT=$(find "$WORKSPACE/agents" "$HOME/.openclaw/logs" -maxdepth 4 \
    \( -name "*.log" -o -name "*.jsonl" \) -size +50M \
    -not -path "*/node_modules/*" 2>/dev/null | wc -l | tr -d ' ')
  if [ "${LARGE_LOG_COUNT:-0}" -gt 0 ]; then
    DEBT_LINES="${DEBT_LINES}⚠️ 大型日誌 (>50MB) ${LARGE_LOG_COUNT} 個\n"
    DEBT_ISSUES=$((DEBT_ISSUES + 1))
  else
    DEBT_LINES="${DEBT_LINES}✅ 無大型日誌 (>50MB)\n"
  fi

  # 項目 4：SQLite 臨時檔
  SQLITE_TMP=$(find "$HOME/.openclaw" -maxdepth 3 \
    \( -name "*.sqlite-wal" -o -name "*.sqlite-shm" -o -name "*.sqlite.tmp-*" \) \
    2>/dev/null | wc -l | tr -d ' ')
  if [ "${SQLITE_TMP:-0}" -gt 3 ]; then
    DEBT_LINES="${DEBT_LINES}⚠️ SQLite 臨時檔 ${SQLITE_TMP} 個（>3）\n"
    DEBT_ISSUES=$((DEBT_ISSUES + 1))
  else
    DEBT_LINES="${DEBT_LINES}✅ SQLite 臨時檔 ${SQLITE_TMP} 個\n"
  fi

  # 項目 5：重複代碼檔案命名
  DUP_COUNT=$(find "$WORKSPACE/agents" -maxdepth 4 \
    \( -name "*_v2.*" -o -name "*_new.*" -o -name "enhanced_*" -o -name "improved_*" \) \
    -not -path "*/node_modules/*" 2>/dev/null | wc -l | tr -d ' ')
  if [ "${DUP_COUNT:-0}" -gt 0 ]; then
    DEBT_LINES="${DEBT_LINES}⚠️ 重複/廢棄命名檔案 ${DUP_COUNT} 個\n"
    DEBT_ISSUES=$((DEBT_ISSUES + 1))
  else
    DEBT_LINES="${DEBT_LINES}✅ 無重複命名檔案\n"
  fi

  # 項目 6：大型非 node_modules 檔案 >10MB
  BIG_FILE_COUNT=$(find "$WORKSPACE/agents" -maxdepth 5 -type f -size +10M \
    -not -path "*/node_modules/*" -not -path "*/data/*" \
    2>/dev/null | wc -l | tr -d ' ')
  if [ "${BIG_FILE_COUNT:-0}" -gt 3 ]; then
    DEBT_LINES="${DEBT_LINES}⚠️ 大型代碼檔 (>10MB) ${BIG_FILE_COUNT} 個\n"
    DEBT_ISSUES=$((DEBT_ISSUES + 1))
  else
    DEBT_LINES="${DEBT_LINES}✅ 大型代碼檔 ${BIG_FILE_COUNT} 個\n"
  fi

  # 項目 7：過期 phase-cleanup 備份目錄 >7 天（佔磁碟空間）
  PHASE_CLEANUP_COUNT=$(find "$WORKSPACE/backups" -maxdepth 1 -type d -name "phase*-cleanup-*" \
    -mtime +7 2>/dev/null | wc -l | tr -d ' ')
  if [ "${PHASE_CLEANUP_COUNT:-0}" -gt 0 ]; then
    DEBT_LINES="${DEBT_LINES}⚠️ 過期 cleanup 備份 ${PHASE_CLEANUP_COUNT} 個（>7天，建議清理）\n"
    DEBT_ISSUES=$((DEBT_ISSUES + 1))
  else
    DEBT_LINES="${DEBT_LINES}✅ 無過期 cleanup 備份\n"
  fi

  # 4. 組合完整日報並推播
  log "  [3/3] 推播日報..."
  DEBT_STATUS_ICON="✅"
  [ "$DEBT_ISSUES" -gt 0 ] && DEBT_STATUS_ICON="⚠️"

  FULL_REPORT="🛡️ SRE 日報 — $DATE

【資安巡邏】
$PATROL_SUMMARY

【技術債掃描】 $DEBT_STATUS_ICON ($DEBT_ISSUES/7 項異常)
$(echo -e "$DEBT_LINES" | head -14)
━━━━━━━━━━━━━━━━━━
⚠️ 免責聲明：本報告僅供運維參考
📡 Security Patrol + Tech Debt Monitor"

  send_telegram "$FULL_REPORT" && echo "$FULL_REPORT" >> "$LOG_DIR/daily-report.log" || true

  log "=== SRE 日報完成 ==="
}

# ==================== 模式：status ====================

mode_status() {
  echo "=== Security Patrol 最新狀態 ==="
  if [ -f "$LATEST_JSON" ]; then
    node "$PATROL_JS" status 2>/dev/null || cat "$LATEST_JSON"
  else
    echo "尚未執行巡邏（$LATEST_JSON 不存在）"
  fi
}

# ==================== 主入口 ====================

MODE="${1:-patrol}"

case "$MODE" in
  patrol)
    mode_patrol 2>&1 | tee -a "$LOG_DIR/patrol.log"
    ;;
  report)
    mode_report 2>&1 | tee -a "$LOG_DIR/daily-report.log"
    ;;
  status)
    mode_status
    ;;
  -h|--help)
    echo "用法: $0 {patrol|report|status}"
    echo "  patrol  - 執行資安巡邏（每 2 小時），有異常才推播"
    echo "  report  - 生成 SRE 日報 + 技術債掃描（每天 UTC 00:00）"
    echo "  status  - 查看最新巡邏狀態"
    ;;
  *)
    echo "未知模式: $MODE。用法: $0 {patrol|report|status}" >&2
    exit 1
    ;;
esac
