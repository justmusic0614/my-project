'use strict';

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── 並發 + 冷卻（global singleton job slot）─────────────────────────────────
let _activeJobs = 0;
const MAX_BRAIN_JOBS = 1;
const _lastBrainCall = {};
const BRAIN_COOLDOWN_MS = 60000;

// ── executeBrainDistill ─────────────────────────────────────────────────────

function executeBrainDistill(payload, jobId) {
  return new Promise((resolve) => {
    const escapedPayload = payload.replace(/'/g, "'\\''");
    const runnerPath = '/home/clawbot/clawd/agents/knowledge-digest/scripts/run-brain-distill.sh';

    const isYoutube = /youtube\.com|youtu\.be/i.test(payload);
    const timeoutMs = isYoutube ? 240000 : 120000;

    exec(`bash "${runnerPath}" '${escapedPayload}' --job-id='${jobId}'`, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      shell: '/bin/bash',
    }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[BrainDistill:${jobId}] Error:`, error.message);
        if (stderr) console.error(`[BrainDistill:${jobId}] stderr:`, stderr.substring(0, 500));
        const msg = error.signal === 'SIGTERM'
          ? `蒸餾超時（${timeoutMs / 1000}秒）`
          : error.message;
        resolve({ ok: false, error: msg });
        return;
      }
      const match = stdout.match(/---RESULT_START---([\s\S]*?)---RESULT_END---/);
      if (!match) {
        console.error(`[BrainDistill:${jobId}] No delimiter. stdout:`, stdout.substring(0, 500));
        if (stderr) console.error(`[BrainDistill:${jobId}] stderr:`, stderr.substring(0, 500));
        resolve({ ok: false, error: '蒸餾腳本未輸出結果' });
        return;
      }
      try {
        resolve(JSON.parse(match[1].trim()));
      } catch (e) {
        console.error(`[BrainDistill:${jobId}] JSON parse fail:`, match[1].substring(0, 300));
        resolve({ ok: false, error: '蒸餾腳本輸出格式錯誤' });
      }
    });
  });
}

const BRAIN_DATA_DIR = '/home/clawbot/clawd/agents/knowledge-digest/data/runtime/brain';

// ── Plugin Entry ────────────────────────────────────────────────────────────

module.exports = function brainCommandPlugin(api) {
  const sendTelegram = api.runtime.channel.telegram.sendMessageTelegram;

  // ── brainsearch command ──────────────────────────────────────────────────
  api.registerCommand({
    name: 'brainsearch',
    description: '查詢蒸餾全文：/brainsearch <jobId>',
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      const jobId = (ctx.args || '').trim();

      if (!jobId) {
        return { text: '請提供 Job ID\n用法：/brainsearch <jobId>\n例如：/brainsearch brain-1774106895702' };
      }

      // 只允許 brain-<digits> 格式，防止 path traversal
      if (!/^brain-\d+$/.test(jobId)) {
        return { text: `無效的 Job ID 格式：${jobId}\n格式應為 brain-<timestamp>，例如 brain-1774106895702` };
      }

      const filePath = path.join(BRAIN_DATA_DIR, `${jobId}.md`);

      let content;
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') {
          return { text: `找不到 Job ID：${jobId}\n請確認 ID 是否正確` };
        }
        console.error(`[brainsearch] Read error for ${jobId}:`, err.message);
        return { text: `讀取失敗：${err.message}` };
      }

      // Telegram 訊息限制 4096 字元，超過就截斷
      const MAX_LEN = 4000;
      const reply = content.length > MAX_LEN
        ? content.substring(0, MAX_LEN) + `\n\n…（已截斷，全文共 ${content.length} 字元）`
        : content;

      return { text: reply };
    },
  });

  // ── brain command ────────────────────────────────────────────────────────
  api.registerCommand({
    name: 'brain',
    description: '知識蒸餾：/brain <文字或URL>',
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      const payload = (ctx.args || '').trim();
      const chatId = ctx.to || ctx.senderId;

      // 空 payload
      if (!payload) {
        return { text: '請提供文字或 URL\n用法：/brain <文字或URL>' };
      }

      // 並發控制（global singleton slot）
      if (_activeJobs >= MAX_BRAIN_JOBS) {
        return { text: '系統忙碌中，請稍後再試' };
      }

      // 冷卻（per-sender，失敗也保留）
      const senderId = ctx.senderId || 'default';
      const now = Date.now();
      if (_lastBrainCall[senderId] && now - _lastBrainCall[senderId] < BRAIN_COOLDOWN_MS) {
        return { text: '冷卻中，請稍後再試' };
      }
      _lastBrainCall[senderId] = now;

      const jobId = `brain-${now}`;

      // 先占 slot，再送 ack（避免 ack 慢時的 race window）
      _activeJobs++;

      // 回覆確認（送失敗只 log 不阻斷，job 照跑）
      try {
        await sendTelegram(chatId, `收到，蒸餾中...（ID: ${jobId}）`);
      } catch (ackErr) {
        console.error(`[brain-command:${jobId}] ack send failed:`, ackErr.message);
      }

      // 非同步執行蒸餾
      executeBrainDistill(payload, jobId)
        .then(async (result) => {
          const reply = result.ok
            ? `✅ 蒸餾完成（ID: ${jobId}）\n\n${result.summary}`
            : `❌ 蒸餾失敗（ID: ${jobId}）：${result.error}`;
          try {
            await sendTelegram(chatId, reply);
          } catch (sendErr) {
            console.error(`[brain-command:${jobId}] result send failed:`, sendErr.message);
          }
        })
        .catch(async (err) => {
          try {
            await sendTelegram(chatId, `❌ 蒸餾異常（ID: ${jobId}）：${err.message}`);
          } catch (sendErr) {
            console.error(`[brain-command:${jobId}] error send failed:`, sendErr.message);
          }
        })
        .finally(() => { _activeJobs--; });

      // 回傳 null = 不自動回覆（我們自己控制回覆時機）
      return null;
    },
  });
};
