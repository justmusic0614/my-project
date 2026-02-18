/**
 * DailyRenderer — Daily Brief 格式渲染器
 * Phase 4 第一步：將 Phase 3 的輸出組裝為標準 Daily Brief 格式
 *
 * Daily Brief 格式（10 個區塊，無數據時自動隱藏）：
 *   === Daily Market Brief YYYY-MM-DD ===
 *   📌 Daily_Snapshot
 *   📈 市場數據
 *   🌐 Macro_Policy
 *   📈 Market_Regime
 *   🔹 Geopolitics（無事件時隱藏）
 *   🔹 Structural_Theme
 *   🔹 Equity_Market（Winners / Losers）
 *   🔹 Cross_Asset
 *   🇹🇼 Taiwan_Market（法人 + 融資 + 板塊）
 *   🎯 Watchlist_Focus
 *   📅 Event_Calendar
 *   ━━ 免責聲明
 *
 * 設計原則：
 *   - 無數據的 optional 區塊自動隱藏（不顯示 N/A 佔位符）
 *   - 降級數據用 [DELAYED]/[UNVERIFIED] 標記
 *   - 所有數字格式化（千分位、小數點、漲跌箭頭）
 */

'use strict';

const { createLogger } = require('../shared/logger');

const logger = createLogger('renderer:daily');

// 漲跌箭頭
const UP   = '▲';
const DOWN = '▼';
const FLAT = '─';

class DailyRenderer {
  /**
   * 主渲染方法
   * @param {object} briefData - Phase 3 組裝後的完整資料
   * @param {object} briefData.marketData     - validator 輸出的市場數據
   * @param {object} briefData.aiResult       - ai-analyzer 輸出（dailySnapshot, marketRegime...）
   * @param {object[]} briefData.rankedNews   - 排序後新聞（帶 aiSummary）
   * @param {object} briefData.watchlist      - watchlist.json 資料
   * @param {object[]} briefData.events       - 事件日曆
   * @param {object} briefData.secFilings     - SEC EDGAR 重大申報
   * @param {object} briefData.institutionalData - 台股法人數據
   * @returns {string} 完整的 Daily Brief 文字
   */
  render(briefData = {}) {
    const {
      marketData       = {},
      aiResult         = {},
      rankedNews       = [],
      watchlist        = [],
      events           = [],
      secFilings       = [],
      institutionalData = {},
      date
    } = briefData;

    const reportDate = date || marketData.date || this._today();
    const lines = [];

    // ── Header ───────────────────────────────────────────────────────────
    lines.push(`=== Daily Market Brief ${reportDate} ===`);
    lines.push('');

    // ── 1. Daily Snapshot ─────────────────────────────────────────────────
    if (aiResult.dailySnapshot) {
      lines.push('📌 Daily_Snapshot');
      const snapshot = aiResult.dailySnapshot;
      // 每句為一個 bullet（按句號/換行分割）
      const sentences = snapshot.split(/[。\n]/).map(s => s.trim()).filter(Boolean);
      sentences.slice(0, 3).forEach(s => lines.push(`  • ${s}`));
      lines.push('');
    }

    // ── 2. 市場數據 ────────────────────────────────────────────────────────
    const marketLines = this._renderMarketData(marketData);
    if (marketLines.length > 0) {
      lines.push('📈 市場數據');
      marketLines.forEach(l => lines.push(l));
      lines.push('');
    }

    // ── 3. Macro Policy ───────────────────────────────────────────────────
    const macroLines = this._renderMacroPolicy(marketData);
    if (macroLines.length > 0) {
      lines.push('🌐 Macro_Policy');
      macroLines.forEach(l => lines.push(l));
      lines.push('');
    }

    // ── 4. Market Regime ──────────────────────────────────────────────────
    if (aiResult.marketRegime) {
      const regimeEmoji = aiResult.marketRegime === 'Risk-on' ? '🟢' : aiResult.marketRegime === 'Risk-off' ? '🔴' : '🟡';
      lines.push(`📈 Market_Regime: ${regimeEmoji} ${aiResult.marketRegime}`);
      if (aiResult.structuralTheme) {
        lines.push(`  Structural Theme: ${aiResult.structuralTheme}`);
      }
      if (Array.isArray(aiResult.keyInsights) && aiResult.keyInsights.length > 0) {
        aiResult.keyInsights.slice(0, 3).forEach(insight => lines.push(`  • ${insight}`));
      }
      lines.push('');
    }

    // ── 5. Geopolitics（有 P0 地緣事件才顯示）────────────────────────────
    const geoNews = rankedNews.filter(n => n.importance === 'P0' && this._isGeopolitics(n));
    if (geoNews.length > 0) {
      lines.push('🔹 Geopolitics');
      geoNews.slice(0, 3).forEach(n => {
        lines.push(`  • ${n.title}${n.aiSummary ? `（${n.aiSummary}）` : ''}`);
      });
      lines.push('');
    }

    // ── 6. Structural Theme（P0 + P1 重要新聞）────────────────────────────
    const themeNews = rankedNews.filter(n => (n.importance === 'P0' || n.importance === 'P1') && !this._isGeopolitics(n));
    if (themeNews.length > 0) {
      lines.push('🔹 Structural_Theme');
      themeNews.slice(0, 5).forEach(n => {
        const badge = n.importance === 'P0' ? '[重大] ' : '';
        lines.push(`  • ${badge}${n.title}${n.aiSummary ? `（${n.aiSummary}）` : ''}`);
      });
      lines.push('');
    }

    // ── 7. Equity Market（漲跌幅 Top5）────────────────────────────────────
    const equityLines = this._renderEquityMarket(marketData, briefData.gainersLosers);
    if (equityLines.length > 0) {
      lines.push('🔹 Equity_Market');
      equityLines.forEach(l => lines.push(l));
      lines.push('');
    }

    // ── 8. Cross Asset ────────────────────────────────────────────────────
    const crossLines = this._renderCrossAsset(marketData);
    if (crossLines.length > 0) {
      lines.push('🔹 Cross_Asset');
      crossLines.forEach(l => lines.push(l));
      lines.push('');
    }

    // ── 9. Taiwan Market ──────────────────────────────────────────────────
    const twLines = this._renderTaiwanMarket(marketData, institutionalData);
    if (twLines.length > 0) {
      lines.push('🇹🇼 Taiwan_Market');
      twLines.forEach(l => lines.push(l));
      lines.push('');
    }

    // ── 10. Watchlist Focus ───────────────────────────────────────────────
    const wlLines = this._renderWatchlist(watchlist, institutionalData);
    if (wlLines.length > 0) {
      lines.push('🎯 Watchlist_Focus');
      wlLines.forEach(l => lines.push(l));
      lines.push('');
    }

    // ── 11. Event Calendar ────────────────────────────────────────────────
    const eventLines = this._renderEvents(events, secFilings);
    if (eventLines.length > 0) {
      lines.push('📅 Event_Calendar');
      eventLines.forEach(l => lines.push(l));
      lines.push('');
    }

    // ── Footer ────────────────────────────────────────────────────────────
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push('免責聲明：本報告僅供資訊參考，不構成投資建議');

    const text = lines.join('\n');
    logger.info(`daily brief rendered: ${lines.length} lines, ${text.length} chars`);
    return text;
  }

  // ── 私有渲染方法 ──────────────────────────────────────────────────────────

  _renderMarketData(md) {
    const lines = [];

    // TAIEX
    if (md.TAIEX?.value != null) {
      const vol = md.taiexVolume != null ? ` | Vol: ${this._fmtBillion(md.taiexVolume)}bn` : '';
      lines.push(`• TAIEX: ${this._fmtNum(md.TAIEX.value)} ${this._fmtChg(md.TAIEX.changePct)}${vol}${this._degradeLabel(md.TAIEX)}`);
    }

    // SP500
    if (md.SP500?.value != null) {
      lines.push(`• S&P 500: ${this._fmtNum(md.SP500.value)} ${this._fmtChg(md.SP500.changePct)}${this._degradeLabel(md.SP500)}`);
    }

    // NASDAQ
    if (md.NASDAQ?.value != null) {
      lines.push(`• Nasdaq: ${this._fmtNum(md.NASDAQ.value)} ${this._fmtChg(md.NASDAQ.changePct)}${this._degradeLabel(md.NASDAQ)}`);
    }

    // DJI
    if (md.DJI?.value != null) {
      lines.push(`• Dow: ${this._fmtNum(md.DJI.value)} ${this._fmtChg(md.DJI.changePct)}${this._degradeLabel(md.DJI)}`);
    }

    // USD/TWD
    if (md.USDTWD?.value != null) {
      const dir = (md.USDTWD.changePct ?? 0) < 0 ? '升' : '貶';
      const absPct = Math.abs(md.USDTWD.changePct ?? 0).toFixed(2);
      lines.push(`• USD/TWD: ${md.USDTWD.value.toFixed(2)} 台幣${dir}${absPct}%${this._degradeLabel(md.USDTWD)}`);
    }

    return lines;
  }

  _renderMacroPolicy(md) {
    const parts = [];
    if (md.US10Y?.value != null)  parts.push(`US 10Y: ${md.US10Y.value.toFixed(2)}`);
    if (md.DXY?.value != null)    parts.push(`DXY: ${md.DXY.value.toFixed(1)}`);
    if (md.VIX?.value != null)    parts.push(`VIX: ${md.VIX.value.toFixed(1)}`);
    if (parts.length === 0) return [];
    return [`• ${parts.join(' | ')}`];
  }

  _renderEquityMarket(md, gainersLosers = {}) {
    const lines = [];
    const { twGainers = [], twLosers = [], usGainers = [], usLosers = [] } = gainersLosers;

    const hasAnyData = twGainers.length > 0 || usGainers.length > 0 || twLosers.length > 0 || usLosers.length > 0;
    if (hasAnyData) {
      lines.push('  Winners:');
      if (twGainers.length > 0) {
        const tw = twGainers.slice(0, 5).map(s => `${s.name || s.symbol}${s.changePct != null ? ` ${this._fmtChg(s.changePct)}` : ''}`).join('、');
        lines.push(`    台股: ${tw}`);
      }
      if (usGainers.length > 0) {
        const us = usGainers.slice(0, 5).map(s => `${s.symbol}${s.changePct != null ? ` ${this._fmtChg(s.changePct)}` : ''}`).join('、');
        lines.push(`    美股: ${us}`);
      } else if (twGainers.length > 0) {
        lines.push('    美股: [需升級 FMP 方案]');
      }

      lines.push('  Losers:');
      if (twLosers.length > 0) {
        const tw = twLosers.slice(0, 5).map(s => `${s.name || s.symbol}${s.changePct != null ? ` ${this._fmtChg(s.changePct)}` : ''}`).join('、');
        lines.push(`    台股: ${tw}`);
      }
      if (usLosers.length > 0) {
        const us = usLosers.slice(0, 5).map(s => `${s.symbol}${s.changePct != null ? ` ${this._fmtChg(s.changePct)}` : ''}`).join('、');
        lines.push(`    美股: ${us}`);
      } else if (twLosers.length > 0) {
        lines.push('    美股: [需升級 FMP 方案]');
      }
    }

    return lines;
  }

  _renderCrossAsset(md) {
    const lines = [];
    if (md.GOLD?.value != null)    lines.push(`• 黃金: $${this._fmtNum(md.GOLD.value)} ${this._fmtChg(md.GOLD.changePct)}`);
    if (md.OIL_WTI?.value != null) lines.push(`• WTI 原油: $${md.OIL_WTI.value.toFixed(2)} ${this._fmtChg(md.OIL_WTI.changePct)}`);
    if (md.COPPER?.value != null)  lines.push(`• 銅: $${md.COPPER.value.toFixed(3)} ${this._fmtChg(md.COPPER.changePct)}`);
    if (md.BTC?.value != null)     lines.push(`• BTC: $${this._fmtNum(Math.round(md.BTC.value))} ${this._fmtChg(md.BTC.changePct)}`);
    return lines;
  }

  _renderTaiwanMarket(md, inst = {}) {
    const lines = [];

    // 加權指數摘要（已在市場數據顯示，這裡補充成交量說明）
    if (md.taiexVolume != null) {
      lines.push(`• 成交量: ${this._fmtBillion(md.taiexVolume)} 億`);
    }

    // 三大法人
    if (inst.foreign != null || inst.trust != null || inst.dealer != null) {
      const foreign = inst.foreign != null ? `外資 ${this._fmtInst(inst.foreign)}` : null;
      const trust   = inst.trust   != null ? `投信 ${this._fmtInst(inst.trust)}`   : null;
      const dealer  = inst.dealer  != null ? `自營 ${this._fmtInst(inst.dealer)}`  : null;
      const parts   = [foreign, trust, dealer].filter(Boolean);
      if (parts.length > 0) lines.push(`• 三大法人: ${parts.join(' | ')}`);
    }

    // 融資融券（FinMind 全市場版優先，含絕對值+變化量）
    if (inst.marginTotal) {
      const mt    = inst.marginTotal;
      const mBal  = (mt.marginBalance / 1e8).toFixed(1);  // 元 → 億
      const mChg  = (mt.marginChange  / 1e8).toFixed(1);  // 元 → 億
      const mSign = mt.marginChange >= 0 ? '+' : '';
      const sBal  = mt.shortBalance.toLocaleString();
      const sChg  = mt.shortChange;
      const sSign = sChg >= 0 ? '+' : '';
      lines.push(`• 融資餘額: ${mBal}億（${mSign}${mChg}）| 融券餘額: ${sBal}張（${sSign}${sChg.toLocaleString()}）`);
    } else if (md.margin?.marginBalance != null) {
      // TWSE fallback（舊格式）
      const margin = this._fmtBillion(md.margin.marginBalance / 1e8);
      const short  = md.margin.shortBalance != null ? `，融券 ${this._fmtBillion(md.margin.shortBalance / 1e8)} 億` : '';
      lines.push(`• 融資餘額: ${margin} 億${short}`);
    }

    return lines;
  }

  _renderWatchlist(watchlist, inst = {}) {
    const lines = [];
    if (!Array.isArray(watchlist) || watchlist.length === 0) return lines;

    const tw50Prices = inst.tw50Prices || {};

    for (const item of watchlist.slice(0, 8)) {
      const symbol = item.symbol || item.stockId;
      const price  = item.price ?? tw50Prices[symbol]?.close;
      const chgPct = item.changePct ?? tw50Prices[symbol]?.changePct;

      let line = `• ${symbol}`;
      if (item.name) line += ` ${item.name}`;
      if (price  != null) line += ` ${price}`;
      if (chgPct != null) line += ` ${this._fmtChg(chgPct)}`;

      // 外資/投信籌碼（若有）
      const instData = tw50Prices[symbol];
      if (instData?.foreignNet != null) {
        line += ` | 外資${this._fmtInst(instData.foreignNet)}`;
      }

      lines.push(line);
    }
    return lines;
  }

  _renderEvents(events = [], secFilings = []) {
    const lines = [];

    // 財報 & 經濟日曆（FMP）
    const earningsEvents = events.filter(e => e.type === 'earnings').slice(0, 5);
    const econEvents     = events.filter(e => e.type === 'economic').slice(0, 5);

    if (earningsEvents.length > 0) {
      lines.push('  財報:');
      earningsEvents.forEach(e => {
        lines.push(`  • ${e.date} ${e.company || e.symbol}${e.estimate ? `（EPS 預估 $${e.estimate}）` : ''}`);
      });
    }

    if (econEvents.length > 0) {
      lines.push('  經濟數據:');
      econEvents.forEach(e => {
        lines.push(`  • ${e.date} ${e.name || e.event}${e.actual ? `（實際 ${e.actual}）` : ''}`);
      });
    }

    // SEC 重大申報（P0/P1）
    const importantFilings = secFilings.filter(f => f.importance === 'P0' || f.importance === 'P1').slice(0, 3);
    if (importantFilings.length > 0) {
      lines.push('  SEC 申報:');
      importantFilings.forEach(f => {
        lines.push(`  • [${f.formType}] ${f.company}${f.description ? `（${f.description.slice(0, 40)}）` : ''}`);
      });
    }

    return lines;
  }

  // ── 格式化輔助 ────────────────────────────────────────────────────────────

  _fmtNum(n) {
    if (n == null) return 'N/A';
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  _fmtBillion(n) {
    if (n == null) return 'N/A';
    return (n / 1e8).toFixed(0);
  }

  _fmtChg(pct) {
    if (pct == null) return '';
    const arrow = pct > 0.05 ? UP : pct < -0.05 ? DOWN : FLAT;
    const sign  = pct >= 0 ? '+' : '';
    return `${arrow}${sign}${pct.toFixed(2)}%`;
  }

  _fmtInst(net) {
    if (net == null) return '';
    const lots   = Math.round(Math.abs(net) / 1000);
    const action = net >= 0 ? '買超' : '賣超';
    return `${action} ${lots.toLocaleString()}張`;
  }

  _degradeLabel(dataPoint) {
    if (!dataPoint?.degraded) return '';
    if (dataPoint.degraded === 'DELAYED')    return ' [DELAYED]';
    if (dataPoint.degraded === 'UNVERIFIED') return ' [UNVERIFIED]';
    return '';
  }

  _isGeopolitics(news) {
    const geoKws = ['war', '戰爭', 'military', 'sanctions', '制裁', 'Taiwan Strait', '台海', 'invasion', '入侵', 'nuclear', 'geopolit'];
    const text = `${news.title} ${news.summary || ''}`.toLowerCase();
    return geoKws.some(kw => text.includes(kw.toLowerCase()));
  }

  _today() {
    return new Date().toISOString().slice(0, 10);
  }
}

module.exports = new DailyRenderer();
module.exports.DailyRenderer = DailyRenderer;
