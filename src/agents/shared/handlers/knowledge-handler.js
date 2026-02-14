/**
 * Knowledge Digest Handler - 呼叫 digest.js CLI
 * 支援子指令：add-note, query/search, stats, weekly, daily-review, inbox, semantic-search
 */

const { execSync } = require('child_process');
const path = require('path');

const DIGEST_SCRIPT = path.join(__dirname, '../../knowledge-digest/scripts/digest.js');

function runDigest(args) {
  try {
    const cmd = `node "${DIGEST_SCRIPT}" ${args}`;
    return execSync(cmd, { encoding: 'utf8', timeout: 30000, stdio: 'pipe' }).trim();
  } catch (err) {
    console.error('[knowledge-handler] digest.js error:', err.message);
    return `❌ 執行失敗：${err.message.substring(0, 100)}`;
  }
}

/**
 * 解析子指令
 * /note 今天學到...         → add-note
 * /note stats               → stats
 * /note weekly              → weekly
 * /note review              → daily-review
 * /note inbox               → inbox
 * /search 關鍵字            → query
 * /筆記 ...                 → add-note
 * (純文字 from dispatcher)  → add-note
 */
function parseSubcommand(text) {
  if (!text) return { action: 'help' };

  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  const first = parts[0].toLowerCase();

  // 內建子指令
  const subcommands = ['stats', 'weekly', 'review', 'daily-review', 'inbox', 'help'];
  if (subcommands.includes(first)) {
    const action = first === 'review' ? 'daily-review' : first;
    return { action, args: parts.slice(1).join(' ') };
  }

  // search / query
  if (first === 'search' || first === 'query') {
    const keyword = parts.slice(1).join(' ');
    if (!keyword) return { action: 'help' };
    return { action: 'query', keyword };
  }

  // semantic-search
  if (first === 'semantic' || first === 'semantic-search') {
    const question = parts.slice(1).join(' ');
    if (!question) return { action: 'help' };
    return { action: 'semantic-search', question };
  }

  // mark-read / archive
  if (first === 'mark-read' && parts[1]) {
    return { action: 'mark-read', id: parts[1] };
  }
  if (first === 'archive' && parts[1]) {
    return { action: 'archive', id: parts[1] };
  }

  // 預設：整段文字當筆記內容
  return { action: 'add-note', content: trimmed };
}

function escapeShellArg(arg) {
  return arg.replace(/'/g, "'\\''");
}

async function handle(text, context) {
  const parsed = parseSubcommand(text);

  if (parsed.action === 'help') {
    return (
      '📝 Knowledge Digest 指令說明\n\n' +
      '/note <內容> - 新增筆記\n' +
      '/note stats - 統計資訊\n' +
      '/note weekly - 週報\n' +
      '/note review - 每日複習\n' +
      '/note inbox - 收件匣\n' +
      '/search <關鍵字> - 搜尋筆記\n\n' +
      '範例:\n' +
      '/note 今天學到 React hooks 的用法\n' +
      '/search React'
    );
  }

  if (parsed.action === 'add-note') {
    const escaped = escapeShellArg(parsed.content);
    return runDigest(`add-note '${escaped}' --tags="telegram,筆記" --title="Telegram 筆記"`);
  }

  if (parsed.action === 'query') {
    const escaped = escapeShellArg(parsed.keyword);
    return runDigest(`query --keyword='${escaped}' --days=30`);
  }

  if (parsed.action === 'semantic-search') {
    const escaped = escapeShellArg(parsed.question);
    return runDigest(`semantic-search '${escaped}'`);
  }

  if (parsed.action === 'mark-read') {
    return runDigest(`mark-read ${parsed.id}`);
  }

  if (parsed.action === 'archive') {
    return runDigest(`archive ${parsed.id}`);
  }

  // stats, weekly, daily-review, inbox
  return runDigest(parsed.action);
}

module.exports = { handle };
