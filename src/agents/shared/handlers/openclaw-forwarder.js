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
async function handle(text) {
  try {
    // 轉義訊息內容（防止 shell injection）
    const escapedText = text.replace(/'/g, "'\\''");

    // 調用 OpenClaw agent 命令（透過 gateway）
    // --agent main: 使用 main agent（與 dashboard 共用 session 和模型設定）
    // --channel telegram: 指定來源 channel
    // --message: 訊息內容
    // --json: 返回 JSON 格式
    const nvmBinDir = '/home/clawbot/.nvm/versions/node/v22.22.0/bin';
    const openclawPath = `${nvmBinDir}/openclaw`;
    const command = `${openclawPath} agent --agent main --channel telegram ` +
      `--message '${escapedText}' --json --timeout 30`;

    // 將 nvm 的 node 路徑加入 PATH，因為 openclaw 的 shebang 是 #!/usr/bin/env node
    const env = { ...process.env, PATH: `${nvmBinDir}:${process.env.PATH || ''}` };

    const output = execSync(command, {
      encoding: 'utf8',
      timeout: 35000, // 35 秒超時
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: '/bin/bash',
      env
    });

    // 解析 JSON 輸出
    const result = JSON.parse(output);

    // Gateway 回傳格式：result.payloads[].text
    if (result && result.result && result.result.payloads) {
      const texts = result.result.payloads
        .map(p => p.text)
        .filter(Boolean);
      if (texts.length > 0) {
        return texts.join('\n\n');
      }
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
