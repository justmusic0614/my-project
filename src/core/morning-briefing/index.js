#!/usr/bin/env node
'use strict';

/**
 * Morning Briefing — 每日站立報告主入口
 *
 * 流程：
 *   1. collectors.collect() → normalized payload
 *   2. schema.validate()    → 驗證 + 修補
 *   3. formatter.format()   → LLM 潤飾（失敗自動 template fallback）
 *   4. Telegram 推播
 *   5. 寫入 delivery log
 *
 * 降級策略：
 *   - collector 失敗 → 該區塊 status=error，其他正常
 *   - schema fail    → 修補為 error 狀態，不阻斷
 *   - LLM 失敗      → template fallback
 *   - Telegram 失敗 → 寫 delivery log，不 retry
 */

require('dotenv').config();

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const config  = require('./config');
const { collect }  = require('./collectors');
const { validate } = require('./schema');
const { format, renderTemplate } = require('./formatter');

// ── Telegram 發送 ────────────────────────────────────────────────────────────

async function _sendTelegram(text) {
  const { botToken, chatId } = config.telegram;
  if (!botToken || !chatId) {
    return { ok: false, reason: 'telegram not configured' };
  }

  const body = JSON.stringify({ chat_id: chatId, text });

  return new Promise(resolve => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${botToken}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 15000,
      },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.ok ? { ok: true } : { ok: false, reason: json.description });
          } catch (e) {
            resolve({ ok: false, reason: `parse error: ${e.message}` });
          }
        });
      }
    );
    req.on('error', e => resolve({ ok: false, reason: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

// ── Delivery Log ─────────────────────────────────────────────────────────────

function _writeDeliveryLog(entry) {
  try {
    const logPath = config.paths.deliveryLog;
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // log 失敗不中斷主流程
  }
}

function _summarizePayload(payload) {
  const blocks = ['market', 'system', 'knowledge', 'security'];
  return blocks.map(k => `${k}=${payload[k]?.status || '?'}`).join(' ');
}

// ── 主流程 ───────────────────────────────────────────────────────────────────

async function run() {
  const startTime = Date.now();

  // Step 1: collect
  let raw;
  try {
    raw = collect();
  } catch (err) {
    const msg = `Morning Briefing 站立報告產生失敗，請手動檢查\n原因：${err.message}`;
    const result = await _sendTelegram(msg);
    _writeDeliveryLog({
      ts: new Date().toISOString(),
      message_type: 'morning_brief',
      status: 'failure',
      mode: 'minimal_failure_notice',
      chat_id: config.telegram.chatId,
      error: err.message,
    });
    return { status: 'failure', error: err.message, telegram: result };
  }

  // Step 2: schema validate
  const { valid, payload, errors: schemaErrors } = validate(raw);

  if (!valid) {
    const msg = `⚠️ 站立報告 schema 驗證失敗，請檢查 collectors\n${schemaErrors.join('\n')}`;
    const result = await _sendTelegram(msg);
    _writeDeliveryLog({
      ts: new Date().toISOString(),
      message_type: 'morning_brief',
      status: 'failure',
      mode: 'minimal_failure_notice',
      chat_id: config.telegram.chatId,
      error: `schema invalid: ${schemaErrors.join('; ')}`,
    });
    return { status: 'failure', error: 'schema invalid', telegram: result };
  }

  // Step 3: format（LLM or template fallback）
  const { text, mode, llmError } = await format(payload);

  // Step 4: Telegram 推播
  const telegramResult = await _sendTelegram(text);

  // Step 5: delivery log
  const logEntry = {
    ts:           new Date().toISOString(),
    message_type: 'morning_brief',
    status:       telegramResult.ok ? 'success' : 'failure',
    mode,
    chat_id:      config.telegram.chatId,
    summary:      _summarizePayload(payload),
    duration_ms:  Date.now() - startTime,
    ...(schemaErrors.length > 0 ? { schema_warnings: schemaErrors } : {}),
    ...(llmError ? { llm_error: llmError } : {}),
    ...(!telegramResult.ok ? { error: telegramResult.reason } : {}),
  };
  _writeDeliveryLog(logEntry);

  return {
    status:  telegramResult.ok ? 'ok' : 'telegram_failed',
    mode,
    summary: _summarizePayload(payload),
    telegram: telegramResult,
    schema_warnings: schemaErrors,
  };
}

// ── CLI 入口 ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  run()
    .then(result => {
      console.log('[morning-briefing] done:', JSON.stringify(result));
      process.exit(result.status === 'ok' ? 0 : 1);
    })
    .catch(err => {
      console.error('[morning-briefing] fatal:', err.message);
      process.exit(1);
    });
}

module.exports = { run };
