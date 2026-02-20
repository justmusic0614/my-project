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
      marketContext     = {},
      date
    } = briefData;

    const reportDate = date || marketData.date || this._today();
    const mc = marketContext || {};
    const lines = [];

    // ── Header ───────────────────────────────────────────────────────────
    lines.push(`=== Daily Market Brief ${reportDate} ===`);

    // ── 休市提示行 ───────────────────────────────────────────────────────
    if (mc.twse && !mc.twse.isTradingDay) {
      lines.push(`🔴 今日台股休市（${mc.twse.reason || ''}）`);
    }
    if (mc.xnys && !mc.xnys.isTradingDay) {
      lines.push(`🔴 今日美股休市（${mc.xnys.reason || ''}）`);
    }
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
    // 改用 AI 分類的 category 欄位（Stage 1 Haiku 判斷）
    const geoNews = rankedNews.filter(n =>
      n.importance === 'P0' && n.category === 'geopolitics'
    );
    if (geoNews.length > 0) {
      lines.push('🔹 Geopolitics');
      geoNews.slice(0, 3).forEach(n => {
        lines.push(`  • ${n.aiSummary || n.title}`);
      });
      lines.push('');
    }

    // ── 6. Market Insights（產業熱點 + 市場情緒 + 貨幣利率）────────────────────────────
    const insightLines = this._renderMarketInsights(
      aiResult,
      marketData,
      briefData.institutionalData || {},
      briefData.marketHistory || null  // Phase 2 才會有，現階段為 null
    );
    if (insightLines.length > 0) {
      lines.push('🔹 Market_Insights');
      lines.push(...insightLines);
      lines.push('');
    }

    // ── 7. Equity Market（漲跌幅 Top5）────────────────────────────────────
    // ※ FMP gainers/losers 為付費端點，免費版無資料，暫時移除此區塊
    // ※ 未來可改用 Yahoo Finance API 或其他免費資料源
    // const equityLines = this._renderEquityMarket(marketData, briefData.gainersLosers);
    // if (equityLines.length > 0) {
    //   lines.push('🔹 Equity_Market');
    //   equityLines.forEach(l => lines.push(l));
    //   lines.push('');
    // }

    // ── 8. Cross Asset ────────────────────────────────────────────────────
    const crossLines = this._renderCrossAsset(marketData);
    if (crossLines.length > 0) {
      lines.push('🔹 Cross_Asset');
      crossLines.forEach(l => lines.push(l));
      lines.push('');
    }

    // ── 9. Taiwan Market ──────────────────────────────────────────────────
    if (mc.twse && !mc.twse.isTradingDay) {
      lines.push('🇹🇼 今日台股休市');
      lines.push('');
    } else {
      const twLines = this._renderTaiwanMarket(marketData, institutionalData);
      if (twLines.length > 0) {
        lines.push('🇹🇼 Taiwan_Market');
        twLines.forEach(l => lines.push(l));
        lines.push('');
      }
    }

    // ── 10. Watchlist Focus ───────────────────────────────────────────────
    if (mc.twse && !mc.twse.isTradingDay) {
      // 台股休市時 watchlist 也休市
    } else {
      const wlLines = this._renderWatchlist(watchlist, institutionalData);
      if (wlLines.length > 0) {
        lines.push('🎯 Watchlist_Focus');
        wlLines.forEach(l => lines.push(l));
        lines.push('');
      }
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
    if (md.US10Y?.value != null)    parts.push(`US 10Y: ${md.US10Y.value.toFixed(2)}%`);
    if (md.FED_RATE?.value != null) parts.push(`Fed Rate: ${md.FED_RATE.value.toFixed(2)}%`);
    if (md.DXY?.value != null)      parts.push(`DXY: ${md.DXY.value.toFixed(1)}`);
    if (md.VIX?.value != null)      parts.push(`VIX: ${md.VIX.value.toFixed(1)}`);
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
      const symbol = item.symbol || item.stockId || item.code;
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

    // 1. 財報日曆（未來 7 天）
    const earningsEvents = events.filter(e => e.type === 'earnings').slice(0, 5);
    if (earningsEvents.length > 0) {
      lines.push('  財報：');
      earningsEvents.forEach(e => {
        const dateStr = e.date.slice(5);  // MM-DD
        lines.push(`  • ${dateStr} ${e.company || e.symbol}${e.event ? ` - ${e.event}` : ''}`);
      });
    }

    // 2. 經濟數據日曆（未來 7 天）
    const econEvents = events.filter(e => e.type === 'economic').slice(0, 5);
    if (econEvents.length > 0) {
      lines.push('  經濟數據：');
      econEvents.forEach(e => {
        const dateStr = e.date.slice(5);  // MM-DD
        lines.push(`  • ${dateStr} ${e.country || ''} ${e.event}`);
      });
    }

    // 3. SEC 重大申報（過濾無描述的 8-K）
    const importantFilings = secFilings
      .filter(f =>
        (f.importance === 'P0' || f.importance === 'P1') &&
        f.description &&
        f.description !== 'Unknown'
      )
      .slice(0, 3);

    if (importantFilings.length > 0) {
      lines.push('  SEC 重大申報：');
      importantFilings.forEach(f => {
        lines.push(`  • [${f.formType}] ${f.company}: ${f.description.slice(0, 50)}`);
      });
    }

    return lines;
  }

  _renderMarketInsights(aiResult, marketData, institutionalData, marketHistory) {
    const lines = [];

    // 1. 產業熱點追蹤（白名單+黑名單驗證後的結果）
    if (aiResult.industryThemes && aiResult.industryThemes.length > 0) {
      lines.push('產業熱點：');
      aiResult.industryThemes.slice(0, 3).forEach(theme => {
        const companies = theme.keyCompanies ? ` (${theme.keyCompanies.join('、')})` : '';
        const tag = theme.tag ? ` [${theme.tag}]` : '';  // 標記「其他」類別
        lines.push(`  • ${theme.industry}${tag}：${theme.summary}${companies}`);
      });
    }

    // 2. 市場情緒評估（美股資料優先 + 趨勢分析）
    lines.push('市場情緒：');

    // VIX 趨勢（5日均線）
    const vixCurrent = marketData.VIX?.value || 0;
    const vix5DayAvg = marketHistory?.vix?.avg5Day || vixCurrent;
    const vixTrend = vixCurrent > vix5DayAvg * 1.05 ? '恐慌上升' :
                     vixCurrent < vix5DayAvg * 0.95 ? '風險偏好回升' : '觀望';
    lines.push(`  • VIX ${vixCurrent.toFixed(1)} (5日均 ${vix5DayAvg.toFixed(1)})，${vixTrend}`);

    // Put/Call Ratio 趨勢（10日均線）- 美股優先
    if (marketData.PUT_CALL_RATIO?.value) {
      const pcCurrent = marketData.PUT_CALL_RATIO.value;
      const pc10DayAvg = marketHistory?.putCallRatio?.avg10Day || pcCurrent;
      const pcTrend = pcCurrent > 1.0 ? '防禦情緒濃厚' :
                      pcCurrent < 0.7 ? '樂觀情緒高漲' : '中性';
      lines.push(`  • Put/Call ${pcCurrent.toFixed(2)} (10日均 ${pc10DayAvg.toFixed(2)})，${pcTrend}`);
    }

    // 成交量變化（SPY vs 20日均線）- 美股優先
    if (marketData.SPY_VOLUME) {
      const volumeRatio = marketData.SPY_VOLUME.current / marketData.SPY_VOLUME.avg20Day;
      const volumeTrend = volumeRatio > 1.2 ? '放量' :
                          volumeRatio < 0.8 ? '縮量' : '持平';
      lines.push(`  • 成交量 ${volumeTrend} (${(volumeRatio * 100).toFixed(0)}% vs 20日均)`);
    }

    // High-Yield Spread（額外指標，FRED API）
    if (marketData.HY_SPREAD?.value) {
      const hySpread = marketData.HY_SPREAD.value;
      const hyTrend = hySpread > 4.5 ? '信用風險上升' :
                      hySpread < 3.0 ? '風險偏好強' : '正常';
      lines.push(`  • 高收益債利差 ${hySpread.toFixed(2)}%，${hyTrend}`);
    }

    // 台股法人買賣超（選用，有資料才顯示）
    if (institutionalData?.foreign?.netBuySell) {
      const foreign = institutionalData.foreign.netBuySell > 0 ? '買超' : '賣超';
      const consecutiveDays = institutionalData.foreign.consecutiveDays || 0;
      const dayText = consecutiveDays > 1 ? `連${consecutiveDays}買` : '';
      lines.push(`  • 外資${foreign} ${Math.abs(institutionalData.foreign.netBuySell / 1e8).toFixed(1)}億${dayText ? ` (${dayText})` : ''}`);
    }

    // 3. 貨幣/利率趨勢（DXY 已在 Macro_Policy 收集）
    lines.push('貨幣利率：');
    if (marketData.US10Y?.value) {
      const us10yCurrent = marketData.US10Y.value;
      const us10y5DayAvg = marketHistory?.us10y?.avg5Day || us10yCurrent;
      const trend = us10yCurrent > us10y5DayAvg * 1.005 ? '殖利率上升' :
                    us10yCurrent < us10y5DayAvg * 0.995 ? '殖利率下降' : '持平';
      lines.push(`  • US 10Y ${us10yCurrent.toFixed(2)}% (${trend})`);
    }
    if (marketData.DXY?.value) {
      const dxyCurrent = marketData.DXY.value;
      const dxy5DayAvg = marketHistory?.dxy?.avg5Day || dxyCurrent;
      const usdTrend = dxyCurrent > dxy5DayAvg ? '美元走強' : '美元走弱';
      const impact = dxyCurrent > dxy5DayAvg ? '台幣貶值壓力' : '台幣升值空間';
      lines.push(`  • ${usdTrend}，DXY ${dxyCurrent.toFixed(1)} (5日均 ${dxy5DayAvg.toFixed(1)})，${impact}`);
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
