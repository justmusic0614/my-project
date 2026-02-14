/**
 * Message Dispatcher - 4 層路由分派 Telegram 訊息到對應 agent
 *
 * Layer 1: 指令前綴（exact match）
 * Layer 2: 時間規則 + 關鍵字交叉
 * Layer 3: 關鍵字評分
 * Layer 4: Fallback（純文字選單讓使用者選）
 */

const registry = require('./agent-registry');

const FALLBACK_TIMEOUT_MS = 60 * 1000; // 60 秒

// chatId → { originalText, timestamp }
const pendingSessions = new Map();

/**
 * 檢查時間是否在規則範圍內
 */
function isInTimeRange(hour, minute, rule) {
  const now = hour * 60 + minute;
  const start = rule.startHour * 60 + rule.startMin;
  const end = rule.endHour * 60 + rule.endMin;
  return now >= start && now <= end;
}

/**
 * 計算文字與關鍵字陣列的匹配分數
 */
function calculateKeywordScore(text, keywords) {
  let score = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) {
      score += kw.length >= 3 ? 2 : 1; // 較長的關鍵字權重更高
    }
  }
  return score;
}

/**
 * Layer 1: 指令前綴比對
 * @returns {{ agent: object, text: string } | null}
 */
function matchPrefix(text) {
  for (const agent of registry.getAgents()) {
    for (const prefix of agent.prefixes) {
      if (text === prefix || text.startsWith(prefix + ' ')) {
        const remaining = text.slice(prefix.length).trim();
        return { agent, text: remaining };
      }
    }
  }
  return null;
}

/**
 * Layer 2: 時間規則 + 關鍵字交叉
 * @returns {{ agent: object, text: string } | null}
 */
function matchTimeRule(text, timestamp) {
  const date = timestamp ? new Date(timestamp * 1000) : new Date();
  const hour = date.getHours();
  const minute = date.getMinutes();

  for (const agent of registry.getAgents()) {
    if (agent.timeRules.length === 0) continue;

    for (const rule of agent.timeRules) {
      if (isInTimeRange(hour, minute, rule) && calculateKeywordScore(text, agent.keywords) > 0) {
        return { agent, text };
      }
    }
  }
  return null;
}

/**
 * Layer 3: 關鍵字評分
 * @returns {{ agent: object, text: string } | null}
 */
function matchKeywords(text) {
  const scores = registry.getAgents()
    .map(agent => ({
      agent,
      score: calculateKeywordScore(text, agent.keywords)
    }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // 需要有明確優勢（最高分 >= 2，且比第二名高）
  if (scores.length > 0 && scores[0].score >= 2) {
    if (scores.length === 1 || scores[0].score > scores[1].score) {
      return { agent: scores[0].agent, text };
    }
  }
  return null;
}

/**
 * 生成 fallback 選單訊息
 */
function buildFallbackMessage(text) {
  const preview = text.length > 30 ? text.substring(0, 30) + '...' : text;
  const agents = registry.getAgents();
  const options = agents.map((a, i) => `${i + 1}️⃣ ${a.label}`).join('\n');

  return (
    `❓ 無法判斷這則訊息的類別：\n` +
    `「${preview}」\n\n` +
    `請回覆數字選擇：\n${options}\n\n` +
    `⏰ 60 秒內回覆有效`
  );
}

/**
 * 清理過期的 pending sessions
 */
function cleanExpiredSessions() {
  const now = Date.now();
  for (const [chatId, session] of pendingSessions) {
    if (now - session.timestamp > FALLBACK_TIMEOUT_MS) {
      pendingSessions.delete(chatId);
    }
  }
}

/**
 * 主路由函式
 *
 * @param {string} text - 訊息文字
 * @param {{ chatId: number, username: string, timestamp: number }} context
 * @returns {{ action: 'route'|'ask', agent?: object, handler?: object, text?: string, confidence?: string, message?: string }}
 */
function route(text, context) {
  cleanExpiredSessions();

  // 檢查是否是 fallback 選擇回覆
  if (pendingSessions.has(context.chatId)) {
    const session = pendingSessions.get(context.chatId);
    const choice = parseInt(text.trim(), 10);
    const agents = registry.getAgents();

    if (choice >= 1 && choice <= agents.length) {
      pendingSessions.delete(context.chatId);
      const agent = agents[choice - 1];
      return {
        action: 'route',
        agent,
        handler: registry.getHandler(agent),
        text: session.originalText,
        confidence: 'user-choice'
      };
    }
    // 不是有效數字 → 清除 session，當作新訊息處理
    pendingSessions.delete(context.chatId);
  }

  // Layer 1: 指令前綴
  const prefixMatch = matchPrefix(text);
  if (prefixMatch) {
    return {
      action: 'route',
      agent: prefixMatch.agent,
      handler: registry.getHandler(prefixMatch.agent),
      text: prefixMatch.text,
      confidence: 'exact'
    };
  }

  // Layer 2: 時間規則
  const timeMatch = matchTimeRule(text, context.timestamp);
  if (timeMatch) {
    return {
      action: 'route',
      agent: timeMatch.agent,
      handler: registry.getHandler(timeMatch.agent),
      text: timeMatch.text,
      confidence: 'high'
    };
  }

  // Layer 3: 關鍵字
  const keywordMatch = matchKeywords(text);
  if (keywordMatch) {
    return {
      action: 'route',
      agent: keywordMatch.agent,
      handler: registry.getHandler(keywordMatch.agent),
      text: keywordMatch.text,
      confidence: 'medium'
    };
  }

  // Layer 4: Fallback — 回覆選單
  pendingSessions.set(context.chatId, {
    originalText: text,
    timestamp: Date.now()
  });

  return {
    action: 'ask',
    message: buildFallbackMessage(text)
  };
}

module.exports = { route };
