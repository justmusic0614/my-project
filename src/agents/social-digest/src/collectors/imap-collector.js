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
 * 依賴：imapflow, mailparser
 */

'use strict';

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

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

// ── ImapFlow client factory ──────────────────────────────────────────────────

/**
 * 建立 ImapFlow client 實例
 * @param {ImapConfig} imapConfig
 * @returns {ImapFlow}
 */
function createClient(imapConfig) {
  return new ImapFlow({
    host: imapConfig.host,
    port: imapConfig.port,
    secure: imapConfig.secure !== false,
    auth: {
      user: imapConfig.user,
      pass: imapConfig.password,
    },
    logger: false,
    emitLogs: false,
    tls: {
      rejectUnauthorized: true,
    },
    connectTimeout: imapConfig.connectionTimeout || 15000,
    greetingTimeout: imapConfig.connectionTimeout || 15000,
  });
}

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
  const client = createClient(imapConfig);
  const mailbox = resolveMailbox(imapConfig);

  try {
    // 1. 連線
    await client.connect();

    // 2. 開啟 mailbox（readOnly，不改變 flag）
    const mbInfo = await client.mailboxOpen(mailbox, { readOnly: true });
    if (!mbInfo) {
      throw new Error(`無法開啟 mailbox: ${mailbox}`);
    }

    // 3. 計算搜尋起始時間
    const since = calcSinceDate(latestJson, imapConfig.lookbackMinutes || 120, backfillHours);

    // 4. IMAP SEARCH（from facebookmail.com + since date）
    const searchCriteria = {
      since,
      from: 'facebookmail.com',
    };
    let uids;
    try {
      uids = await client.search(searchCriteria, { uid: true });
    } catch (searchErr) {
      // search 失敗可能是 mailbox 為空
      if (searchErr.message && searchErr.message.includes('Nothing to fetch')) {
        uids = [];
      } else {
        throw searchErr;
      }
    }

    if (!uids || uids.length === 0) {
      // 無搜尋結果
      await client.logout();
      return {
        emails: [],
        newWatermark: {
          imap_last_uid: latestJson.imap_last_uid ?? null,
          imap_last_internal_date: latestJson.imap_last_internal_date ?? null,
          imap_last_message_id: latestJson.imap_last_message_id ?? null,
        },
        stats: { fetched: 0, deduped: 0, mailbox },
      };
    }

    // 5. 批次抓取（fetchAll 安全不鎖連線）
    const messages = await client.fetchAll(uids, {
      source: true,
      uid: true,
      internalDate: true,
      envelope: true,
    }, { uid: true });

    // 6. 解析每封信
    const fetched = [];
    for (const msg of messages) {
      try {
        const emailData = await parseMessage(msg);
        fetched.push(emailData);
      } catch (parseErr) {
        // 單封解析失敗不影響整批
        process.stderr.write(`⚠️  [imap-collector] 解析失敗 (uid=${msg.uid}): ${parseErr.message}\n`);
      }
    }

    // 7. Message-ID 去重（避免 lookback overlap 重複抓取）
    const knownIds = new Set(
      [latestJson.imap_last_message_id].filter(Boolean)
    );
    const deduped = fetched.filter(e => {
      if (!e.messageId) return true;  // 無 Message-ID 的不去重（罕見）
      if (knownIds.has(e.messageId)) return false;
      knownIds.add(e.messageId);  // 同批次內也去重
      return true;
    });

    // 8. 由舊到新排序（以 internalDate 為主，UID 為次）
    deduped.sort((a, b) => {
      const da = new Date(a.internalDate).getTime();
      const db = new Date(b.internalDate).getTime();
      if (da !== db) return da - db;
      return (a.uid || 0) - (b.uid || 0);
    });

    // 9. 計算新水位線（取最新 internalDate 的那封）
    const newest = deduped.length > 0 ? deduped[deduped.length - 1] : null;
    const newWatermark = {
      imap_last_uid: newest?.uid ?? latestJson.imap_last_uid ?? null,
      imap_last_internal_date: newest?.internalDate ?? latestJson.imap_last_internal_date ?? null,
      imap_last_message_id: newest?.messageId ?? latestJson.imap_last_message_id ?? null,
    };

    // 10. 斷線
    await client.logout();

    return {
      emails: deduped,
      newWatermark,
      stats: {
        fetched: uids.length,
        deduped: deduped.length,
        mailbox,
      },
    };

  } catch (err) {
    // 確保連線被關閉
    try { await client.logout(); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * 列出 IMAP 帳號下所有 mailbox（用於偵錯 / 驗證 label 設定）
 *
 * @param {ImapConfig} imapConfig
 * @returns {Promise<string[]>} mailbox 名稱清單
 */
async function listMailboxes(imapConfig) {
  const client = createClient(imapConfig);
  try {
    await client.connect();
    const list = await client.list();
    await client.logout();
    return list.map(m => m.path);
  } catch (err) {
    try { await client.logout(); } catch { /* ignore */ }
    throw err;
  }
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
  const boxes = await listMailboxes(imapConfig);
  return boxes.includes(mailbox);
}

// ── 內部工具函式 ─────────────────────────────────────────────────────────────

/**
 * 解析單封 IMAP message 為 EmailData 格式。
 * 使用 mailparser simpleParser 取得 html/text body。
 *
 * @param {Object} msg — imapflow fetchAll 回傳的 message 物件
 * @returns {Promise<EmailData>}
 */
async function parseMessage(msg) {
  // msg.source 是 Buffer（RFC822 raw email）
  const parsed = await simpleParser(msg.source);

  return {
    messageId: parsed.messageId || msg.envelope?.messageId || null,
    subject: parsed.subject || msg.envelope?.subject || '',
    from: parsed.from?.text || (msg.envelope?.from?.[0]?.address) || '',
    html: parsed.html || '',
    text: parsed.text || '',
    internalDate: msg.internalDate
      ? new Date(msg.internalDate).toISOString()
      : new Date().toISOString(),
    uid: msg.uid || null,
  };
}

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
 * Gmail label 的 IMAP 路徑格式：直接用 label 名稱（imapflow 處理 namespace）。
 *
 * @param {ImapConfig} imapConfig
 * @returns {string}
 */
function resolveMailbox(imapConfig) {
  if (imapConfig.mailboxType === 'gmail_label') {
    // Gmail label 直接用 label 名稱
    // 如果 label 在 IMAP 中的路徑不同（如 [Gmail]/...），
    // 使用者應透過 listMailboxes() 確認後設定正確的 label 值
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
  // 暴露內部工具供測試 / 偵錯使用
  _calcSinceDate: calcSinceDate,
  _resolveMailbox: resolveMailbox,
  _parseMessage: parseMessage,
  _createClient: createClient,
};
