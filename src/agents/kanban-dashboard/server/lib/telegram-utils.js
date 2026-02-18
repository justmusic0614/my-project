// Telegram 共用工具函數
// 供 server/routes/telegram.js 和 scripts/telegram-poller.js 共用

const https = require('https');
const { execSync } = require('child_process');

/**
 * 發送 Telegram 訊息
 * @returns {Promise<boolean>} 是否成功
 */
function sendTelegramReply(chatId, text) {
  return new Promise((resolve) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.error('[Telegram] TELEGRAM_BOT_TOKEN not set');
      return resolve(false);
    }

    const data = JSON.stringify({
      chat_id: chatId,
      text: text
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data, 'utf8')
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log(`[Telegram] Sent reply to ${chatId}: ${text.substring(0, 50)}...`);
          resolve(true);
        } else {
          console.error(`[Telegram] Failed to send reply (${res.statusCode}):`, responseData);
          resolve(false);
        }
      });
    });

    req.on('error', (err) => {
      console.error('[Telegram] Request error:', err.message);
      resolve(false);
    });

    req.write(data);
    req.end();
  });
}

/**
 * 轉發訊息到 OpenClaw gateway 處理
 * @returns {Promise<string|null>} OpenClaw 回覆文字，或 null
 */
async function forwardToOpenClaw(text) {
  try {
    const escapedText = text.replace(/'/g, "'\\''");

    const nvmBinDir = '/home/clawbot/.nvm/versions/node/v22.22.0/bin';
    const openclawPath = `${nvmBinDir}/openclaw`;

    const command = `${openclawPath} agent --agent main --channel telegram ` +
      `--message '${escapedText}' --json --timeout 30`;

    console.log('[OpenClaw] Executing command:', command.substring(0, 100) + '...');

    const env = { ...process.env, PATH: `${nvmBinDir}:${process.env.PATH || ''}` };

    const output = execSync(command, {
      encoding: 'utf8',
      timeout: 35000,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: '/bin/bash',
      env
    });

    let result;
    try {
      result = JSON.parse(output);
    } catch (parseError) {
      console.error('[OpenClaw] Failed to parse JSON:', {
        error: parseError.message,
        output: output.substring(0, 500)
      });
      return null;
    }

    if (result && result.result && result.result.payloads) {
      const texts = result.result.payloads
        .map(p => p.text)
        .filter(Boolean);
      if (texts.length > 0) {
        console.log('[OpenClaw] Got reply, length:', texts.join('\n\n').length);
        return texts.join('\n\n');
      }
    }

    console.warn('[OpenClaw] No payloads in result:', JSON.stringify(result).substring(0, 200));
    return null;
  } catch (error) {
    console.error('[OpenClaw] Error:', {
      message: error.message,
      code: error.code,
      signal: error.signal,
      stderr: error.stderr?.toString()?.substring(0, 500),
      stdout: error.stdout?.toString()?.substring(0, 500)
    });

    if (error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM') {
      console.error('[OpenClaw] Command timed out after 35 seconds');
    }

    return null;
  }
}

module.exports = { sendTelegramReply, forwardToOpenClaw };
