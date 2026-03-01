/**
 * imap-collector.js — IMAP 水位線收信（M4）
 *
 * 水位線三件套：
 *   imap_last_uid            — IMAP UID（加速遍歷，選用）
 *   imap_last_internal_date  — 最後一封 internalDate（主視窗）
 *   imap_last_message_id     — 最後一封 Message-ID（最終去重）
 *
 * 取信策略：
 *   1. 以 imap_last_internal_date - lookbackMinutes 為視窗起點
 *   2. 若無歷史水位線，取最近 backfillHours 的信
 *   3. 用 Message-ID 去重（避免 lookback overlap 重複）
 *   4. 只在整批成功後回傳新水位線（由呼叫端寫入 latest.json）
 *
 * API：
 *   collect(imapConfig, latestJson, backfillHours?) → Promise<CollectResult>
 *   listMailboxes(imapConfig)                       → Promise<string[]>
 *   verifyMailbox(imapConfig, mailbox)              → Promise<boolean>
 *
 * 依賴：imapflow（已安裝）
 */

'use strict';

// TODO: const { ImapFlow } = require('imapflow');
// TODO: const { simpleParser } = require('mailparser');  // 若需要解析 raw message

// ── 型別定義（JSDoc） ────────────────────────────────────────────────────────

/**
 * @typedef {Object} ImapConfig
 * @property {string} host
 * @property {number} port
 * @property {boolean} secure
 * @property {string} user
 * @property {string} password
 * @property {string} mailboxType     — 'gmail_label' | 'standard'
 * @property {string} label           — Gmail label（mailboxType === 'gmail_label' 時）
 * @property {number} lookbackMinutes — 水位線往前的緩衝分鐘數
 * @property {number} connectionTimeout
 */

/**
 * @typedef {Object} WatermarkTriple
 * @property {number|null} imap_last_uid
 * @property {string|null} imap_last_internal_date  — ISO 8601
 * @property {string|null} imap_last_message_id
 */

/**
 * @typedef {Object} EmailData
 * @property {string}      messageId
 * @property {string}      subject
 * @property {string}      from
 * @property {string}      html
 * @property {string}      text
 * @property {string}      internalDate  — ISO 8601
 * @property {number}      uid
 */

/**
 * @typedef {Object} CollectResult
 * @property {EmailData[]}    emails
 * @property {WatermarkTriple} newWatermark  — 只在 emails.length > 0 時更新
 * @property {Object}         stats
 * @property {number}         stats.fetched   — IMAP 搜尋命中數
 * @property {number}         stats.deduped   — Message-ID 去重後的數量
 * @property {string}         stats.mailbox   — 實際使用的 mailbox 名稱
 */

// ── 主要 API ─────────────────────────────────────────────────────────────────

/**
 * 從 IMAP 收取 Facebook 群組通知信。
 *
 * @param {ImapConfig}     imapConfig
 * @param {WatermarkTriple} latestJson — data/runtime/latest.json 的內容（部分）
 * @param {number}         [backfillHours=24] — 無水位線時的回溯時數
 * @returns {Promise<CollectResult>}
 */
async function collect(imapConfig, latestJson, backfillHours = 24) {
  // TODO: 實際 IMAP 連線與收信邏輯
  //
  // 流程概要：
  // 1. 連線
  //    const client = new ImapFlow({ host, port, auth: { user, pass }, logger: false });
  //    await client.connect();
  //
  // 2. 選擇 mailbox
  //    const mailbox = resolveMailbox(imapConfig);
  //    await client.mailboxOpen(mailbox, { readOnly: true });
  //
  // 3. 計算搜尋起始時間
  //    const since = calcSinceDate(latestJson, imapConfig.lookbackMinutes, backfillHours);
  //
  // 4. IMAP SEARCH
  //    const uids = await client.search({ since, from: 'facebookmail.com' });
  //    // 由新到舊排序（UID 遞減），但最終回傳時由舊到新
  //
  // 5. 逐封抓取（BODY.PEEK[]）
  //    for await (const msg of client.fetch(uids, { source: true, uid: true, internalDate: true })) {
  //      const parsed = await simpleParser(msg.source);
  //      ...
  //    }
  //
  // 6. Message-ID 去重
  //    const knownIds = new Set([latestJson.imap_last_message_id].filter(Boolean));
  //    const deduped = fetched.filter(e => !knownIds.has(e.messageId));
  //
  // 7. 計算新水位線（取最新 internalDate 的那封）
  //    const sorted = [...deduped].sort((a, b) => new Date(a.internalDate) - new Date(b.internalDate));
  //    const newest = sorted[sorted.length - 1];
  //    const newWatermark = {
  //      imap_last_uid: newest?.uid ?? latestJson.imap_last_uid,
  //      imap_last_internal_date: newest?.internalDate ?? latestJson.imap_last_internal_date,
  //      imap_last_message_id: newest?.messageId ?? latestJson.imap_last_message_id,
  //    };
  //
  // 8. 斷線
  //    await client.logout();
  //
  // 9. 回傳（成功後才更新水位線，由呼叫端負責寫入 latest.json）
  //    return { emails: sorted, newWatermark, stats: { fetched: uids.length, deduped: sorted.length, mailbox } };

  throw new Error('imap-collector: collect() 尚未實作（TODO）');
}

/**
 * 列出 IMAP 帳號下所有 mailbox（用於偵錯 / 驗證 label 設定）
 *
 * @param {ImapConfig} imapConfig
 * @returns {Promise<string[]>} mailbox 名稱清單
 */
async function listMailboxes(imapConfig) {
  // TODO:
  // const client = new ImapFlow({ ... });
  // await client.connect();
  // const list = await client.list();
  // await client.logout();
  // return list.map(m => m.path);

  throw new Error('imap-collector: listMailboxes() 尚未實作（TODO）');
}

/**
 * 驗證指定 mailbox 是否存在。
 * 啟動時呼叫，若回傳 false 則阻擋並告警。
 *
 * @param {ImapConfig} imapConfig
 * @param {string}     mailbox
 * @returns {Promise<boolean>}
 */
async function verifyMailbox(imapConfig, mailbox) {
  // TODO:
  // const boxes = await listMailboxes(imapConfig);
  // return boxes.includes(mailbox);

  throw new Error('imap-collector: verifyMailbox() 尚未實作（TODO）');
}

// ── 內部工具函式（骨架） ─────────────────────────────────────────────────────

/**
 * 根據水位線 + lookbackMinutes 計算 IMAP SEARCH SINCE 日期。
 *
 * @param {WatermarkTriple} latestJson
 * @param {number}          lookbackMinutes
 * @param {number}          backfillHours   — 無水位線時的回溯時數
 * @returns {Date}
 */
function calcSinceDate(latestJson, lookbackMinutes, backfillHours) {
  if (latestJson.imap_last_internal_date) {
    // 從上次最後一封往前緩衝 lookbackMinutes
    const lastDate = new Date(latestJson.imap_last_internal_date);
    return new Date(lastDate.getTime() - lookbackMinutes * 60 * 1000);
  }
  // 無水位線 → 回溯 backfillHours
  return new Date(Date.now() - backfillHours * 60 * 60 * 1000);
}

/**
 * 根據 mailboxType 解析實際要 open 的 mailbox 路徑。
 * Gmail label 的 IMAP 路徑格式：`[Gmail]/...` 或直接 label 名稱（取決於設定）。
 *
 * @param {ImapConfig} imapConfig
 * @returns {string}
 */
function resolveMailbox(imapConfig) {
  if (imapConfig.mailboxType === 'gmail_label') {
    // Gmail label 直接用 label 名稱（imapflow 會處理 namespace）
    return imapConfig.label;
  }
  // Standard mailbox（如 INBOX）
  return imapConfig.label || 'INBOX';
}

// ── 模組匯出 ─────────────────────────────────────────────────────────────────

module.exports = {
  collect,
  listMailboxes,
  verifyMailbox,
  // 暴露內部工具供測試 / 未來實作使用
  _calcSinceDate: calcSinceDate,
  _resolveMailbox: resolveMailbox,
};
