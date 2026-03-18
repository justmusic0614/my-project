'use strict';

const path = require('path');
const { execSync } = require('child_process');

function _findRepoRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return path.join(__dirname, '../../..');
  }
}

const REPO_ROOT = _findRepoRoot();
const DATA_DIR = path.join(REPO_ROOT, 'data');

module.exports = {
  // 資料來源路徑
  paths: {
    phase4Result:    path.join(DATA_DIR, 'pipeline-state/phase4-result.json'),
    alertState:      path.join(DATA_DIR, 'runtime/alert-state.json'),
    knowledgeIndex:  path.join(DATA_DIR, 'index.json'),
    securityReport:  path.join(DATA_DIR, 'security-patrol'),
    deliveryLog:     path.join(REPO_ROOT, 'logs/briefing-delivery.jsonl'),
  },

  // Stale threshold（小時）
  staleThresholds: {
    market:    18,
    alertState: 1,
    knowledge: 24,
    security:  24,
  },

  // Telegram（從環境變數讀）
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId:   process.env.TELEGRAM_CHAT_ID   || '',
  },

  // LLM（從環境變數讀）
  llm: {
    apiKey:  process.env.OPENAI_API_KEY || '',
    model:   'gpt-4o-mini',
    timeoutMs: 30000,
  },
};
