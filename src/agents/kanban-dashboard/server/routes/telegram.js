const express = require('express');
const router = express.Router();
const https = require('https');
const { asyncHandler } = require('../middleware/error-handler');
const dispatcher = require('../../../shared/message-dispatcher');

// Environment variables
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || 'REDACTED_SECRET';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'REDACTED_TOKEN';

/**
 * Send reply message to Telegram via direct API call
 */
function sendTelegramReply(chatId, text) {
  const data = JSON.stringify({
    chat_id: chatId,
    text: text
  });

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data, 'utf8')  // Use Buffer.byteLength for UTF-8
    }
  };

  const req = https.request(options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => {
      responseData += chunk;
    });
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log(`[Telegram] Sent reply to ${chatId}: ${text.substring(0, 50)}...`);
      } else {
        console.error(`[Telegram] Failed to send reply (${res.statusCode}):`, responseData);
      }
    });
  });

  req.on('error', (err) => {
    console.error(`[Telegram] Request error:`, err.message);
  });

  req.write(data);
  req.end();
}

/**
 * POST /api/telegram/webhook
 *
 * Telegram webhook handler
 * Routes messages to appropriate agents via MessageDispatcher
 */
router.post('/webhook', asyncHandler(async (req, res) => {
  // Verify webhook secret (optional but recommended)
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

  // Route through dispatcher (4-layer: prefix → time → keyword → fallback)
  const result = dispatcher.route(text, { chatId, username, timestamp: msg.date });

  if (result.action === 'ask') {
    // Fallback: 回覆選單讓使用者選擇
    sendTelegramReply(chatId, result.message);
  } else if (result.action === 'route') {
    try {
      const reply = await result.handler.handle(result.text, { chatId, username });
      if (reply) {
        const confidence = result.confidence !== 'exact' ? ` [${result.agent.name}]` : '';
        sendTelegramReply(chatId, reply + confidence);
      } else {
        console.warn(`[Telegram] Handler returned empty reply`);
        sendTelegramReply(chatId, '⚠️ 處理完成，但沒有回覆內容');
      }
    } catch (err) {
      console.error(`[Telegram] Handler error (${result.agent.name}):`, err);
      sendTelegramReply(chatId, `❌ 處理失敗：${err.message}`);
    }
  }

  res.json({ ok: true });
}));

module.exports = router;
