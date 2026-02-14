/**
 * Market Digest Handler - 預留接口
 * market-digest 尚未實作，先回覆提示訊息
 */

async function handle(text, context) {
  const preview = text.length > 50 ? text.substring(0, 50) + '...' : text;
  return (
    '📊 Market Digest 尚未上線\n\n' +
    `已收到訊息：「${preview}」\n\n` +
    '此功能正在開發中，預計支援：\n' +
    '  /digest - 每日財經彙整\n' +
    '  /financial - 同上\n' +
    '  /market - 市場概況\n\n' +
    '目前可使用 /note 將財經資訊暫存為筆記'
  );
}

module.exports = { handle };
