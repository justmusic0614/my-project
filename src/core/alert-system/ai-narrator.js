'use strict';

const https = require('https');
const config = require('./config');
const { renderAlertTemplate, renderRecoveryTemplate } = require('./templates');

const SYSTEM_PROMPT = `你是一位資深工程同事，負責用簡短繁體中文轉述系統告警。規則：
- 先說結論，再說 1-2 個原因，最後一句建議
- 不用 emoji
- 不超過 80 字
- 若不嚴重，明確說「不用現在處理」
- recovery 用正面簡短語氣`;

async function narrate(payload) {
  const narratorConfig = config.narrator || {};

  // narrator disabled → fallback
  if (!narratorConfig.enabled) {
    return _fallback(payload);
  }

  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) {
    return _fallback(payload);
  }

  const userContent = _buildUserPrompt(payload);

  try {
    const text = await _callOpenAI(apiKey, narratorConfig, userContent);
    // 附加 footer
    return text.trim() + '\n\n' + (payload.footer || '');
  } catch (err) {
    return _fallback(payload);
  }
}

function _buildUserPrompt(payload) {
  const lines = [
    `severity: ${payload.severity}`,
    `source: ${payload.source}`,
    `component: ${payload.component}`,
    `title: ${payload.title}`,
    `count: ${payload.count}`,
  ];
  if (payload.durationText) lines.push(`duration: ${payload.durationText}`);
  if (payload.details && payload.details.length > 0) {
    lines.push(`details: ${payload.details.join('；')}`);
  }
  if (payload.actionHint) lines.push(`hint: ${payload.actionHint}`);
  if (payload.resolveMode) lines.push(`resolveMode: ${payload.resolveMode}`);
  return lines.join('\n');
}

function _callOpenAI(apiKey, narratorConfig, userContent) {
  const model = narratorConfig.model || 'gpt-4o-mini';
  const timeoutMs = narratorConfig.timeoutMs || 15000;

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent }
    ],
    max_tokens: 200,
    temperature: 0.3
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: timeoutMs
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.choices && json.choices[0] && json.choices[0].message) {
            resolve(json.choices[0].message.content || '');
          } else {
            reject(new Error(`OpenAI unexpected response: ${data.slice(0, 200)}`));
          }
        } catch (e) {
          reject(new Error(`JSON parse: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('openai timeout')); });
    req.write(body);
    req.end();
  });
}

function _fallback(payload) {
  if (payload.resolveMode) {
    return renderRecoveryTemplate(payload);
  }
  return renderAlertTemplate(payload);
}

module.exports = { narrate };
