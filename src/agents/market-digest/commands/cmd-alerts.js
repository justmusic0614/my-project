/**
 * /alerts [status] — 告警狀態查詢
 * 功能：
 *   /alerts         今日告警事件列表
 *   /alerts status  Pipeline 健康狀態總覽
 *
 * 資料來源：
 *   - pipeline-state/phase*.json 的 errors 欄位
 *   - data/daily-brief/index.json
 *   - cost-ledger 今日成本
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { createLogger } = require('../shared/logger');
const costLedger = require('../shared/cost-ledger');

const logger = createLogger('cmd:alerts');

const STATE_DIR = path.join(__dirname, '../data/pipeline-state');

async function handle(args, config = {}) {
  const subCmd = args[0]?.toLowerCase() || 'alerts';

  if (subCmd === 'status') {
    return _pipelineStatus();
  }

  return _todayAlerts();
}

/**
 * 今日告警事件
 */
function _todayAlerts() {
  const alerts = [];
  const today  = _today();

  // 讀取各 phase 錯誤
  for (const phase of ['phase1', 'phase2', 'phase3', 'phase4']) {
    const file = path.join(STATE_DIR, `${phase}-result.json`);
    if (!fs.existsSync(file)) continue;
    try {
      const data   = JSON.parse(fs.readFileSync(file, 'utf8'));
      const errors = data.errors || {};
      const date   = data.date || data.collectedAt?.slice(0, 10);

      if (date !== today) continue; // 只看今天的

      for (const [src, msg] of Object.entries(errors)) {
        alerts.push({ level: 'ERROR', phase, source: src, message: msg });
      }

      // 驗證警告
      const degraded = data.validationReport?.degradedFields || [];
      if (degraded.length >= 5) {
        alerts.push({ level: 'WARNING', phase, source: 'validator', message: `${degraded.length} 欄位降級` });
      }

      const crossWarns = data.validationReport?.crossCheckWarnings || [];
      if (crossWarns.length > 0) {
        alerts.push({ level: 'WARNING', phase, source: 'cross-check', message: crossWarns[0] });
      }
    } catch {}
  }

  // 成本告警
  const costSummary = costLedger.getDailySummary();
  if (costSummary.totalCost > 0) {
    const budget = costSummary.dailyBudgetUsd || 2;
    const pct    = (costSummary.totalCost / budget) * 100;
    if (pct > 80) {
      alerts.push({ level: pct >= 100 ? 'ERROR' : 'WARNING', phase: 'cost', source: 'budget', message: `今日成本 $${costSummary.totalCost.toFixed(4)}（${pct.toFixed(1)}%）` });
    }
  }

  if (alerts.length === 0) {
    return `✅ 今日 ${today} 無告警事件\n\n所有 Pipeline phase 正常運行`;
  }

  const lines = [`⚠️ 告警事件 ${today}`, ''];
  const errors   = alerts.filter(a => a.level === 'ERROR');
  const warnings = alerts.filter(a => a.level === 'WARNING');

  if (errors.length > 0) {
    lines.push('🔴 錯誤：');
    errors.forEach(a => lines.push(`  [${a.phase}/${a.source}] ${a.message}`));
  }
  if (warnings.length > 0) {
    if (errors.length > 0) lines.push('');
    lines.push('🟡 警告：');
    warnings.forEach(a => lines.push(`  [${a.phase}/${a.source}] ${a.message}`));
  }

  lines.push('', `共 ${alerts.length} 個告警（${errors.length} 錯誤 / ${warnings.length} 警告）`);
  return lines.join('\n');
}

/**
 * Pipeline 健康狀態總覽
 */
function _pipelineStatus() {
  const today = _today();
  const lines = [`📊 Pipeline 狀態 ${today}`, ''];

  const phases = ['phase1', 'phase2', 'phase3', 'phase4'];
  for (const phase of phases) {
    const file = path.join(STATE_DIR, `${phase}-result.json`);
    if (!fs.existsSync(file)) {
      lines.push(`${phase}  ⬜ 未執行`);
      continue;
    }
    try {
      const data    = JSON.parse(fs.readFileSync(file, 'utf8'));
      const date    = data.date || data.collectedAt?.slice(0, 10);
      const isToday = date === today;
      const errors  = Object.keys(data.errors || {});
      const degraded = data.validationReport?.degradedFields?.length || 0;

      let status, icon;
      if (!isToday) {
        icon   = '🕐';
        status = `上次：${date || '未知'}`;
      } else if (errors.length > 0) {
        icon   = '🟡';
        status = `完成（部分失敗：${errors.join(', ')}）`;
      } else {
        icon   = '✅';
        const duration = data.duration != null ? ` ${Math.round(data.duration / 1000)}s` : '';
        status = `完成${duration}${degraded > 0 ? ` | 降級 ${degraded}` : ''}`;
      }
      lines.push(`${phase}  ${icon} ${status}`);
    } catch {
      lines.push(`${phase}  ❌ 讀取失敗`);
    }
  }

  // 成本
  lines.push('');
  const cost = costLedger.getDailySummary();
  if (cost.totalCost != null) {
    const budget = cost.dailyBudgetUsd || 2;
    lines.push(`💰 今日成本：$${cost.totalCost.toFixed(4)} / $${budget} (${((cost.totalCost / budget) * 100).toFixed(1)}%)`);
  }

  return lines.join('\n');
}

function _today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { handle };
