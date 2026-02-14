const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const llmClient = require('./llm-client');
const { createMutex } = require('../middleware/file-mutex');

const AB_TESTS_FILE = path.join(__dirname, '../../data/ab-tests.json');
const mutex = createMutex(AB_TESTS_FILE);

/**
 * A/B 測試服務
 * 支援同時調用多個 LLM 模型進行比較測試
 */

/**
 * 載入測試資料
 */
function loadData() {
  if (!fs.existsSync(AB_TESTS_FILE)) {
    const initialData = { tests: [] };
    fs.writeFileSync(AB_TESTS_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
    return initialData;
  }
  return JSON.parse(fs.readFileSync(AB_TESTS_FILE, 'utf-8'));
}

/**
 * 儲存測試資料
 */
function saveData(data) {
  fs.writeFileSync(AB_TESTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 並行調用多個模型進行 A/B 測試
 * @param {string} prompt - 測試提示詞
 * @param {string[]} models - 模型 ID 陣列（2-4 個）
 * @param {object} options - 選項 { maxTokens }
 * @returns {Promise<object>} 測試結果
 */
async function runComparison(prompt, models, options = {}) {
  const { maxTokens = 800 } = options;

  // 驗證參數
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error('Prompt is required and must be a non-empty string');
  }

  if (!Array.isArray(models) || models.length < 2 || models.length > 4) {
    throw new Error('Models must be an array with 2-4 model IDs');
  }

  const testId = uuidv4();
  const timestamp = new Date().toISOString();

  console.log(`[AB-Test ${testId}] Starting comparison with ${models.length} models`);

  // 並行調用所有模型
  const modelPromises = models.map(async (modelId) => {
    const startTime = Date.now();
    try {
      const result = await llmClient.callLLM(prompt, {
        model: modelId,
        maxTokens,
        source: `ab-test:${testId}`
      });

      return {
        model: modelId,
        output: result.text,
        usage: result.usage,
        cost: result.cost.total,
        latency: Date.now() - startTime,
        status: 'success',
        rating: null // 使用者稍後評分
      };
    } catch (error) {
      console.error(`[AB-Test ${testId}] Model ${modelId} failed:`, error.message);
      return {
        model: modelId,
        output: null,
        usage: null,
        cost: 0,
        latency: Date.now() - startTime,
        status: 'error',
        error: error.message,
        rating: null
      };
    }
  });

  const results = await Promise.all(modelPromises);

  // 建立測試記錄
  const testRecord = {
    id: testId,
    timestamp,
    prompt,
    models,
    maxTokens,
    results,
    winner: null // 由使用者評分後決定
  };

  // 儲存測試記錄
  await mutex.withLock(() => {
    const data = loadData();
    data.tests.unshift(testRecord); // 最新的在前面

    // 保留最近 500 筆測試（防止檔案過大）
    if (data.tests.length > 500) {
      data.tests = data.tests.slice(0, 500);
    }

    saveData(data);
  });

  console.log(`[AB-Test ${testId}] Comparison completed. Results: ${results.map(r => r.status).join(', ')}`);

  return testRecord;
}

/**
 * 為測試結果評分
 * @param {string} testId - 測試 ID
 * @param {string} modelId - 模型 ID
 * @param {number} rating - 評分（1-5）
 */
async function rateResponse(testId, modelId, rating) {
  if (!testId || !modelId) {
    throw new Error('testId and modelId are required');
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('Rating must be an integer between 1 and 5');
  }

  return mutex.withLock(() => {
    const data = loadData();
    const test = data.tests.find(t => t.id === testId);

    if (!test) {
      throw new Error(`Test ${testId} not found`);
    }

    const result = test.results.find(r => r.model === modelId);
    if (!result) {
      throw new Error(`Model ${modelId} not found in test ${testId}`);
    }

    result.rating = rating;

    // 更新獲勝者（評分最高的模型）
    const ratedResults = test.results.filter(r => r.rating !== null && r.status === 'success');
    if (ratedResults.length > 0) {
      const maxRating = Math.max(...ratedResults.map(r => r.rating));
      const winners = ratedResults.filter(r => r.rating === maxRating);

      // 如果有多個最高分，選擇成本最低的
      if (winners.length === 1) {
        test.winner = winners[0].model;
      } else {
        const minCost = Math.min(...winners.map(w => w.cost));
        test.winner = winners.find(w => w.cost === minCost).model;
      }
    }

    saveData(data);
    return test;
  });
}

/**
 * 取得測試歷史
 * @param {object} filters - 篩選條件 { limit, offset }
 * @returns {object} { tests, total }
 */
function getComparisons(filters = {}) {
  const { limit = 50, offset = 0 } = filters;

  return mutex.withLock(() => {
    const data = loadData();
    const total = data.tests.length;
    const tests = data.tests.slice(offset, offset + limit);

    return { tests, total };
  });
}

/**
 * 取得單一測試詳情
 * @param {string} testId - 測試 ID
 */
function getComparison(testId) {
  return mutex.withLock(() => {
    const data = loadData();
    const test = data.tests.find(t => t.id === testId);

    if (!test) {
      throw new Error(`Test ${testId} not found`);
    }

    return test;
  });
}

/**
 * 取得模型排行榜
 * 基於所有測試的平均評分和獲勝次數
 */
function getLeaderboard() {
  return mutex.withLock(() => {
    const data = loadData();
    const modelStats = {};

    // 統計每個模型的表現
    data.tests.forEach(test => {
      test.results.forEach(result => {
        if (!modelStats[result.model]) {
          modelStats[result.model] = {
            model: result.model,
            totalTests: 0,
            successCount: 0,
            errorCount: 0,
            totalRating: 0,
            ratingCount: 0,
            winCount: 0,
            totalCost: 0,
            totalLatency: 0
          };
        }

        const stats = modelStats[result.model];
        stats.totalTests++;

        if (result.status === 'success') {
          stats.successCount++;
          stats.totalCost += result.cost;
          stats.totalLatency += result.latency;

          if (result.rating !== null) {
            stats.totalRating += result.rating;
            stats.ratingCount++;
          }
        } else {
          stats.errorCount++;
        }

        if (test.winner === result.model) {
          stats.winCount++;
        }
      });
    });

    // 計算平均值並排序
    const leaderboard = Object.values(modelStats).map(stats => ({
      model: stats.model,
      totalTests: stats.totalTests,
      avgRating: stats.ratingCount > 0 ? (stats.totalRating / stats.ratingCount).toFixed(2) : 'N/A',
      winRate: stats.totalTests > 0 ? ((stats.winCount / stats.totalTests) * 100).toFixed(1) : '0.0',
      successRate: stats.totalTests > 0 ? ((stats.successCount / stats.totalTests) * 100).toFixed(1) : '0.0',
      avgCost: stats.successCount > 0 ? (stats.totalCost / stats.successCount).toFixed(6) : '0',
      avgLatency: stats.successCount > 0 ? Math.round(stats.totalLatency / stats.successCount) : 0
    }));

    // 按平均評分排序（評分高的在前）
    leaderboard.sort((a, b) => {
      if (a.avgRating === 'N/A' && b.avgRating === 'N/A') return 0;
      if (a.avgRating === 'N/A') return 1;
      if (b.avgRating === 'N/A') return -1;
      return parseFloat(b.avgRating) - parseFloat(a.avgRating);
    });

    return leaderboard;
  });
}

module.exports = {
  runComparison,
  rateResponse,
  getComparisons,
  getComparison,
  getLeaderboard
};
