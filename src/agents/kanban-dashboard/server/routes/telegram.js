const express = require('express');
const router = express.Router();
const https = require('https');
const { execSync } = require('child_process');
const { asyncHandler } = require('../middleware/error-handler');

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
      'Content-Length': Buffer.byteLength(data, 'utf8')
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
 * Forward message to OpenClaw gateway for processing
 */
async function forwardToOpenClaw(text) {
  try {
    // Escape text for shell (防止 shell injection)
    const escapedText = text.replace(/'/g, "'\\''");

    const nvmBinDir = '/home/clawbot/.nvm/versions/node/v22.22.0/bin';
    const openclawPath = `${nvmBinDir}/openclaw`;

    const command = `${openclawPath} agent --agent main --channel telegram ` +
      `--message '${escapedText}' --json --timeout 30`;

    // 將 nvm 的 node 路徑加入 PATH
    const env = { ...process.env, PATH: `${nvmBinDir}:${process.env.PATH || ''}` };

    const output = execSync(command, {
      encoding: 'utf8',
      timeout: 35000,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: '/bin/bash',
      env
    });

    // 解析 JSON 輸出
    const result = JSON.parse(output);

    // Gateway 回傳格式：result.payloads[].text
    if (result && result.result && result.result.payloads) {
      const texts = result.result.payloads
        .map(p => p.text)
        .filter(Boolean);
      if (texts.length > 0) {
        return texts.join('\n\n');
      }
    }

    return null;
  } catch (error) {
    console.error('[OpenClaw] Error:', error.message);
    return null;
  }
}

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

module.exports = router;
