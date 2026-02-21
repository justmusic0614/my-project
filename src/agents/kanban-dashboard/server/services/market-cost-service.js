const fs = require('fs');
const path = require('path');

// market-digest cost-ledger 目錄（相對 services/ 目錄）
const COST_LEDGER_DIR = path.join(__dirname, '../../../../agents/market-digest/data/cost-ledger');

/**
 * 讀取 market-digest 指定日期的成本記錄
 * @param {string} date - YYYY-MM-DD 格式
 * @returns {{ llm_input_tokens, llm_output_tokens, llm_cost_usd, external_api_calls, total_cost_usd, total_cost_twd } | null}
 * 若無記錄（非交易日）返回 null
 */
function getDailyCost(date) {
  const filePath = path.join(COST_LEDGER_DIR, date + '.json');
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const runs = data.runs || [];

    let llm_input_tokens = 0;
    let llm_output_tokens = 0;
    let llm_cost_usd = 0;
    const external_api_calls = {};
    let total_cost_usd = 0;
    let total_cost_twd = 0;

    for (const run of runs) {
      // 累計 LLM token 和費用
      const llm = run.llm || {};
      for (const model of Object.values(llm)) {
        llm_input_tokens += model.input_tokens || 0;
        llm_output_tokens += model.output_tokens || 0;
        llm_cost_usd += model.cost_usd || 0;
      }
      // 累計外部 API 呼叫次數
      const apiCalls = run.apiCalls || {};
      for (const [key, val] of Object.entries(apiCalls)) {
        external_api_calls[key] = (external_api_calls[key] || 0) + (val || 0);
      }
      total_cost_usd += run.total_cost_usd || 0;
      total_cost_twd += run.total_cost_twd || 0;
    }

    return {
      llm_input_tokens,
      llm_output_tokens,
      llm_cost_usd: Math.round(llm_cost_usd * 1e6) / 1e6,
      external_api_calls,
      total_cost_usd: Math.round(total_cost_usd * 1e6) / 1e6,
      total_cost_twd: Math.round(total_cost_twd * 100) / 100,
    };
  } catch (e) {
    return null;
  }
}

module.exports = { getDailyCost };
