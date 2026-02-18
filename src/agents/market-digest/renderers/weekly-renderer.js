/**
 * WeeklyRenderer — 週報格式渲染器
 * 週五 17:30 推播：週度市場總結 + 下週展望
 *
 * 週報格式：
 *   === Weekly Market Report YYYY-WXX ===
 *   📅 本週回顧（YYYY/MM/DD – YYYY/MM/DD）
 *   📊 週度市場表現
 *   🔑 本週關鍵事件 Top5
 *   📈 產業板塊週績效
 *   🇹🇼 台股本週摘要
 *   🎯 下週展望
 *   📅 下週重要行事曆
 *   ━━ 免責聲明
 */

'use strict';

const { createLogger } = require('../shared/logger');

const logger = createLogger('renderer:weekly');

const UP   = '▲';
const DOWN = '▼';

class WeeklyRenderer {
  /**
   * 主渲染方法
   * @param {object} weeklyData
   * @param {object}   weeklyData.weeklyMarket  - 週度市場表現（各指數週漲跌）
   * @param {object[]} weeklyData.topEvents     - 本週 Top5 重要事件
   * @param {object}   weeklyData.sectorPerf    - 板塊週績效
   * @param {object}   weeklyData.twSummary     - 台股本週摘要
   * @param {object}   weeklyData.aiOutlook     - AI 生成的下週展望（由 ai-analyzer 呼叫端提供）
   * @param {object[]} weeklyData.nextWeekEvents - 下週行事曆
   * @param {string}   weeklyData.weekLabel     - 例如 "2026-W08"
   * @param {string}   weeklyData.dateRange     - 例如 "2026/02/17 – 2026/02/21"
   * @returns {string}
   */
  render(weeklyData = {}) {
    const {
      weekLabel      = this._currentWeekLabel(),
      dateRange      = '',
      weeklyMarket   = {},
      topEvents      = [],
      sectorPerf     = {},
      twSummary      = {},
      aiOutlook      = '',
      nextWeekEvents = []
    } = weeklyData;

    const lines = [];

    // Header
    lines.push(`=== Weekly Market Report ${weekLabel} ===`);
    if (dateRange) lines.push(`  📅 ${dateRange}`);
    lines.push('');

    // 1. 週度市場表現
    const perfLines = this._renderWeeklyPerf(weeklyMarket);
    if (perfLines.length > 0) {
      lines.push('📊 週度市場表現');
      perfLines.forEach(l => lines.push(l));
      lines.push('');
    }

    // 2. 本週關鍵事件 Top5
    if (topEvents.length > 0) {
      lines.push('🔑 本週關鍵事件');
      topEvents.slice(0, 5).forEach((ev, i) => {
        const badge = ev.importance === 'P0' ? '[重大] ' : '';
        lines.push(`  ${i + 1}. ${badge}${ev.title}${ev.aiSummary ? `（${ev.aiSummary}）` : ''}`);
      });
      lines.push('');
    }

    // 3. 台股本週摘要
    const twLines = this._renderTWSummary(twSummary);
    if (twLines.length > 0) {
      lines.push('🇹🇼 台股本週摘要');
      twLines.forEach(l => lines.push(l));
      lines.push('');
    }

    // 4. 產業板塊週績效
    const sectorLines = this._renderSectorPerf(sectorPerf);
    if (sectorLines.length > 0) {
      lines.push('📈 板塊週績效');
      sectorLines.forEach(l => lines.push(l));
      lines.push('');
    }

    // 5. 下週展望（AI 生成）
    if (aiOutlook) {
      lines.push('🎯 下週展望');
      const sentences = aiOutlook.split(/[。\n]/).map(s => s.trim()).filter(Boolean);
      sentences.slice(0, 5).forEach(s => lines.push(`  • ${s}`));
      lines.push('');
    }

    // 6. 下週重要行事曆
    const eventLines = this._renderNextWeekEvents(nextWeekEvents);
    if (eventLines.length > 0) {
      lines.push('📅 下週行事曆');
      eventLines.forEach(l => lines.push(l));
      lines.push('');
    }

    // Footer
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push('免責聲明：本報告僅供資訊參考，不構成投資建議');

    const text = lines.join('\n');
    logger.info(`weekly report rendered: ${lines.length} lines`);
    return text;
  }

  _renderWeeklyPerf(market) {
    const lines = [];
    const items = [
      { label: 'TAIEX',   data: market.TAIEX },
      { label: 'S&P 500', data: market.SP500 },
      { label: 'Nasdaq',  data: market.NASDAQ },
      { label: 'Dow',     data: market.DJI },
      { label: 'USD/TWD', data: market.USDTWD },
      { label: 'GOLD',    data: market.GOLD },
      { label: 'BTC',     data: market.BTC }
    ];
    for (const { label, data } of items) {
      if (data?.weekChangePct != null) {
        const arrow = data.weekChangePct > 0 ? UP : DOWN;
        const sign  = data.weekChangePct >= 0 ? '+' : '';
        const close = data.weekClose != null ? ` (${data.weekClose.toLocaleString()})` : '';
        lines.push(`• ${label}: ${arrow}${sign}${data.weekChangePct.toFixed(2)}%${close}`);
      }
    }
    return lines;
  }

  _renderTWSummary(tw) {
    const lines = [];
    if (tw.weekVolume != null) {
      lines.push(`• 週成交量: ${(tw.weekVolume / 1e12).toFixed(2)} 兆`);
    }
    if (tw.foreignWeekNet != null) {
      const action = tw.foreignWeekNet >= 0 ? '買超' : '賣超';
      lines.push(`• 外資週度: ${action} ${Math.abs(Math.round(tw.foreignWeekNet / 1e8)).toLocaleString()} 億`);
    }
    if (tw.trustWeekNet != null) {
      const action = tw.trustWeekNet >= 0 ? '買超' : '賣超';
      lines.push(`• 投信週度: ${action} ${Math.abs(Math.round(tw.trustWeekNet / 1e8)).toLocaleString()} 億`);
    }
    if (tw.topSectors && tw.topSectors.length > 0) {
      lines.push(`• 強勢板塊: ${tw.topSectors.join('、')}`);
    }
    return lines;
  }

  _renderSectorPerf(sectorPerf) {
    const lines = [];
    const sectors = Object.entries(sectorPerf)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
    if (sectors.length === 0) return lines;

    // Top 3 漲 + Top 3 跌
    const gainers = sectors.filter(([, pct]) => pct >= 0).slice(0, 3);
    const losers  = sectors.filter(([, pct]) => pct < 0).reverse().slice(0, 3);

    if (gainers.length > 0) {
      lines.push(`  漲: ${gainers.map(([name, pct]) => `${name}(${UP}${pct.toFixed(1)}%)`).join(' ')}`);
    }
    if (losers.length > 0) {
      lines.push(`  跌: ${losers.map(([name, pct]) => `${name}(${DOWN}${Math.abs(pct).toFixed(1)}%)`).join(' ')}`);
    }
    return lines;
  }

  _renderNextWeekEvents(events = []) {
    const lines = [];
    const sorted = [...events].sort((a, b) => new Date(a.date) - new Date(b.date));
    sorted.slice(0, 8).forEach(e => {
      lines.push(`  • ${e.date} ${e.name || e.event || e.company}${e.note ? `（${e.note}）` : ''}`);
    });
    return lines;
  }

  _currentWeekLabel() {
    const now  = new Date();
    const year = now.getUTCFullYear();
    const jan1 = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil(((now - jan1) / 86400000 + jan1.getUTCDay() + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }
}

module.exports = new WeeklyRenderer();
module.exports.WeeklyRenderer = WeeklyRenderer;
