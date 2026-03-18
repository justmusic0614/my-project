'use strict';

const https = require('https');

class TelegramNotifier {
  constructor(options = {}) {
    this.botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN || '';
    this.chatId = options.chatId || process.env.TELEGRAM_CHAT_ID || '';
    this.enabled = !!(this.botToken && this.chatId);
    this.timeoutMs = options.timeoutMs || 15000;
  }

  async sendMessage(text, opts = {}) {
    if (!this.enabled) {
      return { ok: false, reason: 'telegram not configured' };
    }

    if (!text || text.trim().length === 0) {
      return { ok: false, reason: 'empty message' };
    }

    try {
      await this._post(text);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  _post(text) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ chat_id: this.chatId, text });

      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${this.botToken}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: this.timeoutMs
      };

      const req = https.request(options, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.ok) {
              resolve(json);
            } else {
              reject(new Error(`Telegram API: ${json.description || 'unknown error'}`));
            }
          } catch (e) {
            reject(new Error(`JSON parse: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    });
  }
}

module.exports = TelegramNotifier;
