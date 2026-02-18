const express = require('express');
const router = express.Router();
const https = require('https');
const { execSync } = require('child_process');
const { asyncHandler } = require('../middleware/error-handler');

// Environment variables（必須在 .env 中設定，不提供預設值）
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

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

    console.log('[OpenClaw] Executing command:', command.substring(0, 100) + '...');

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
    let result;
    try {
      result = JSON.parse(output);
    } catch (parseError) {
      console.error('[OpenClaw] ❌ Failed to parse JSON:', {
        error: parseError.message,
        output: output.substring(0, 500)
      });
      return null;
    }

    // Gateway 回傳格式：result.payloads[].text
    if (result && result.result && result.result.payloads) {
      const texts = result.result.payloads
        .map(p => p.text)
        .filter(Boolean);
      if (texts.length > 0) {
        console.log('[OpenClaw] ✅ Got reply, length:', texts.join('\n\n').length);
        return texts.join('\n\n');
      }
    }

    console.warn('[OpenClaw] ⚠️ No payloads in result:', JSON.stringify(result).substring(0, 200));
    return null;
  } catch (error) {
    console.error('[OpenClaw] ❌ Error:', {
      message: error.message,
      code: error.code,
      signal: error.signal,
      stderr: error.stderr?.toString()?.substring(0, 500),
      stdout: error.stdout?.toString()?.substring(0, 500)
    });

    // 特別處理超時錯誤
    if (error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM') {
      console.error('[OpenClaw] ⏱️ Command timed out after 35 seconds');
    }

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

/**
 * GET /api/telegram/health
 *
 * Health check endpoint for monitoring
 * 直接呼叫 Telegram getMe API（輕量級，< 1 秒）
 * 不依賴 OpenClaw，避免 LLM 啟動延遲導致誤報
 */
router.get('/health', asyncHandler(async (req, res) => {
  const timeoutMs = 8000;  // 每次嘗試 8 秒
  const maxRetries = 2;    // 最多重試 2 次（指數退避：500ms, 1000ms）

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
        // 指數退避：第 1 次等 500ms，第 2 次等 1000ms
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, i)));
      }
    }
  }

  try {
    const result = await checkTelegramApi();
    // 永遠回傳 HTTP 200，由 body 的 status 表達健康程度
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
    // 永遠回傳 HTTP 200（不是 503），讓 health-check.js 可以正確解析 body
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
