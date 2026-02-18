/**
 * CommandRouter — Telegram 命令路由器
 * 負責：
 *   - 解析 Telegram 訊息中的命令（/today、/watchlist 等）
 *   - 路由到對應的命令處理器
 *   - 統一回覆格式（透過 TelegramPublisher 發送）
 *   - 錯誤處理（命令執行失敗時回覆錯誤訊息）
 *
 * 設計：
 *   - 命令處理器接受 (args: string[], config: object) 並回傳 Promise<string>
 *   - CommandRouter 負責發送回覆，命令處理器只負責產生文字
 *   - 與 OpenClaw 整合：接收 update.message 物件
 *
 * 使用方式：
 *   const router = new CommandRouter(config);
 *   const text   = await router.handle('/today');
 *   await telegram.publishAlert(text);
 *
 *   // 或從 Telegram Update 物件直接處理：
 *   await router.handleUpdate(update, telegramPublisher);
 */

'use strict';

const { createLogger } = require('../shared/logger');
const logger = createLogger('commands:router');

// 命令 → 模組映射
const COMMAND_MAP = {
  '/today':     () => require('./cmd-today'),
  '/financial': () => require('./cmd-financial'),
  '/watchlist': () => require('./cmd-watchlist'),
  '/weekly':    () => require('./cmd-weekly'),
  '/analyze':   () => require('./cmd-analyze'),
  '/news':      () => require('./cmd-news'),
  '/query':     () => require('./cmd-query'),
  '/alerts':    () => require('./cmd-alerts'),
  '/help':      () => ({ handle: _helpHandler })
};

// 命令別名
const ALIASES = {
  '/f':   '/financial',
  '/w':   '/watchlist',
  '/a':   '/analyze',
  '/n':   '/news',
  '/q':   '/query',
  '/突發': '/news'
};

class CommandRouter {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * 從命令字串執行並取得回覆文字
   * @param {string} text    - 完整訊息文字（如 "/analyze 2330" 或 "/watchlist add 0050"）
   * @param {object} context - 額外 context（如 chatId、userId）
   * @returns {Promise<string>} 回覆文字
   */
  async handle(text, context = {}) {
    if (!text || !text.startsWith('/') && !text.startsWith('突發')) {
      return null; // 非命令訊息，忽略
    }

    const { cmd, args } = this._parse(text);
    const resolvedCmd   = ALIASES[cmd] || cmd;

    const handlerFactory = COMMAND_MAP[resolvedCmd];
    if (!handlerFactory) {
      return `❌ 未知指令：${cmd}\n💡 使用 /help 查看可用指令`;
    }

    try {
      logger.info(`executing command: ${resolvedCmd}`, { args });
      const handler = handlerFactory();
      const result  = await handler.handle(args, this.config, context);
      return result || '（無回覆內容）';
    } catch (err) {
      logger.error(`command ${resolvedCmd} failed: ${err.message}`);
      return `❌ 指令執行失敗：${err.message}\n請稍後再試`;
    }
  }

  /**
   * 處理 Telegram Update 物件（Webhook 模式）
   * @param {object}            update    - Telegram Update
   * @param {TelegramPublisher} publisher - 用於發送回覆
   */
  async handleUpdate(update, publisher) {
    const message = update?.message;
    if (!message?.text) return;

    const chatId  = message.chat?.id?.toString();
    const text    = message.text;
    const context = { chatId, userId: message.from?.id };

    const reply = await this.handle(text, context);
    if (reply && publisher) {
      await publisher.publishAlert(reply);
    }
  }

  /**
   * 解析命令字串為命令名和參數陣列
   * "/analyze 2330 --days 5" → { cmd: '/analyze', args: ['2330', '--days', '5'] }
   */
  _parse(text) {
    const trimmed = text.trim();
    const parts   = trimmed.split(/\s+/);
    let cmd       = parts[0].toLowerCase();

    // 處理 bot username（/today@bot_name → /today）
    const atIdx = cmd.indexOf('@');
    if (atIdx !== -1) cmd = cmd.slice(0, atIdx);

    const args = parts.slice(1);
    return { cmd, args };
  }
}

// ── 內建 /help 處理器 ────────────────────────────────────────────────────────
async function _helpHandler() {
  return `📊 Market Digest v2.0 — 可用指令

📋 報告
  /today                完整今日市場日報
  /financial            Watchlist 財報+籌碼分析
  /weekly               本週市場週報

🎯 Watchlist 管理
  /watchlist list       列出追蹤清單
  /watchlist add 2330   新增股票
  /watchlist remove 2330 移除股票

🔍 查詢分析
  /analyze 2330         個股深度分析（AI 驅動）
  /news                 今日財經新聞
  /news 台積電          搜尋特定關鍵字新聞
  /query 聯發科         搜尋歷史日報
  /突發                 最近 24 小時重大事件

⚠️  告警
  /alerts               檢查異常告警
  /alerts status        告警狀態總覽

💡 範例：
  /analyze 2330
  /watchlist add 2330 2454
  /news Fed`;
}

module.exports = CommandRouter;
