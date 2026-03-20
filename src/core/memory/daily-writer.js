/**
 * Daily Writer — time-driven daily log 寫入模組
 *
 * 將 memory 從 alert-driven 改為 time-driven：
 * Phase 4 完成後強制寫入 daily summary，不依賴 alert。
 *
 * 寫入路徑：{repoRoot}/memory/YYYY-MM-DD.md
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB

// ── helper: 找 repo root（與 alert-manager 一致）──────────────────────────

function _findRepoRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return process.env.CLAWD_HOME || '/home/clawbot/clawd';
  }
}

// ── helper: 組 markdown block ─────────────────────────────────────────────

function _buildMarkdownBlock({ dateStr, summary, status, alerts, actions, context }) {
  const now   = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const runId = Date.now();

  const actionsText = (actions && actions.length > 0)
    ? actions.map(a => `  - ${a}`).join('\n')
    : '  - none';

  return [
    `## ${dateStr} ${now.slice(11)} UTC ${context || 'Market Digest'} (run: ${runId})`,
    `- Summary: ${summary || '[no summary available]'}`,
    `- Status: ${status || 'UNKNOWN'}`,
    `- Alerts: ${alerts || 'none'}`,
    '- Actions:',
    actionsText,
    ''
  ].join('\n');
}

// ── 主函式 ────────────────────────────────────────────────────────────────

/**
 * @param {object} payload
 * @param {string} payload.dateStr   - YYYY-MM-DD（必須由呼叫端傳入，禁止自行計算）
 * @param {string} payload.summary   - 一句話摘要
 * @param {string} payload.status    - SUCCESS / FAILED
 * @param {string} payload.alerts    - alert 描述或 'none'
 * @param {string[]} payload.actions - 行動項目
 * @param {string} payload.context   - 來源標識（如 'market-digest phase4'）
 * @param {object} [logger]          - logger 物件（須有 info/error/warn）
 * @returns {{ ok: boolean, filePath?: string, error?: Error }}
 */
function appendDailySummary(payload, logger) {
  const log = logger || console;
  let filePath;

  try {
    const { dateStr } = payload;
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new Error(`invalid dateStr: ${dateStr}`);
    }

    const repoRoot  = _findRepoRoot();
    const memoryDir = path.join(repoRoot, 'memory');
    filePath = path.join(memoryDir, `${dateStr}.md`);

    // 確保目錄存在
    fs.mkdirSync(memoryDir, { recursive: true });

    // 檔案大小監控
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) {
        log.warn?.(`[daily-writer] file too large: ${filePath} (${stat.size} bytes)`);
      }
    }

    // 防空值
    if (!payload.summary) payload.summary = '[no summary available]';
    if (!payload.actions || !payload.actions.length) payload.actions = ['no actions'];

    const block = _buildMarkdownBlock(payload);

    // 換行保護：確保不會黏在前一個 block
    let prefix = '\n';
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.length > 0 && !content.endsWith('\n')) {
        prefix = '\n\n';
      }
    }

    fs.appendFileSync(filePath, prefix + block, 'utf8');

    log.info?.(`[daily-writer] ${dateStr} appended: ${filePath} (${block.length} bytes)`);

    return { ok: true, filePath };

  } catch (err) {
    log.error?.(`[daily-writer] failed: ${filePath || 'unknown'} | ${err.message}`);
    return { ok: false, error: err };
  }
}

module.exports = { appendDailySummary };
