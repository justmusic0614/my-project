/**
 * Cost Ledger — 成本記帳系統
 * 追蹤每次 Pipeline run 的 API 呼叫次數和 LLM token 費用
 *
 * 使用方式：
 *   const costLedger = require('./backend/cost-ledger');
 *   costLedger.init(config.costLedger);
 *   costLedger.recordApiCall('perplexity');
 *   costLedger.recordLlmUsage('haiku', { input_tokens: 500, output_tokens: 200 });
 *   costLedger.flush();  // 寫入磁碟
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../data/cost-ledger');

class CostLedger {
  constructor() {
    this.config = {
      enabled: true,
      usdToTwd: 33,
      dailyBudgetUsd: 1.0,
      llmPrices: {
        haiku_input: 0.00000025,
        haiku_output: 0.00000125,
        sonnet_input: 0.000003,
        sonnet_output: 0.000015
      }
    };
    this.currentRun = null;
    this.ensureDir();
  }

  init(config = {}) {
    Object.assign(this.config, config);
    return this;
  }

  ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /**
   * 開始一次新的 Pipeline run
   */
  startRun() {
    this.currentRun = {
      runId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      apiCalls: {
        perplexity: 0,
        fmp: 0,
        finmind: 0
      },
      llm: {
        haiku: { input_tokens: 0, output_tokens: 0, cost_usd: 0 },
        sonnet: { input_tokens: 0, output_tokens: 0, cost_usd: 0 }
      },
      total_cost_usd: 0,
      total_cost_twd: 0
    };
    return this.currentRun.runId;
  }

  /**
   * 記錄一次 API 呼叫
   * @param {string} provider - perplexity / fmp / finmind
   */
  recordApiCall(provider) {
    if (!this.currentRun) this.startRun();
    if (this.currentRun.apiCalls[provider] !== undefined) {
      this.currentRun.apiCalls[provider]++;
    }
  }

  /**
   * 記錄 LLM token 使用量
   * @param {string} model - haiku / sonnet
   * @param {{ input_tokens: number, output_tokens: number }} usage
   */
  recordLlmUsage(model, usage) {
    if (!this.currentRun) this.startRun();
    const entry = this.currentRun.llm[model];
    if (!entry) return;

    entry.input_tokens += usage.input_tokens || 0;
    entry.output_tokens += usage.output_tokens || 0;

    const prices = this.config.llmPrices;
    entry.cost_usd =
      entry.input_tokens * (prices[`${model}_input`] || 0) +
      entry.output_tokens * (prices[`${model}_output`] || 0);
  }

  /**
   * 計算當前 run 的總成本
   */
  calculateTotal() {
    if (!this.currentRun) return 0;

    const llmCost =
      this.currentRun.llm.haiku.cost_usd +
      this.currentRun.llm.sonnet.cost_usd;

    // Perplexity sonar: ~$0.005/call
    const perplexityCost = this.currentRun.apiCalls.perplexity * 0.005;

    this.currentRun.total_cost_usd = parseFloat((llmCost + perplexityCost).toFixed(6));
    this.currentRun.total_cost_twd = parseFloat(
      (this.currentRun.total_cost_usd * this.config.usdToTwd).toFixed(2)
    );

    return this.currentRun.total_cost_usd;
  }

  /**
   * 將當前 run 追加寫入當日帳本
   */
  flush() {
    if (!this.currentRun) return;

    this.calculateTotal();
    this.currentRun.finishedAt = new Date().toISOString();

    const today = new Date().toISOString().slice(0, 10);
    const filePath = path.join(DATA_DIR, `${today}.json`);

    let daily = { date: today, runs: [], dailyTotal: { cost_usd: 0, cost_twd: 0 } };
    if (fs.existsSync(filePath)) {
      try {
        daily = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {
        // 損壞的帳本，重建
      }
    }

    daily.runs.push(this.currentRun);
    daily.dailyTotal.cost_usd = parseFloat(
      daily.runs.reduce((sum, r) => sum + (r.total_cost_usd || 0), 0).toFixed(6)
    );
    daily.dailyTotal.cost_twd = parseFloat(
      (daily.dailyTotal.cost_usd * this.config.usdToTwd).toFixed(2)
    );

    // Atomic write
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(daily, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);

    this.currentRun = null;
    return daily;
  }

  /**
   * 檢查今日是否超過預算
   * @returns {{ overBudget: boolean, spent: number, budget: number }}
   */
  checkBudget() {
    const today = new Date().toISOString().slice(0, 10);
    const filePath = path.join(DATA_DIR, `${today}.json`);

    let spent = 0;
    if (fs.existsSync(filePath)) {
      try {
        const daily = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        spent = daily.dailyTotal?.cost_usd || 0;
      } catch (e) {
        // ignore
      }
    }

    // 加上當前 run 的累計（如果有的話）
    if (this.currentRun) {
      this.calculateTotal();
      spent += this.currentRun.total_cost_usd;
    }

    return {
      overBudget: spent >= this.config.dailyBudgetUsd,
      spent: parseFloat(spent.toFixed(6)),
      budget: this.config.dailyBudgetUsd
    };
  }

  /**
   * 取得當日成本摘要（供 Telegram 報告附加）
   */
  getDailySummary() {
    const today = new Date().toISOString().slice(0, 10);
    const filePath = path.join(DATA_DIR, `${today}.json`);

    if (!fs.existsSync(filePath)) {
      return `💰 本日成本：$0.00 USD（尚無記錄）`;
    }

    try {
      const daily = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const runs = daily.runs.length;
      const usd = daily.dailyTotal.cost_usd.toFixed(4);
      const twd = daily.dailyTotal.cost_twd.toFixed(2);
      return `💰 本日成本：$${usd} USD（≈${twd} TWD）| ${runs} 次 run`;
    } catch (e) {
      return `💰 本日成本：讀取失敗`;
    }
  }

  /**
   * FMP 日配額追蹤（免費版 250 req/day）
   */
  checkFmpQuota() {
    const today = new Date().toISOString().slice(0, 10);
    const quotaPath = path.join(DATA_DIR, 'fmp-quota.json');

    let quota = { date: today, calls: 0 };
    if (fs.existsSync(quotaPath)) {
      try {
        quota = JSON.parse(fs.readFileSync(quotaPath, 'utf8'));
        if (quota.date !== today) {
          quota = { date: today, calls: 0 }; // 新的一天，重置
        }
      } catch (e) {
        quota = { date: today, calls: 0 };
      }
    }

    return { calls: quota.calls, remaining: 200 - quota.calls, canCall: quota.calls < 200 };
  }

  incrementFmpQuota(count = 1) {
    const today = new Date().toISOString().slice(0, 10);
    const quotaPath = path.join(DATA_DIR, 'fmp-quota.json');

    let quota = { date: today, calls: 0 };
    if (fs.existsSync(quotaPath)) {
      try {
        quota = JSON.parse(fs.readFileSync(quotaPath, 'utf8'));
        if (quota.date !== today) {
          quota = { date: today, calls: 0 };
        }
      } catch (e) {
        // ignore
      }
    }

    quota.calls += count;
    fs.writeFileSync(quotaPath, JSON.stringify(quota, null, 2), 'utf8');
  }
}

// 單例
const costLedger = new CostLedger();

module.exports = costLedger;
module.exports.CostLedger = CostLedger;
