#!/usr/bin/env node
// Telegram Long Polling 服務
// 取代 Webhook + Cloudflare Tunnel 架構
// 使用 getUpdates API 主動拉取訊息，不需要公網 URL

const path = require('path');
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

// 載入環境變數：優先集中式 .env，fallback 本地 .env
const centralEnv = path.join(process.env.HOME || '', 'clawd', '.env');
const localEnv = path.join(__dirname, '../.env');
require('dotenv').config({ path: fs.existsSync(centralEnv) ? centralEnv : localEnv });

const { sendTelegramReply, forwardToOpenClaw } = require('../server/lib/telegram-utils');

// ── Market Digest 指令對應表 ─────────────────────────────
// ⚠️ 維護提醒：新增 agent 或指令時，須同步更新此表
// 相關檔案：market-digest/commands/command-router.js、AGENTS.md
const MARKET_DIGEST_DIR = path.join(process.env.HOME || '', 'clawd/agents/market-digest');
const NODE_BIN = process.execPath; // 動態取得當前 Node.js 路徑

const COMMAND_ROUTES = {
  '/today':     { cmd: 'today',         directReply: false, replyText: '✅ 日報已推播到 Telegram' },
  '/financial': { cmd: 'cmd financial', directReply: true },
  '/f':         { cmd: 'cmd financial', directReply: true },
  '/weekly':    { cmd: 'cmd weekly',    directReply: true },
  '/alerts':    { cmd: 'cmd alerts',    directReply: true },
  '/突發':      { cmd: 'cmd news',      directReply: true },
};

// 帶參數的指令（prefix match）
const COMMAND_PREFIX_ROUTES = [
  { prefix: '/watchlist', alias: '/w',  cmd: 'cmd watchlist' },
  { prefix: '/analyze',   alias: '/a',  cmd: 'cmd analyze' },
  { prefix: '/news',      alias: '/n',  cmd: 'cmd news' },
  { prefix: '/query',     alias: null,  cmd: 'cmd query' },
];

const MAX_MSG_LEN = 4000;

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
  const text = msg.text.trim();

  console.log('[Poller] Received:', { chatId, text: text.substring(0, 100) });

  // ── 確定性前置路由（環境變數開關：COMMAND_ROUTING=openclaw 可停用）────
  if (process.env.COMMAND_ROUTING !== 'openclaw') {
    const routed = await tryDirectRoute(chatId, text);
    if (routed) return;
  }

  // ── Fallback：未匹配的訊息走 OpenClaw LLM ───────────────
  const reply = await forwardToOpenClaw(text);
  if (reply) {
    await sendTelegramReply(chatId, reply);
  } else {
    console.warn('[Poller] OpenClaw returned no reply');
  }
}

/**
 * 嘗試確定性前置路由
 * @returns {Promise<boolean>} 是否成功路由
 */
async function tryDirectRoute(chatId, text) {
  const lower = text.toLowerCase();

  // 1. 精確匹配（無參數指令）
  const exactRoute = COMMAND_ROUTES[lower] || COMMAND_ROUTES[text];
  if (exactRoute) {
    return await executeRoute(chatId, exactRoute.cmd, '', exactRoute);
  }

  // 2. Prefix 匹配（帶參數指令）
  for (const route of COMMAND_PREFIX_ROUTES) {
    const matchPrefix = lower.startsWith(route.prefix + ' ') || lower === route.prefix;
    const matchAlias = route.alias && (lower.startsWith(route.alias + ' ') || lower === route.alias);
    if (matchPrefix || matchAlias) {
      const prefix = matchPrefix ? route.prefix : route.alias;
      const args = text.substring(prefix.length).trim();
      return await executeRoute(chatId, route.cmd, args, { directReply: true });
    }
  }

  return false; // 未匹配
}

/**
 * 執行前置路由指令
 */
async function executeRoute(chatId, cmd, args, options = {}) {
  const fullCmd = args ? `${cmd} ${args}` : cmd;
  const command = `${NODE_BIN} index.js ${fullCmd}`;

  console.log(`[Poller:Route] Executing: ${command}`);

  try {
    const output = execSync(command, {
      cwd: MARKET_DIGEST_DIR,
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${path.dirname(NODE_BIN)}:${process.env.PATH}` }
    });

    if (options.directReply === false) {
      // /today 腳本自己推播，只回覆確認訊息
      await sendTelegramReply(chatId, options.replyText || '✅ 完成');
    } else {
      // 其他指令：將 stdout 轉發給用戶（過濾 log 行）
      const reply = output.trim().replace(/^(ℹ️|⚠️).*\n/gm, '').trim();
      if (reply) {
        await sendLongReply(chatId, reply);
      } else {
        await sendTelegramReply(chatId, '⚠️ 指令執行完成但無輸出');
      }
    }

    return true;
  } catch (err) {
    console.error(`[Poller:Route] Failed: ${err.message}`);
    // Fallback：前置路由失敗時，改走 OpenClaw
    console.log('[Poller:Route] Falling back to OpenClaw...');
    const reply = await forwardToOpenClaw(`${cmd} ${args}`.trim());
    if (reply) {
      await sendTelegramReply(chatId, reply);
    } else {
      await sendTelegramReply(chatId, `❌ 指令執行失敗：${err.message.substring(0, 100)}`);
    }
    return true;
  }
}

/**
 * 長訊息分段發送（Telegram 單條限制 4096 字元）
 */
async function sendLongReply(chatId, text) {
  if (text.length <= MAX_MSG_LEN) {
    return sendTelegramReply(chatId, text);
  }

  const parts = [];
  let current = '';
  for (const line of text.split('\n')) {
    if ((current + '\n' + line).length > MAX_MSG_LEN) {
      parts.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) parts.push(current);

  for (const part of parts) {
    await sendTelegramReply(chatId, part);
    if (parts.length > 1) await new Promise(r => setTimeout(r, 1000));
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
