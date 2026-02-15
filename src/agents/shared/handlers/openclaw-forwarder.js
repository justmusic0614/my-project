/**
 * OpenClaw Forwarder - 轉發未定義的指令到 OpenClaw gateway
 * 讓 OpenClaw 的 skills 和 agents 能夠處理這些指令
 */

const { execSync } = require('child_process');

/**
 * 轉發訊息到 OpenClaw gateway 處理
 * @param {string} text - 訊息文字
 * @param {{ chatId: number, username: string }} context - 上下文
 * @returns {Promise<string|null>} - 回覆訊息或 null
 */
async function handle(text, context) {
  const { chatId, username } = context;

  try {
    // 使用 chatId 作為 session id，確保每個聊天有獨立的會話
    const sessionId = `telegram-${chatId}`;

    // 轉義訊息內容（防止 shell injection）
    const escapedText = text.replace(/'/g, "'\\''");

    // 調用 OpenClaw agent 命令
    // --channel telegram: 指定來源 channel
    // --session-id: 使用 chatId 作為會話標識
    // --message: 訊息內容
    // --local: 使用本地模式（不需要 gateway 認證）
    // --json: 返回 JSON 格式
    const command = `export NVM_DIR="$HOME/.nvm" && ` +
      `source "$NVM_DIR/nvm.sh" && ` +
      `openclaw agent --channel telegram --session-id "${sessionId}" ` +
      `--message '${escapedText}' --local --json --timeout 30`;

    const output = execSync(command, {
      encoding: 'utf8',
      timeout: 35000, // 35 秒超時
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // 解析 JSON 輸出
    const result = JSON.parse(output);

    // 如果有回覆，返回回覆內容
    if (result && result.reply) {
      return result.reply;
    }

    // 如果 OpenClaw 也無法處理，返回 null（靜默忽略）
    return null;

  } catch (error) {
    console.error('[OpenClaw Forwarder] Error:', error.message);
    // 如果轉發失敗，靜默忽略（不打擾使用者）
    return null;
  }
}

module.exports = { handle };
