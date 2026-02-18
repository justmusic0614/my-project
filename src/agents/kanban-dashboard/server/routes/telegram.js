const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error-handler');
const { sendTelegramReply, forwardToOpenClaw } = require('../lib/telegram-utils');
const https = require('https');

// Environment variables（必須在 .env 中設定，不提供預設值）
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

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

  // 直接轉發到 OpenClaw gateway
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
