/**
 * ContradictionDetector — 市場矛盾訊號偵測器
 *
 * 4 種矛盾訊號：
 * 1. NARROW_BREADTH_RALLY：SPX 在 20d_high 2% 內但 breadth==NARROW
 * 2. CREDIT_DIVERGENCE：SPX 5d 漲但 HY spread 5d 也升
 * 3. USD_EQUITY_RALLY：DXY 5d 升且 SPX 5d 升
 * 4. GROWTH_HEDGE_COEXIST：黃金和美股同時接近 20d_high
 */

'use strict';

const CONTRADICTION_RULES = [
  {
    id: 'NARROW_BREADTH_RALLY',
    description: 'SPX near 20d high but breadth is narrow',
    implication: '上漲集中在少數個股，回檔風險升高',
    check: (ind) => {
      if (ind.spxClose == null || ind.spx20dHigh == null) return false;
      const pctFromHigh = (ind.spx20dHigh - ind.spxClose) / ind.spx20dHigh * 100;
      return pctFromHigh <= 2 && ind.breadthState === 'NARROW';
    }
  },
  {
    id: 'CREDIT_DIVERGENCE',
    description: 'SPX rising but HY spread also widening',
    implication: '信用市場發出警告，股市上漲可能不可持續',
    check: (ind) => {
      if (ind.spx5dChange == null || ind.hySpread5dChange == null) return false;
      return ind.spx5dChange > 0 && ind.hySpread5dChange > 0.1;
    }
  },
  {
    id: 'USD_EQUITY_RALLY',
    description: 'USD and equities both rising',
    implication: '美元走強通常壓制企業海外獲利，雙升不可持久',
    check: (ind) => {
      if (ind.dxy5dChange == null || ind.spx5dChange == null) return false;
      return ind.dxy5dChange > 0.5 && ind.spx5dChange > 0;
    }
  },
  {
    id: 'GROWTH_HEDGE_COEXIST',
    description: 'Gold and equities both near 20d highs',
    implication: '避險資產與風險資產同時走強，市場方向不明',
    check: (ind) => {
      if (ind.spxClose == null || ind.spx20dHigh == null ||
          ind.goldClose == null || ind.gold20dHigh == null) return false;
      const spxNearHigh = (ind.spx20dHigh - ind.spxClose) / ind.spx20dHigh * 100 <= 2;
      const goldNearHigh = (ind.gold20dHigh - ind.goldClose) / ind.gold20dHigh * 100 <= 3;
      return spxNearHigh && goldNearHigh;
    }
  }
];

/**
 * 偵測矛盾訊號
 * @param {object} indicators - 市場指標
 * @returns {Array<{id:string, description:string, implication:string}>}
 */
function detect(indicators) {
  if (!indicators) return [];

  return CONTRADICTION_RULES
    .filter(rule => rule.check(indicators))
    .map(({ id, description, implication }) => ({ id, description, implication }));
}

module.exports = { detect };
