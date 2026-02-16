// Risk-off Score Logger
// 記錄每日 Risk-off Score 歷史數據

const fs = require('fs');
const path = require('path');

class RiskOffLogger {
  constructor(logDir = './logs/risk-off') {
    this.logDir = logDir;
    this.ensureLogDir();
  }

  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * 記錄每日 Risk-off 分析結果
   * @param {Object} analysis - Risk-off 分析結果
   * @param {Object} marketData - 市場數據
   * @param {string} date - 日期 (YYYY-MM-DD)
   */
  log(analysis, marketData, date = null) {
    const today = date || new Date().toISOString().split('T')[0];
    const timestamp = new Date().toISOString();

    const logEntry = {
      date: today,
      timestamp,
      score: analysis.score,
      level: analysis.level,
      signal: analysis.signal,
      description: analysis.description,
      recommendation: analysis.recommendation,
      breakdown: analysis.breakdown,
      marketData: {
        vix: marketData.vix || null,
        foreignFlow: marketData.foreign?.netBuy || null,
        indexChange: marketData.stockIndex?.change || null,
        goldChange: marketData.gold?.change || null,
        jpyChange: marketData.usd_jpy?.change || null
      }
    };

    // 1. 寫入每日 JSON 檔案
    const dailyLogPath = path.join(this.logDir, `${today}.json`);
    fs.writeFileSync(dailyLogPath, JSON.stringify(logEntry, null, 2), 'utf8');

    // 2. 追加到歷史記錄檔案
    const historyPath = path.join(this.logDir, 'history.jsonl');
    fs.appendFileSync(historyPath, JSON.stringify(logEntry) + '\n', 'utf8');

    // 3. 更新最新記錄
    const latestPath = path.join(this.logDir, 'latest.json');
    fs.writeFileSync(latestPath, JSON.stringify(logEntry, null, 2), 'utf8');

    console.log(`✅ Risk-off Score logged: ${today} | Score: ${analysis.score} | Level: ${analysis.level}`);

    return logEntry;
  }

  /**
   * 讀取指定日期的記錄
   * @param {string} date - 日期 (YYYY-MM-DD)
   * @returns {Object|null}
   */
  getLog(date) {
    const logPath = path.join(this.logDir, `${date}.json`);
    if (!fs.existsSync(logPath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(logPath, 'utf8'));
  }

  /**
   * 讀取最近 N 天的記錄
   * @param {number} days - 天數
   * @returns {Array}
   */
  getRecentLogs(days = 7) {
    const historyPath = path.join(this.logDir, 'history.jsonl');
    if (!fs.existsSync(historyPath)) {
      return [];
    }

    const lines = fs.readFileSync(historyPath, 'utf8').trim().split('\n');
    const allLogs = lines.map(line => JSON.parse(line));

    // 取最近 N 筆
    return allLogs.slice(-days);
  }

  /**
   * 生成統計摘要
   * @param {number} days - 天數
   * @returns {Object}
   */
  getStats(days = 30) {
    const logs = this.getRecentLogs(days);
    if (logs.length === 0) {
      return null;
    }

    const scores = logs.map(l => l.score);
    const levels = logs.map(l => l.level);

    return {
      period: `${logs[0].date} to ${logs[logs.length - 1].date}`,
      totalDays: logs.length,
      avgScore: (scores.reduce((sum, s) => sum + s, 0) / scores.length).toFixed(1),
      maxScore: Math.max(...scores),
      minScore: Math.min(...scores),
      levelDistribution: {
        HIGH: levels.filter(l => l === 'HIGH').length,
        MEDIUM: levels.filter(l => l === 'MEDIUM').length,
        LOW: levels.filter(l => l === 'LOW').length,
        NONE: levels.filter(l => l === 'NONE').length
      },
      highRiskDays: logs.filter(l => l.score >= 65).map(l => l.date)
    };
  }

  /**
   * 檢查是否需要發送警報
   * @param {Object} analysis - Risk-off 分析結果
   * @param {Object} thresholds - 警報閾值
   * @returns {Object|null}
   */
  checkAlert(analysis, thresholds = { HIGH: 70, CRITICAL: 85 }) {
    if (analysis.score >= thresholds.CRITICAL) {
      return {
        level: 'CRITICAL',
        message: `🚨 CRITICAL Risk-off Alert! Score: ${analysis.score}/100`,
        score: analysis.score,
        recommendation: analysis.recommendation
      };
    } else if (analysis.score >= thresholds.HIGH) {
      return {
        level: 'HIGH',
        message: `⚠️ HIGH Risk-off Alert! Score: ${analysis.score}/100`,
        score: analysis.score,
        recommendation: analysis.recommendation
      };
    }
    return null;
  }
}

module.exports = RiskOffLogger;
