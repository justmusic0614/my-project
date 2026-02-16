#!/usr/bin/env node
/**
 * 數據驗證器 - 檢查財經數據的正確性與時效性
 */

const fs = require('fs');
const path = require('path');

class DataValidator {
  constructor() {
    this.issues = [];
    this.warnings = [];
  }

  /**
   * 驗證交易日數據
   */
  async validateTradingDay(date) {
    console.log(`🔍 驗證交易日數據：${date}`);
    
    // 檢查 1: 證交所數據是否存在
    const chipCachePath = path.join(__dirname, 'data/chip-cache', date);
    const hasChipData = fs.existsSync(chipCachePath) && 
                        fs.readdirSync(chipCachePath).length > 0;
    
    if (!hasChipData) {
      this.warnings.push({
        type: 'missing_chip_data',
        date: date,
        message: `缺少 ${date} 的籌碼面數據（可能是休市日或數據尚未更新）`
      });
    }
    
    // 檢查 2: 早報數據是否存在
    const morningCollectPath = path.join(__dirname, 'data/morning-collect', `${date}.json`);
    const hasLINEReport = fs.existsSync(morningCollectPath);
    
    // 檢查 3: RSS 新聞是否存在
    const newsAnalyzedPath = path.join(__dirname, 'data/news-analyzed', `${date}.json`);
    const hasRSSNews = fs.existsSync(newsAnalyzedPath);
    
    if (!hasLINEReport && !hasRSSNews) {
      this.warnings.push({
        type: 'missing_news',
        date: date,
        message: `缺少 ${date} 的新聞資料（LINE 早報 + RSS 都沒有）`
      });
    }
    
    // 檢查 4: Daily Brief 使用的數據日期
    const dailyBriefPath = path.join(__dirname, 'data/daily-brief', `${date}.txt`);
    if (fs.existsSync(dailyBriefPath)) {
      const content = fs.readFileSync(dailyBriefPath, 'utf8');
      
      // 檢查是否使用舊數據
      const dateMatches = content.match(/\d{4}-\d{2}-\d{2}/g);
      if (dateMatches) {
        const uniqueDates = [...new Set(dateMatches)];
        const olderDates = uniqueDates.filter(d => d < date);
        
        if (olderDates.length > 0 && !content.includes('使用前一交易日數據')) {
          this.issues.push({
            type: 'old_data_not_labeled',
            date: date,
            olderDates: olderDates,
            message: `報告使用舊數據但未標示（${olderDates.join(', ')}）`
          });
        }
      }
    }
    
    return {
      isValid: this.issues.length === 0,
      hasChipData,
      hasLINEReport,
      hasRSSNews,
      issues: this.issues,
      warnings: this.warnings
    };
  }
  
  /**
   * 驗證數據一致性
   */
  async validateConsistency(date) {
    console.log(`🔍 驗證數據一致性：${date}`);
    
    const dailyBriefPath = path.join(__dirname, 'data/daily-brief', `${date}.txt`);
    const runtimeReportPath = path.join(__dirname, 'data/runtime/morning-report.txt');
    
    if (!fs.existsSync(dailyBriefPath)) {
      this.warnings.push({
        type: 'missing_daily_brief',
        date: date,
        message: `缺少 ${date} 的 Daily Brief`
      });
      return false;
    }
    
    const briefContent = fs.readFileSync(dailyBriefPath, 'utf8');
    
    // 檢查 Money Flow 數據範圍是否合理
    const moneyFlowMatch = briefContent.match(/外資：[買賣]超 ([\d,]+) 億/);
    if (moneyFlowMatch) {
      const amount = parseInt(moneyFlowMatch[1].replace(/,/g, ''));
      if (amount > 500) {
        this.warnings.push({
          type: 'unusual_money_flow',
          date: date,
          amount: amount,
          message: `外資買賣超金額異常（${amount} 億，超過 500 億）`
        });
      }
    }
    
    // 檢查指數漲跌幅是否合理
    const indexMatch = briefContent.match(/加權指數.*?([▲▼])([\d.]+)%/);
    if (indexMatch) {
      const change = parseFloat(indexMatch[2]);
      if (change > 5) {
        this.warnings.push({
          type: 'unusual_index_change',
          date: date,
          change: change,
          message: `指數漲跌幅異常（${indexMatch[1]}${change}%，超過 5%）`
        });
      }
    }
    
    return true;
  }
  
  /**
   * 生成驗證報告
   */
  generateReport() {
    const report = [];
    
    report.push('━━━━━━━━━━━━━━━━━━');
    report.push('📊 數據驗證報告');
    report.push('━━━━━━━━━━━━━━━━━━');
    report.push('');
    
    if (this.issues.length > 0) {
      report.push('🔴 嚴重問題：');
      this.issues.forEach(issue => {
        report.push(`  ❌ ${issue.message}`);
        if (issue.olderDates) {
          report.push(`     使用日期：${issue.olderDates.join(', ')}`);
        }
      });
      report.push('');
    }
    
    if (this.warnings.length > 0) {
      report.push('⚠️  警告：');
      this.warnings.forEach(warning => {
        report.push(`  • ${warning.message}`);
      });
      report.push('');
    }
    
    if (this.issues.length === 0 && this.warnings.length === 0) {
      report.push('✅ 所有檢查通過');
      report.push('');
    }
    
    report.push('━━━━━━━━━━━━━━━━━━');
    
    return report.join('\n');
  }
}

// CLI 使用
if (require.main === module) {
  const date = process.argv[2] || new Date().toISOString().split('T')[0];
  
  (async () => {
    const validator = new DataValidator();
    
    // 驗證交易日數據
    const tradingDayResult = await validator.validateTradingDay(date);
    
    // 驗證數據一致性
    await validator.validateConsistency(date);
    
    // 輸出報告
    console.log(validator.generateReport());
    
    // 返回 JSON（供其他程式使用）
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({
        date: date,
        isValid: validator.issues.length === 0,
        hasChipData: tradingDayResult.hasChipData,
        hasLINEReport: tradingDayResult.hasLINEReport,
        hasRSSNews: tradingDayResult.hasRSSNews,
        issues: validator.issues,
        warnings: validator.warnings
      }, null, 2));
    }
  })();
}

module.exports = DataValidator;
