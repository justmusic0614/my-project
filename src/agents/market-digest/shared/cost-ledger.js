/**
 * Cost Ledger — 成本記帳系統 (shared/ 版)
 * 追蹤每次 Pipeline run 的 API 呼叫次數和 LLM token 費用
 *
 * 從 backend/cost-ledger.js 遷移，擴展支援新 Pipeline API providers
 *
 * 使用方式：
 *   const costLedger = require('./shared/cost-ledger');
 *   costLedger.init(config.costLedger);
 *   costLedger.startRun('phase1');
 *   costLedger.recordApiCall('fmp');
 *   costLedger.recordApiCall('secEdgar');
 *   costLedger.recordLlmUsage('haiku', { input_tokens: 500, output_tokens: 200 });
 *   costLedger.flush();  // 寫入磁碟
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../data/cost-ledger');

// Perplexity sonar 每次呼叫估算成本（包月方案計 $0.005/call 估算）
const PERPLEXITY_COST_PER_CALL = 0.005;

// 台北時區日期（UTC+8），與 Pipeline 的 _today() 保持一致
const _today = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

class CostLedger {
  constructor() {
    this.config = {
      enabled: true,
      usdToTwd: 33,
      dailyBudgetUsd: 2.0,
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
   * @param {string} phase - phase1 / phase2 / phase3 / phase4 / weekly / weekend
   */
  startRun(phase = 'unknown') {
    this.currentRun = {
      runId: crypto.randomUUID(),
      phase,
      startedAt: new Date().toISOString(),
      apiCalls: {
        perplexity: 0,
        fmp: 0,
        finmind: 0,
        twse: 0,
        mops: 0,
        yahoo: 0,
        secEdgar: 0,
        rss: 0
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
   * @param {string} provider - perplexity / fmp / finmind / twse / mops / yahoo / secEdgar / rss
   * @param {number} [count=1] - 呼叫次數（批次操作用）
   */
  recordApiCall(provider, count = 1) {
    if (!this.currentRun) this.startRun();
    if (this.currentRun.apiCalls[provider] !== undefined) {
      this.currentRun.apiCalls[provider] += count;
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

    const perplexityCost = this.currentRun.apiCalls.perplexity * PERPLEXITY_COST_PER_CALL;

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

    const today = _today();
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
    const today = _today();
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
    const today = _today();
    const filePath = path.join(DATA_DIR, `${today}.json`);

    if (!fs.existsSync(filePath)) {
      return `💰 本日成本：$0.00 USD（尚無記錄）`;
    }

    try {
      const daily = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const runs = daily.runs.length;
      const usd = daily.dailyTotal.cost_usd.toFixed(4);
      const twd = daily.dailyTotal.cost_twd.toFixed(2);
      const budget = this.config.dailyBudgetUsd.toFixed(2);
      const pct = ((daily.dailyTotal.cost_usd / this.config.dailyBudgetUsd) * 100).toFixed(1);
      return `💰 本日成本：$${usd}/$${budget} USD（${pct}%）≈${twd} TWD | ${runs} 次 run`;
    } catch (e) {
      return `💰 本日成本：讀取失敗`;
    }
  }

  /**
   * FMP 日配額追蹤（免費版 200 req/day）
   */
  checkFmpQuota() {
    const today = _today();
    const quotaPath = path.join(DATA_DIR, 'fmp-quota.json');

    let quota = { date: today, calls: 0 };
    if (fs.existsSync(quotaPath)) {
      try {
        quota = JSON.parse(fs.readFileSync(quotaPath, 'utf8'));
        if (quota.date !== today) {
          quota = { date: today, calls: 0 };
        }
      } catch (e) {
        quota = { date: today, calls: 0 };
      }
    }

    return { calls: quota.calls, remaining: 200 - quota.calls, canCall: quota.calls < 200 };
  }

  incrementFmpQuota(count = 1) {
    const today = _today();
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
