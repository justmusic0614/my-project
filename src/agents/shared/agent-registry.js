/**
 * Agent Registry - 宣告式 agent 註冊表
 * 新增 agent 只需在 AGENTS 陣列加一筆 + 建立對應 handler
 */

const AGENTS = [
  {
    name: 'kanban',
    prefixes: ['/task', '/status', '/ping'],
    keywords: ['買', '做', '完成', '提醒', 'deadline', '任務', '待辦', '交付', '處理', '修', 'ping', 'pong'],
    timeRules: [],
    enabled: true,
    label: '✅ 建為任務',
    handlerPath: './handlers/kanban-handler'
  },
  {
    name: 'knowledge-digest',
    prefixes: ['/note', '/筆記', '/search'],
    keywords: ['記得', '筆記', '學習', '研究', '閱讀', '心得', '摘要', '概念', '想法', '理解', '整理'],
    timeRules: [],
    enabled: true,
    label: '📝 存為筆記',
    handlerPath: './handlers/knowledge-handler'
  },
  {
    name: 'market-digest',
    prefixes: ['/digest', '/financial', '/財經', '/market'],
    keywords: ['股市', '匯率', '原物料', '美股', '台股', '財報', '漲', '跌', 'ETF', '殖利率', '指數', 'S&P', '道瓊', '那斯達克', 'Fed'],
    timeRules: [{ startHour: 7, startMin: 30, endHour: 8, endMin: 30 }],
    enabled: true,
    label: '📊 財經資訊',
    handlerPath: './handlers/market-handler'
  }
];

// Lazy-loaded handler cache
const handlerCache = new Map();

function getAgents() {
  return AGENTS.filter(a => a.enabled);
}

function getAgentByName(name) {
  return AGENTS.find(a => a.name === name) || null;
}

function getHandler(agent) {
  if (!handlerCache.has(agent.name)) {
    handlerCache.set(agent.name, require(agent.handlerPath));
  }
  return handlerCache.get(agent.name);
}

module.exports = { getAgents, getAgentByName, getHandler };
