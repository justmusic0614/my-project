const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error-handler');
const { sendTelegramReply, forwardToOpenClaw, executeBrainDistill } = require('../lib/telegram-utils');
const https = require('https');

// Environment variables（必須在 .env 中設定，不提供預設值）
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const ALLOWED_CHAT_ID = parseInt(process.env.TELEGRAM_CHAT_ID, 10);

// ── /brain 並發控制 + rate limit ────────────────────────────────────────────
let _activeJobs = 0;
const MAX_BRAIN_JOBS = 1;
const _lastBrainCall = {};
const BRAIN_COOLDOWN_MS = 60000;

/**
 * POST /api/telegram/webhook
 *
 * Telegram webhook handler
 * Forwards all messages directly to OpenClaw gateway
 */
router.post('/webhook', asyncHandler(async (req, res) => {
  // Verify webhook secret
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (secret && secret !== WEBHOOK_SECRET) {
    console.warn('[Telegram] Invalid webhook secret');
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { message, edited_message } = req.body;
  const msg = message || edited_message;

  if (!msg || !msg.text) {
    return res.json({ ok: true });
  }

  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  const text = msg.text.trim();

  console.log('[Telegram Webhook]', {
    chatId,
    username,
    text: text.substring(0, 100)
  });

  // ── /brain 指令攔截 ─────────────────────────────────────
  if (text.startsWith('/brain ') || text === '/brain') {
    // 白名單驗證
    if (chatId !== ALLOWED_CHAT_ID) {
      return res.json({ ok: true }); // 靜默忽略
    }

    const payload = text.slice(7).trim();
    if (!payload) {
      sendTelegramReply(chatId, '請提供文字或 URL\n用法：/brain <文字或URL>');
      return res.json({ ok: true });
    }

    // 並發控制（MAX_JOBS = 1，防 OOM）
    if (_activeJobs >= MAX_BRAIN_JOBS) {
      sendTelegramReply(chatId, '系統忙碌中，請稍後再試');
      return res.json({ ok: true });
    }

    // rate limit（60 秒冷卻，防手滑連發）
    const now = Date.now();
    if (_lastBrainCall[chatId] && now - _lastBrainCall[chatId] < BRAIN_COOLDOWN_MS) {
      sendTelegramReply(chatId, '冷卻中，請稍後再試');
      return res.json({ ok: true });
    }
    _lastBrainCall[chatId] = now;

    // jobId 貫穿整個 flow
    const jobId = `brain-${now}`;

    // 立即回覆確認 + 先回應 webhook
    sendTelegramReply(chatId, `收到，蒸餾中...（ID: ${jobId}）`);
    res.json({ ok: true });

    // 非同步蒸餾（不阻塞 webhook）
    _activeJobs++;
    executeBrainDistill(payload, jobId)
      .then(result => {
        if (result.ok) {
          sendTelegramReply(chatId, `✅ 蒸餾完成（ID: ${jobId}）\n\n${result.summary}`);
        } else {
          sendTelegramReply(chatId, `❌ 蒸餾失敗（ID: ${jobId}）：${result.error}`);
        }
      })
      .catch(err => {
        sendTelegramReply(chatId, `❌ 蒸餾異常（ID: ${jobId}）：${err.message}`);
      })
      .finally(() => { _activeJobs--; });

    return; // 不走 OpenClaw
  }

  // ── 原有邏輯：轉發到 OpenClaw gateway ────────────────────
  const reply = await forwardToOpenClaw(text);

  if (reply) {
    sendTelegramReply(chatId, reply);
  } else {
    console.warn('[Telegram] OpenClaw returned no reply');
  }

  res.json({ ok: true });
}));

/**
 * GET /api/telegram/health
 *
 * Health check endpoint for monitoring
 * 直接呼叫 Telegram getMe API（輕量級，< 1 秒）
 */
router.get('/health', asyncHandler(async (req, res) => {
  const timeoutMs = 8000;
  const maxRetries = 2;
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  function attemptGetMe(retryCount) {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/getMe`,
        method: 'GET',
        timeout: timeoutMs
      }, (response) => {
        let data = '';
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.ok) {
              resolve({ botName: json.result.username });
            } else {
              reject(new Error(`Telegram API error: ${json.description}`));
            }
          } catch (e) {
            reject(new Error('Invalid JSON response from Telegram'));
          }
        });
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.on('error', reject);
      req.end();
    });
  }

  async function checkTelegramApi() {
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await attemptGetMe(i);
      } catch (err) {
        if (i === maxRetries) throw err;
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, i)));
      }
    }
  }

  try {
    const result = await checkTelegramApi();
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      checks: {
        telegram_api: 'ok',
        botName: result.botName
      }
    });
  } catch (err) {
    console.warn('[Telegram Health] API check failed:', err.message);
    res.status(200).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        telegram_api: 'error',
        telegramError: err.message
      }
    });
  }
}));

module.exports = router;
