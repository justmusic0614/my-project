// Alert Manager
// 管理 Risk-off 警報通知

const fs = require('fs');
const path = require('path');

class AlertManager {
  constructor(alertDir = './logs/alerts') {
    this.alertDir = alertDir;
    this.ensureAlertDir();
    this.cooldownPeriod = 24 * 60 * 60 * 1000; // 24 小時冷卻期
  }

  ensureAlertDir() {
    if (!fs.existsSync(this.alertDir)) {
      fs.mkdirSync(this.alertDir, { recursive: true });
    }
  }

  /**
   * 發送警報
   * @param {Object} alert - 警報資訊
   * @param {Object} analysis - Risk-off 分析結果
   * @param {string} date - 日期
   */
  sendAlert(alert, analysis, date = null) {
    const today = date || new Date().toISOString().split('T')[0];
    const timestamp = new Date().toISOString();

    // 檢查冷卻期（避免重複警報）
    if (this.isInCooldown(alert.level)) {
      console.log(`⏸️ Alert in cooldown period: ${alert.level} (last sent within 24h)`);
      return null;
    }

    const alertEntry = {
      date: today,
      timestamp,
      level: alert.level,
      message: alert.message,
      score: alert.score,
      riskOffLevel: analysis.level,
      recommendation: alert.recommendation,
      breakdown: analysis.breakdown
    };

    // 1. 寫入警報檔案
    const alertPath = path.join(this.alertDir, `${today}_${alert.level}.json`);
    fs.writeFileSync(alertPath, JSON.stringify(alertEntry, null, 2), 'utf8');

    // 2. 追加到警報歷史
    const historyPath = path.join(this.alertDir, 'alert-history.jsonl');
    fs.appendFileSync(historyPath, JSON.stringify(alertEntry) + '\n', 'utf8');

    // 3. 更新冷卻記錄
    this.updateCooldown(alert.level, timestamp);

    // 4. 生成警報訊息
    const alertMessage = this.formatAlertMessage(alertEntry);

    // 5. 寫入警報訊息檔案（供其他程式讀取）
    const messagePath = path.join(this.alertDir, 'latest-alert.txt');
    fs.writeFileSync(messagePath, alertMessage, 'utf8');

    console.log('\n' + '='.repeat(60));
    console.log(alertMessage);
    console.log('='.repeat(60) + '\n');

    return alertEntry;
  }

  /**
   * 格式化警報訊息
   * @param {Object} alertEntry - 警報記錄
   * @returns {string}
   */
  formatAlertMessage(alertEntry) {
    const lines = [];

    if (alertEntry.level === 'CRITICAL') {
      lines.push('🚨🚨🚨 CRITICAL RISK-OFF ALERT 🚨🚨🚨');
    } else {
      lines.push('⚠️⚠️ HIGH RISK-OFF ALERT ⚠️⚠️');
    }

    lines.push('');
    lines.push(`Date: ${alertEntry.date}`);
    lines.push(`Time: ${new Date(alertEntry.timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
    lines.push('');
    lines.push(`Risk-off Score: ${alertEntry.score}/100 (${alertEntry.riskOffLevel})`);
    lines.push('');
    lines.push('📊 Breakdown:');

    const b = alertEntry.breakdown;
    if (b) {
      lines.push(`  • VIX: ${b.vix.value} (${b.vix.contribution}pts)`);
      lines.push(`  • Gold: ${b.safeHaven.gold.toFixed(1)}% (${b.safeHaven.contribution}pts)`);
      lines.push(`  • Foreign Flow: ${b.foreignFlow.value} (${b.foreignFlow.contribution}pts)`);
      lines.push(`  • Index Change: ${b.marketVolatility.indexChange.toFixed(1)}% (${b.marketVolatility.contribution}pts)`);
    }

    lines.push('');
    lines.push('💡 Recommendation:');
    lines.push(`  ${alertEntry.recommendation}`);
    lines.push('');

    if (alertEntry.level === 'CRITICAL') {
      lines.push('⚠️ IMMEDIATE ACTION REQUIRED ⚠️');
    } else {
      lines.push('⚠️ Please review your portfolio risk exposure');
    }

    return lines.join('\n');
  }

  /**
   * 檢查是否在冷卻期內
   * @param {string} level - 警報等級
   * @returns {boolean}
   */
  isInCooldown(level) {
    const cooldownPath = path.join(this.alertDir, 'cooldown.json');
    if (!fs.existsSync(cooldownPath)) {
      return false;
    }

    const cooldown = JSON.parse(fs.readFileSync(cooldownPath, 'utf8'));
    const lastAlert = cooldown[level];

    if (!lastAlert) {
      return false;
    }

    const lastAlertTime = new Date(lastAlert).getTime();
    const now = Date.now();

    return (now - lastAlertTime) < this.cooldownPeriod;
  }

  /**
   * 更新冷卻記錄
   * @param {string} level - 警報等級
   * @param {string} timestamp - 時間戳
   */
  updateCooldown(level, timestamp) {
    const cooldownPath = path.join(this.alertDir, 'cooldown.json');
    let cooldown = {};

    if (fs.existsSync(cooldownPath)) {
      cooldown = JSON.parse(fs.readFileSync(cooldownPath, 'utf8'));
    }

    cooldown[level] = timestamp;
    fs.writeFileSync(cooldownPath, JSON.stringify(cooldown, null, 2), 'utf8');
  }

  /**
   * 取得警報歷史
   * @param {number} days - 天數
   * @returns {Array}
   */
  getAlertHistory(days = 30) {
    const historyPath = path.join(this.alertDir, 'alert-history.jsonl');
    if (!fs.existsSync(historyPath)) {
      return [];
    }

    const lines = fs.readFileSync(historyPath, 'utf8').trim().split('\n');
    const allAlerts = lines.map(line => JSON.parse(line));

    // 取最近 N 天
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return allAlerts.filter(alert => new Date(alert.date) >= cutoffDate);
  }

  /**
   * 生成警報統計
   * @param {number} days - 天數
   * @returns {Object}
   */
  getAlertStats(days = 30) {
    const alerts = this.getAlertHistory(days);

    if (alerts.length === 0) {
      return {
        totalAlerts: 0,
        criticalAlerts: 0,
        highAlerts: 0,
        avgScore: 0
      };
    }

    return {
      totalAlerts: alerts.length,
      criticalAlerts: alerts.filter(a => a.level === 'CRITICAL').length,
      highAlerts: alerts.filter(a => a.level === 'HIGH').length,
      avgScore: (alerts.reduce((sum, a) => sum + a.score, 0) / alerts.length).toFixed(1),
      recentAlerts: alerts.slice(-5).map(a => ({
        date: a.date,
        level: a.level,
        score: a.score
      }))
    };
  }
}

module.exports = AlertManager;
