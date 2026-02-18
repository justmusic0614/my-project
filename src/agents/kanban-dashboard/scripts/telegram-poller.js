#!/usr/bin/env node
// Telegram Long Polling 服務
// 取代 Webhook + Cloudflare Tunnel 架構
// 使用 getUpdates API 主動拉取訊息，不需要公網 URL

const path = require('path');
const fs = require('fs');
const https = require('https');

// 載入環境變數：優先集中式 .env，fallback 本地 .env
const centralEnv = path.join(process.env.HOME || '', 'clawd', '.env');
const localEnv = path.join(__dirname, '../.env');
require('dotenv').config({ path: fs.existsSync(centralEnv) ? centralEnv : localEnv });

const { sendTelegramReply, forwardToOpenClaw } = require('../server/lib/telegram-utils');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('[Poller] TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

let offset = 0;
let retryDelay = 1000; // 指數退避起始值
const MAX_RETRY_DELAY = 30000;
const POLL_TIMEOUT = 30; // getUpdates long polling timeout（秒）

/**
 * 呼叫 Telegram API
 */
function telegramApi(method, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: body ? 'POST' : 'GET',
      timeout: (POLL_TIMEOUT + 10) * 1000, // 比 long polling timeout 多 10 秒
      headers: body ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body, 'utf8')
      } : {}
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.ok) {
            resolve(json.result);
          } else {
            reject(new Error(`Telegram API error: ${json.description}`));
          }
        } catch (e) {
          reject(new Error(`Invalid JSON: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * 處理單條訊息
 */
async function handleUpdate(update) {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  const text = msg.text.trim();

  console.log('[Poller] Received:', { chatId, username, text: text.substring(0, 100) });

  const reply = await forwardToOpenClaw(text);

  if (reply) {
    await sendTelegramReply(chatId, reply);
  } else {
    console.warn('[Poller] OpenClaw returned no reply');
  }
}

/**
 * Long Polling 主迴圈
 */
async function pollLoop() {
  console.log('[Poller] Starting long polling loop...');

  while (true) {
    try {
      const body = JSON.stringify({
        offset,
        timeout: POLL_TIMEOUT,
        allowed_updates: ['message', 'edited_message']
      });

      const updates = await telegramApi('getUpdates', body);

      // 重置退避
      retryDelay = 1000;

      if (updates.length > 0) {
        console.log(`[Poller] Got ${updates.length} update(s)`);

        for (const update of updates) {
          offset = update.update_id + 1;
          try {
            await handleUpdate(update);
          } catch (err) {
            console.error('[Poller] Error handling update:', err.message);
          }
        }
      }
    } catch (err) {
      console.error(`[Poller] Poll error: ${err.message}, retrying in ${retryDelay / 1000}s...`);

      await new Promise(r => setTimeout(r, retryDelay));
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
    }
  }
}

/**
 * 啟動：刪除 Webhook → 開始 Polling
 */
async function start() {
  console.log('[Poller] Telegram Long Polling Service starting...');

  // 確保刪除 Webhook（polling 和 webhook 不能同時使用）
  try {
    await telegramApi('deleteWebhook');
    console.log('[Poller] Webhook deleted (if any)');
  } catch (err) {
    console.error('[Poller] Failed to delete webhook:', err.message);
    // 繼續嘗試 polling
  }

  // 驗證 Bot Token
  try {
    const me = await telegramApi('getMe');
    console.log(`[Poller] Bot: @${me.username} (${me.first_name})`);
  } catch (err) {
    console.error('[Poller] Invalid BOT_TOKEN:', err.message);
    process.exit(1);
  }

  await pollLoop();
}

// 優雅關閉
process.on('SIGINT', () => { console.log('[Poller] Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('[Poller] Shutting down...'); process.exit(0); });

start().catch(err => {
  console.error('[Poller] Fatal error:', err);
  process.exit(1);
});
