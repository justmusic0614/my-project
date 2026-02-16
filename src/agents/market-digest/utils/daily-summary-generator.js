// Daily Summary Generator
// 生成每日 Risk-off 運行摘要報告

const fs = require('fs');
const path = require('path');

class DailySummaryGenerator {
  constructor(reportDir = './reports/daily') {
    this.reportDir = reportDir;
    this.ensureReportDir();
  }

  ensureReportDir() {
    if (!fs.existsSync(this.reportDir)) {
      fs.mkdirSync(this.reportDir, { recursive: true });
    }
  }

  /**
   * 生成每日摘要報告
   * @param {Object} analysis - Risk-off 分析結果
   * @param {Object} marketData - 市場數據
   * @param {Object} stats - 歷史統計（可選）
   * @param {Array} alerts - 當日警報（可選）
   * @param {string} date - 日期
   * @param {Object} sectorAnalysis - 板塊分析（可選）
   * @param {Array} recentLogs - 最近 7-14 天日誌（可選）
   * @returns {Object}
   */
  generate(analysis, marketData, stats = null, alerts = [], date = null, sectorAnalysis = null, recentLogs = null) {
    const today = date || new Date().toISOString().split('T')[0];
    const timestamp = new Date().toISOString();

    const report = {
      date: today,
      timestamp,
      generatedAt: new Date(timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),

      // 當日 Risk-off 評估
      riskOff: {
        score: analysis.score,
        level: analysis.level,
        signal: analysis.signal,
        description: analysis.description,
        recommendation: analysis.recommendation
      },

      // 市場數據摘要
      market: {
        vix: marketData.vix || null,
        vixStatus: this.getVixStatus(marketData.vix),
        foreignFlow: marketData.foreign?.netBuy || null,
        foreignStatus: this.getForeignFlowStatus(marketData.foreign?.netBuy),
        indexChange: marketData.stockIndex?.change || null,
        goldChange: marketData.gold?.change || null,
        jpyChange: marketData.usd_jpy?.change || null
      },

      // 詳細分項評分
      breakdown: analysis.breakdown,

      // 警報狀態
      alerts: alerts.map(a => ({
        level: a.level,
        message: a.message,
        score: a.score
      })),

      // 歷史統計（如有）
      stats: stats || null,

      // 趨勢分析（如有歷史數據）
      trend: this.analyzeTrend(stats),

      // 板塊分析（如有）
      sectorAnalysis: sectorAnalysis || null,

      // 最近日誌（用於趨勢圖）
      recentLogs: recentLogs || null
    };

    // 生成 JSON 報告
    const jsonPath = path.join(this.reportDir, `${today}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

    // 生成 Markdown 報告
    const mdPath = path.join(this.reportDir, `${today}.md`);
    const markdown = this.generateMarkdown(report);
    fs.writeFileSync(mdPath, markdown, 'utf8');

    // 更新最新報告
    const latestJsonPath = path.join(this.reportDir, 'latest.json');
    const latestMdPath = path.join(this.reportDir, 'latest.md');
    fs.writeFileSync(latestJsonPath, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(latestMdPath, markdown, 'utf8');

    console.log(`✅ Daily summary generated: ${today}`);
    console.log(`   JSON: ${jsonPath}`);
    console.log(`   Markdown: ${mdPath}`);

    return report;
  }

  /**
   * 生成 Markdown 格式報告
   * @param {Object} report - 報告資料
   * @returns {string}
   */
  generateMarkdown(report) {
    const lines = [];

    // ========== 標題與時間戳 ==========
    lines.push(`# Risk-off Daily Summary - ${report.date}`);
    lines.push('');
    lines.push(`**Generated At**: ${report.generatedAt}`);
    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');

    // ========== 核心摘要框（新增）==========
    lines.push('## 📋 Executive Summary');
    lines.push('');
    lines.push(`> **Risk-off Score**: ${report.riskOff.score}/100 ${report.riskOff.signal}`);
    lines.push(`> **Level**: **${report.riskOff.level}** - ${report.riskOff.description}`);
    lines.push(`> **VIX**: ${report.market.vix || 'N/A'} ${report.market.vixStatus}`);
    lines.push(`> **Foreign Flow**: ${report.market.foreignFlow || 'N/A'} ${report.market.foreignStatus}`);
    lines.push(`>`);
    lines.push(`> 💡 **${report.riskOff.recommendation}**`);
    lines.push('');

    // ========== ASCII 趨勢圖（新增）==========
    if (report.recentLogs && report.recentLogs.length > 0) {
      const trendChart = this.generateTrendChart(report.recentLogs);
      if (trendChart) {
        lines.push(trendChart);
        lines.push('');
      }
    }

    // ========== Risk-off 評估（改善格式）==========
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');
    lines.push('## 📊 Risk-off Assessment');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| **Score** | **${report.riskOff.score}/100** ${report.riskOff.signal} |`);
    lines.push(`| **Level** | **${report.riskOff.level}** |`);
    lines.push(`| **Description** | ${report.riskOff.description} |`);
    lines.push('');
    lines.push(`**Recommendation**: ${report.riskOff.recommendation}`);
    lines.push('');

    // 警報狀態
    if (report.alerts.length > 0) {
      lines.push('## 🚨 Alerts');
      lines.push('');
      report.alerts.forEach(alert => {
        lines.push(`- **${alert.level}**: ${alert.message}`);
      });
      lines.push('');
    }

    // ========== 市場數據（改善格式）==========
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');
    lines.push('## 📈 Market Data');
    lines.push('');
    lines.push(`| Indicator | Value | Status |`);
    lines.push(`|-----------|-------|--------|`);
    lines.push(`| **VIX** | ${report.market.vix || 'N/A'} | ${report.market.vixStatus} |`);
    lines.push(`| **Foreign Flow** | ${report.market.foreignFlow || 'N/A'} | ${report.market.foreignStatus} |`);
    lines.push(`| **Index Change** | ${report.market.indexChange ? report.market.indexChange.toFixed(2) + '%' : 'N/A'} | ${this.getChangeIndicator(report.market.indexChange)} |`);
    lines.push(`| **Gold Change** | ${report.market.goldChange ? report.market.goldChange.toFixed(2) + '%' : 'N/A'} | ${this.getChangeIndicator(report.market.goldChange)} |`);
    lines.push(`| **JPY Change** | ${report.market.jpyChange ? report.market.jpyChange.toFixed(2) + '%' : 'N/A'} | ${this.getChangeIndicator(report.market.jpyChange)} |`);
    lines.push('');

    // ========== 分項評分（改善格式）==========
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');
    lines.push('## 🔍 Score Breakdown');
    lines.push('');
    const b = report.breakdown;
    if (b) {
      lines.push(`| Component | Value | Contribution | Bar |`);
      lines.push(`|-----------|-------|--------------|-----|`);
      lines.push(`| **VIX** | ${b.vix.value} | ${b.vix.contribution} pts | ${this.getBar(b.vix.contribution, 30)} |`);
      lines.push(`| **Safe Haven** | Gold ${b.safeHaven.gold}%, JPY ${b.safeHaven.jpy}% | ${b.safeHaven.contribution} pts | ${this.getBar(b.safeHaven.contribution, 20)} |`);
      lines.push(`| **Foreign Flow** | ${b.foreignFlow.value} | ${b.foreignFlow.contribution} pts | ${this.getBar(b.foreignFlow.contribution, 25)} |`);
      lines.push(`| **Market Volatility** | ${b.marketVolatility.indexChange}% | ${b.marketVolatility.contribution} pts | ${this.getBar(b.marketVolatility.contribution, 15)} |`);
      lines.push(`| **News Sentiment** | ${b.newsSentiment.negativeCount} negative | ${b.newsSentiment.contribution} pts | ${this.getBar(b.newsSentiment.contribution, 10)} |`);
      lines.push('');
      lines.push(`**Total Score**: ${report.riskOff.score}/100 pts`);
      lines.push('');
    }

    // ========== 板塊熱力圖（新增）==========
    if (report.sectorAnalysis) {
      const sectorHeatmap = this.generateSectorHeatmap(report.sectorAnalysis);
      if (sectorHeatmap) {
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('');
        lines.push(sectorHeatmap);
        lines.push('');
      }
    }

    // ========== 歷史統計（改善格式）==========
    if (report.stats) {
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('');
      lines.push('## 📊 Historical Statistics (30 days)');
      lines.push('');
      lines.push(`| Metric | Value |`);
      lines.push(`|--------|-------|`);
      lines.push(`| **Period** | ${report.stats.period} |`);
      lines.push(`| **Total Days** | ${report.stats.totalDays} |`);
      lines.push(`| **Average Score** | ${report.stats.avgScore} |`);
      lines.push(`| **Max Score** | ${report.stats.maxScore} 🔺 |`);
      lines.push(`| **Min Score** | ${report.stats.minScore} 🔻 |`);
      lines.push('');

      lines.push('**Level Distribution**:');
      lines.push('```');
      const total = report.stats.totalDays;
      const highPct = (report.stats.levelDistribution.HIGH / total * 100).toFixed(0);
      const medPct = (report.stats.levelDistribution.MEDIUM / total * 100).toFixed(0);
      const lowPct = (report.stats.levelDistribution.LOW / total * 100).toFixed(0);
      const nonePct = (report.stats.levelDistribution.NONE / total * 100).toFixed(0);

      lines.push(`🔴 HIGH   : ${report.stats.levelDistribution.HIGH.toString().padStart(2, ' ')} days (${highPct}%)  ${this.getBar(report.stats.levelDistribution.HIGH, total)}`);
      lines.push(`🟡 MEDIUM : ${report.stats.levelDistribution.MEDIUM.toString().padStart(2, ' ')} days (${medPct}%)  ${this.getBar(report.stats.levelDistribution.MEDIUM, total)}`);
      lines.push(`🟢 LOW    : ${report.stats.levelDistribution.LOW.toString().padStart(2, ' ')} days (${lowPct}%)  ${this.getBar(report.stats.levelDistribution.LOW, total)}`);
      lines.push(`⚪ NONE   : ${report.stats.levelDistribution.NONE.toString().padStart(2, ' ')} days (${nonePct}%)  ${this.getBar(report.stats.levelDistribution.NONE, total)}`);
      lines.push('```');
      lines.push('');

      if (report.stats.highRiskDays.length > 0) {
        lines.push(`**High Risk Days**: ${report.stats.highRiskDays.join(', ')}`);
        lines.push('');
      }
    }

    // ========== 趨勢分析（改善格式）==========
    if (report.trend) {
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('');
      lines.push('## 📈 Trend Analysis');
      lines.push('');
      lines.push(`> **Trend Direction**: ${report.trend.direction} ${report.trend.emoji}`);
      lines.push(`>`);
      lines.push(`> ${report.trend.description}`);
      lines.push('');
    }

    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');
    lines.push('*Report generated by **Risk-off Monitoring System V2** 🤖*');
    lines.push('');
    lines.push(`*For questions or feedback, please contact the system administrator.*`);

    return lines.join('\n');
  }

  /**
   * 取得 VIX 狀態
   * @param {number} vix - VIX 值
   * @returns {string}
   */
  getVixStatus(vix) {
    if (!vix) return 'Unknown';
    if (vix < 15) return '😌 Calm';
    if (vix < 20) return '😐 Elevated';
    if (vix < 30) return '😨 Alert';
    return '😱 Panic';
  }

  /**
   * 取得外資流向狀態
   * @param {number} flow - 外資淨買賣（億）
   * @returns {string}
   */
  getForeignFlowStatus(flow) {
    if (!flow) return 'Unknown';
    if (flow > 10000) return '🟢 Strong Buy';
    if (flow > 5000) return '🟢 Buy';
    if (flow > -5000) return '🟡 Neutral';
    if (flow > -10000) return '🔴 Sell';
    return '🔴 Strong Sell';
  }

  /**
   * 分析趨勢
   * @param {Object} stats - 歷史統計
   * @returns {Object|null}
   */
  analyzeTrend(stats) {
    if (!stats || stats.totalDays < 7) {
      return null;
    }

    const highRiskRatio = stats.levelDistribution.HIGH / stats.totalDays;
    const avgScore = parseFloat(stats.avgScore);

    let direction, description, emoji;

    if (highRiskRatio > 0.3) {
      direction = 'Increasing Risk';
      description = `Risk-off sentiment has been elevated with ${stats.levelDistribution.HIGH} HIGH days in the past ${stats.totalDays} days.`;
      emoji = '📈';
    } else if (avgScore > 50) {
      direction = 'Moderate Risk';
      description = `Average score of ${avgScore} suggests moderate risk-off sentiment.`;
      emoji = '➡️';
    } else {
      direction = 'Low Risk';
      description = `Market shows low risk-off sentiment with average score of ${avgScore}.`;
      emoji = '📉';
    }

    return { direction, description, emoji };
  }

  /**
   * 生成 ASCII 趨勢圖
   * @param {Array} logs - 最近 N 天的日誌
   * @param {number} days - 顯示天數
   * @returns {string} ASCII chart
   */
  generateTrendChart(logs, days = 7) {
    if (!logs || logs.length === 0) {
      return null;
    }

    // 取最近 N 天數據並排序（舊 → 新）
    const recentLogs = logs.slice(-days).sort((a, b) =>
      new Date(a.date) - new Date(b.date)
    );

    if (recentLogs.length < 2) {
      return null; // 至少需要 2 個數據點
    }

    const scores = recentLogs.map(log => log.score);
    const dates = recentLogs.map(log => {
      const d = new Date(log.date);
      return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    });

    // 定義 Y 軸刻度（0, 20, 40, 60, 80, 100）
    const yTicks = [100, 80, 60, 40, 20, 0];
    const chartHeight = yTicks.length;
    const chartWidth = recentLogs.length;

    const lines = [];

    // 生成圖表標題
    lines.push('');
    lines.push(`📊 Score Trend (Last ${recentLogs.length} Days)`);
    lines.push('```');

    // 生成每一行
    yTicks.forEach((yValue, rowIndex) => {
      let row = `${String(yValue).padStart(3, ' ')} |`;

      // 為每個數據點添加符號
      scores.forEach((score, colIndex) => {
        // 計算該點應該在哪一行顯示
        const scoreRow = Math.floor((100 - score) / 20);
        const currentRow = rowIndex;

        if (scoreRow === currentRow) {
          // 根據 level 使用不同符號
          const level = this.getLevelFromScore(score);
          let symbol = '●';
          if (level === 'HIGH') symbol = '🔴';
          else if (level === 'MEDIUM') symbol = '🟡';
          else if (level === 'LOW') symbol = '🟢';
          else symbol = '⚪';

          row += symbol.padEnd(5, ' ');
        } else {
          row += '     '; // 空白
        }
      });

      lines.push(row);
    });

    // X 軸
    let xAxis = '    +';
    for (let i = 0; i < chartWidth; i++) {
      xAxis += '----+';
    }
    lines.push(xAxis);

    // 日期標籤
    let dateRow = '     ';
    dates.forEach(date => {
      dateRow += date + ' ';
    });
    lines.push(dateRow);

    // 圖例
    lines.push('');
    lines.push('Legend: 🔴 HIGH (≥65)  🟡 MEDIUM (50-64)  🟢 LOW (35-49)  ⚪ NONE (<35)');
    lines.push('```');

    return lines.join('\n');
  }

  /**
   * 根據 Score 取得 Level
   * @param {number} score - Risk-off Score
   * @returns {string} Level
   */
  getLevelFromScore(score) {
    if (score >= 65) return 'HIGH';
    if (score >= 50) return 'MEDIUM';
    if (score >= 35) return 'LOW';
    return 'NONE';
  }

  /**
   * 生成板塊熱力圖
   * @param {Object} sectorAnalysis - 板塊分析結果
   * @returns {string} Heatmap
   */
  generateSectorHeatmap(sectorAnalysis) {
    if (!sectorAnalysis || !sectorAnalysis.rotation) {
      return null;
    }

    const lines = [];
    const { rotation, defensivePerformance, cyclicalPerformance, recommendation, signal } = sectorAnalysis;

    lines.push('');
    lines.push('## 🎯 Sector Rotation Heatmap');
    lines.push('');
    lines.push('```');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 防禦性板塊
    lines.push('🛡️  Defensive Sectors');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (defensivePerformance && defensivePerformance.length > 0) {
      defensivePerformance.forEach(sector => {
        const heat = this.getHeatIndicator(sector.change);
        const name = this.getSectorDisplayName(sector.sector);
        const changeStr = sector.change >= 0 ? `+${sector.change.toFixed(2)}%` : `${sector.change.toFixed(2)}%`;
        lines.push(`${heat}  ${name.padEnd(18, ' ')} ${changeStr.padStart(8, ' ')}`);
      });
    } else {
      lines.push('   (No data available)');
    }

    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 循環性板塊
    lines.push('⚡ Cyclical Sectors');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (cyclicalPerformance && cyclicalPerformance.length > 0) {
      cyclicalPerformance.forEach(sector => {
        const heat = this.getHeatIndicator(sector.change);
        const name = this.getSectorDisplayName(sector.sector);
        const changeStr = sector.change >= 0 ? `+${sector.change.toFixed(2)}%` : `${sector.change.toFixed(2)}%`;
        lines.push(`${heat}  ${name.padEnd(18, ' ')} ${changeStr.padStart(8, ' ')}`);
      });
    } else {
      lines.push('   (No data available)');
    }

    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('```');
    lines.push('');

    // 輪動分析
    lines.push(`**Rotation Signal**: ${signal}`);
    lines.push(`**Spread**: Defensive avg ${rotation.defensiveAvg.toFixed(2)}% vs Cyclical avg ${rotation.cyclicalAvg.toFixed(2)}% (Δ ${rotation.spread.toFixed(2)}%)`);
    lines.push(`**Confidence**: ${(rotation.confidence * 100).toFixed(0)}%`);
    lines.push('');
    lines.push(`> 💡 **Recommendation**: ${recommendation}`);

    return lines.join('\n');
  }

  /**
   * 取得熱力指示符號
   * @param {number} change - 漲跌幅
   * @returns {string} 熱力符號
   */
  getHeatIndicator(change) {
    if (change >= 2.0) return '🔥🔥🔥';
    if (change >= 1.0) return '🔥🔥  ';
    if (change >= 0.5) return '🔥    ';
    if (change >= -0.5) return '──    ';
    if (change >= -1.0) return '❄️    ';
    if (change >= -2.0) return '❄️❄️  ';
    return '❄️❄️❄️';
  }

  /**
   * 取得板塊顯示名稱
   * @param {string} sector - 板塊英文名稱
   * @returns {string} 顯示名稱
   */
  getSectorDisplayName(sector) {
    const names = {
      'utilities': 'Utilities',
      'healthcare': 'Healthcare',
      'consumer_staples': 'Consumer Staples',
      'telecom': 'Telecom',
      'tech': 'Tech',
      'finance': 'Finance',
      'industrial': 'Industrial',
      'consumer_discretionary': 'Consumer Disc.',
      'energy': 'Energy',
      'materials': 'Materials'
    };
    return names[sector] || sector;
  }

  /**
   * 取得漲跌指示符號
   * @param {number} change - 漲跌幅
   * @returns {string} 指示符號
   */
  getChangeIndicator(change) {
    if (change === null || change === undefined) return '-';
    if (change > 2.0) return '🚀 Strong Up';
    if (change > 1.0) return '📈 Up';
    if (change > 0.5) return '⬆️ Slight Up';
    if (change >= -0.5) return '➖ Flat';
    if (change >= -1.0) return '⬇️ Slight Down';
    if (change >= -2.0) return '📉 Down';
    return '💥 Strong Down';
  }

  /**
   * 取得進度條視覺化
   * @param {number} value - 當前值
   * @param {number} max - 最大值
   * @returns {string} 進度條
   */
  getBar(value, max) {
    const ratio = Math.min(value / max, 1.0);
    const barLength = Math.round(ratio * 10);
    const emptyLength = 10 - barLength;

    let bar = '';
    for (let i = 0; i < barLength; i++) {
      bar += '█';
    }
    for (let i = 0; i < emptyLength; i++) {
      bar += '░';
    }

    return bar;
  }
}

module.exports = DailySummaryGenerator;
