const fs = require('fs');
const path = require('path');
const { createMutex } = require('../middleware/file-mutex');

const USAGE_FILE = path.join(__dirname, '../../data/api-usage.json');
const mutex = createMutex(USAGE_FILE);

/**
 * API 使用追蹤服務
 * 記錄所有 LLM API 調用的 token 用量和成本
 */

// ============================================================
// 初始化
// ============================================================

/**
 * 初始化資料檔案
 */
function initializeDataFile() {
  if (!fs.existsSync(USAGE_FILE)) {
    const initialData = {
      calls: [],
      summary: {
        totalCalls: 0,
        totalCost: 0,
        byModel: {},
        byDay: {},
        bySource: {}
      },
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(USAGE_FILE, JSON.stringify(initialData, null, 2));
  }
}

/**
 * 載入資料
 */
function loadData() {
  initializeDataFile();
  return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8'));
}

/**
 * 儲存資料
 */
function saveData(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2));
}

// ============================================================
// 彙總統計函數
// ============================================================

/**
 * 更新摘要統計
 */
function updateSummary(data) {
  const summary = {
    totalCalls: data.calls.length,
    totalCost: 0,
    byModel: {},
    byDay: {},
    bySource: {}
  };

  // 計算總成本和各模型統計
  data.calls.forEach(call => {
    summary.totalCost += call.cost.total;

    // 按模型統計
    if (!summary.byModel[call.model]) {
      summary.byModel[call.model] = {
        calls: 0,
        cost: 0,
        totalLatency: 0,
        successCount: 0,
        errorCount: 0
      };
    }
    summary.byModel[call.model].calls++;
    summary.byModel[call.model].cost += call.cost.total;
    summary.byModel[call.model].totalLatency += call.latency;
    if (call.status === 'success') {
      summary.byModel[call.model].successCount++;
    } else {
      summary.byModel[call.model].errorCount++;
    }

    // 按日期統計
    const day = call.timestamp.split('T')[0];
    if (!summary.byDay[day]) {
      summary.byDay[day] = { calls: 0, cost: 0 };
    }
    summary.byDay[day].calls++;
    summary.byDay[day].cost += call.cost.total;

    // 按來源統計
    if (!summary.bySource[call.source]) {
      summary.bySource[call.source] = { calls: 0, cost: 0 };
    }
    summary.bySource[call.source].calls++;
    summary.bySource[call.source].cost += call.cost.total;
  });

  // 計算平均延遲
  Object.keys(summary.byModel).forEach(model => {
    const stats = summary.byModel[model];
    stats.avgLatency = Math.round(stats.totalLatency / stats.calls);
    delete stats.totalLatency;
  });

  data.summary = summary;
}

// ============================================================
// 核心 API
// ============================================================

/**
 * 記錄 API 使用
 */
function logUsage(callRecord) {
  return mutex.withLock(() => {
    const data = loadData();

    // 新增調用記錄
    data.calls.push(callRecord);

    // 更新摘要統計
    updateSummary(data);

    // 資料輪替：保留最近 10,000 條記錄
    if (data.calls.length > 10000) {
      data.calls = data.calls.slice(-10000);
      updateSummary(data); // 重新計算摘要
    }

    saveData(data);
    return callRecord;
  });
}

/**
 * 取得摘要統計
 */
function getSummary() {
  const data = loadData();
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // 計算最近 24 小時的統計
  const last24h = data.calls.filter(call => new Date(call.timestamp) > oneDayAgo);
  const last24hCost = last24h.reduce((sum, call) => sum + call.cost.total, 0);

  return {
    totalCalls: data.summary.totalCalls,
    totalCost: data.summary.totalCost,
    byModel: data.summary.byModel,
    last24h: {
      calls: last24h.length,
      cost: last24hCost
    },
    topSources: Object.entries(data.summary.bySource)
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5)
  };
}

/**
 * 取得每日使用趨勢
 * @param {number} days - 查詢天數（預設 7 天）
 */
function getDailyUsage(days = 7) {
  const data = loadData();
  const result = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];

    const dayStats = data.summary.byDay[dateKey] || { calls: 0, cost: 0 };
    result.push({
      date: dateKey,
      calls: dayStats.calls,
      cost: dayStats.cost
    });
  }

  return result;
}

/**
 * 取得按模型分組的統計
 */
function getModelComparison() {
  const data = loadData();

  return Object.entries(data.summary.byModel).map(([modelId, stats]) => ({
    model: modelId,
    calls: stats.calls,
    cost: stats.cost,
    avgLatency: stats.avgLatency,
    successRate: stats.calls > 0
      ? (stats.successCount / stats.calls * 100).toFixed(1)
      : '0.0',
    costPer1kTokens: stats.calls > 0
      ? (stats.cost / stats.calls * 1000).toFixed(4)
      : '0.0000'
  }));
}

/**
 * 取得最近的調用記錄
 * @param {number} limit - 限制數量
 * @param {number} offset - 偏移量
 */
function getRecentCalls(limit = 50, offset = 0) {
  const data = loadData();
  const sortedCalls = data.calls
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(offset, offset + limit);

  return {
    calls: sortedCalls,
    total: data.calls.length
  };
}

/**
 * 清除所有資料（危險操作，僅供測試使用）
 */
function clearAllData() {
  return mutex.withLock(() => {
    const initialData = {
      calls: [],
      summary: {
        totalCalls: 0,
        totalCost: 0,
        byModel: {},
        byDay: {},
        bySource: {}
      },
      lastUpdated: new Date().toISOString()
    };
    saveData(initialData);
  });
}

module.exports = {
  logUsage,
  getSummary,
  getDailyUsage,
  getModelComparison,
  getRecentCalls,
  clearAllData
};
