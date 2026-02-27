/**
 * TriggerEngine — 風險觸發條件引擎
 *
 * 結構化規則：如果 A 條件成立 → B 動作建議
 * 讀取 Phase Engine state 的 streak 計數器
 */

'use strict';

const { createLogger } = require('../shared/logger');

const logger = createLogger('analyzer:trigger');

const TRIGGER_RULES = [
  {
    id: 'VIX_CORRECTION',
    impact: 'HIGH',
    condition: (ind, state) => ind.vix > 22 && (state.vixAbove22Days || 0) >= 2,
    action: '減少高 Beta 部位，考慮波動率避險',
    format: (ind) => `VIX ${ind.vix?.toFixed(1)} > 22（連續 ≥2 日）`
  },
  {
    id: 'SPX_BELOW_MA50',
    impact: 'HIGH',
    condition: (ind, state) => ind.spxClose < ind.spxMa50 && (state.spxBelowMa50Days || 0) >= 1,
    action: '確認趨勢轉弱，降低整體曝險',
    format: (ind) => `SPX ${ind.spxClose?.toFixed(0)} < MA50 ${ind.spxMa50?.toFixed(0)}`
  },
  {
    id: 'HY_SPREAD_STRESS',
    impact: 'MEDIUM',
    condition: (ind) => ind.hySpread5dChange != null && ind.hySpread5dChange > 0.3,
    action: '信用市場惡化，減少小型股和高收益債部位',
    format: (ind) => `HY Spread 5日增 +${ind.hySpread5dChange?.toFixed(2)}`
  },
  {
    id: 'SPX_ABOVE_MA200',
    impact: 'LOW',
    condition: (ind) => ind.spxClose != null && ind.spxMa200 != null && ind.spxClose > ind.spxMa200 * 1.10,
    action: 'SPX 遠離 MA200 超過 10%，注意均值回歸風險',
    format: (ind) => `SPX 高於 MA200 ${(((ind.spxClose / ind.spxMa200) - 1) * 100).toFixed(1)}%`
  }
];

/**
 * 評估所有觸發條件
 * @param {object} indicators - 市場指標
 * @param {object} phaseState - Phase Engine 持久化 state
 * @returns {Array<{triggered:boolean, id:string, impact:string, action:string, detail:string}>}
 */
function evaluate(indicators, phaseState = {}) {
  if (!indicators) return [];

  const results = [];
  for (const rule of TRIGGER_RULES) {
    const triggered = rule.condition(indicators, phaseState);
    if (triggered) {
      results.push({
        triggered: true,
        id: rule.id,
        impact: rule.impact,
        action: rule.action,
        detail: rule.format(indicators)
      });
    }
  }

  logger.info(`Triggers evaluated: fired=${results.length}${results.length > 0 ? ` (${results.map(r => r.id).join(', ')})` : ' (all clear)'}`);

  return results;
}

module.exports = { evaluate, TRIGGER_RULES };
