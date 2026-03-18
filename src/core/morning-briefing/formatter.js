'use strict';

const https  = require('https');
const config = require('./config');

/**
 * formatter.js — LLM 潤飾 + template fallback
 *
 * 正常：payload → gpt-4o-mini → 自然語言
 * LLM 失敗：payload → template（純字串拼接）
 * Morning Briefing 絕不因 LLM 不可用而失敗
 */

// ── Template Formatter（純字串，不依賴 LLM）────────────────────────────────

function _statusIcon(status) {
  return status === 'ok' ? '✅' : status === 'degraded' ? '⚠️' : '❌';
}

function _freshnessNote(block) {
  if (block.data_freshness === 'stale') return ` ⏰ 資料已 ${block.age_hours}h 未更新`;
  if (block.data_freshness === 'missing') return ' 📭 無資料';
  return '';
}

function renderTemplate(payload) {
  const now = new Date(payload.generated_at);
  // 台北時間 = UTC+8
  const taipeiHour = String(now.getUTCHours() + 8).padStart(2, '0').slice(-2);
  const taipeiMin  = String(now.getUTCMinutes()).padStart(2, '0');
  const dateStr    = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

  const lines = [];
  lines.push(`📋 Morning Briefing — ${dateStr} ${taipeiHour}:${taipeiMin} (台北)`);
  lines.push('');

  // Market
  const m = payload.market || {};
  lines.push(`${_statusIcon(m.status)} 市場${_freshnessNote(m)}`);
  if (m.summary && m.data_freshness !== 'missing') {
    lines.push(`   ${m.summary}`);
  }
  if (m.status === 'degraded' && m.reason) {
    lines.push(`   原因：${m.reason}`);
  }

  // System
  const s = payload.system || {};
  lines.push(`${_statusIcon(s.status)} 系統健康${_freshnessNote(s)}`);
  if (s.data_freshness !== 'missing') {
    if (s.active_alerts > 0) {
      lines.push(`   ${s.active_alerts} 個活躍告警${s.critical_alerts > 0 ? `（${s.critical_alerts} 個 CRITICAL）` : ''}`);
    } else {
      lines.push('   無告警');
    }
  }

  // Knowledge
  const k = payload.knowledge || {};
  lines.push(`${_statusIcon(k.status)} 知識庫${_freshnessNote(k)}`);
  if (k.data_freshness !== 'missing') {
    const parts = [];
    if (k.total_chunks) parts.push(`${k.total_chunks} 筆知識`);
    if (k.pending_notes > 0) parts.push(`${k.pending_notes} 筆待處理`);
    if (parts.length) lines.push(`   ${parts.join('，')}`);
  }

  // Security
  const sec = payload.security || {};
  lines.push(`${_statusIcon(sec.status)} 安全狀況${_freshnessNote(sec)}`);
  if (sec.data_freshness !== 'missing' && sec.ssh_attempts_24h !== undefined) {
    lines.push(`   24h SSH 嘗試：${sec.ssh_attempts_24h} 次`);
  }

  return lines.join('\n');
}

// ── LLM Formatter ─────────────────────────────────────────────────────────

async function _callLLM(prompt) {
  const apiKey = config.llm.apiKey;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const body = JSON.stringify({
    model: config.llm.model,
    max_tokens: 400,
    messages: [
      {
        role: 'system',
        content: '你是 AI 幕僚，負責將系統狀態 JSON 轉換成繁體中文晨報。回覆格式：先用一行日期時間標題，再用 4 個區塊（市場/系統/知識庫/安全）條列狀態，最後一行整體摘要。繁體中文，適合 Telegram 閱讀，總字數 ≤250 字。',
      },
      {
        role: 'user',
        content: `請根據以下 JSON 產生晨報：\n${JSON.stringify(prompt, null, 2)}`,
      },
    ],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.openai.com',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: config.llm.timeoutMs,
      },
      res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const text = json.choices?.[0]?.message?.content;
            if (!text) reject(new Error(`LLM empty response: ${data.slice(0, 100)}`));
            else resolve(text.trim());
          } catch (e) {
            reject(new Error(`LLM parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('LLM timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * 格式化 payload 為發送文字
 * @param {object} payload - schema 驗證後的 payload
 * @returns {{ text: string, mode: 'llm'|'template_fallback' }}
 */
async function format(payload) {
  try {
    const text = await _callLLM(payload);
    return { text, mode: 'llm' };
  } catch (err) {
    // LLM 失敗 → template fallback，不 throw
    const text = renderTemplate(payload);
    return { text, mode: 'template_fallback', llmError: err.message };
  }
}

module.exports = { format, renderTemplate };
