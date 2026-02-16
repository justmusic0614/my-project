#!/usr/bin/env node
/**
 * News Viewer
 * 查看今日新聞、突發事件、搜尋
 */

const fs = require('fs').promises;
const path = require('path');

class NewsViewer {
  constructor() {
    this.dataPath = path.join(__dirname, 'data/news-analyzed');
  }

  /**
   * 載入分析過的新聞
   */
  async loadAnalyzedNews(date = null) {
    const today = date || new Date().toISOString().split('T')[0];
    const filePath = path.join(this.dataPath, `${today}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      return data.news || [];
    } catch (error) {
      console.log(`⚠️  無法載入 ${today} 的新聞`);
      return [];
    }
  }

  /**
   * 查看今日所有新聞
   */
  async viewToday() {
    const news = await this.loadAnalyzedNews();

    if (news.length === 0) {
      console.log('⚠️  今日無新聞');
      return;
    }

    const output = [];
    output.push('📰 今日財經新聞');
    output.push(`📅 ${new Date().toISOString().split('T')[0]}`);
    output.push('');

    // 依優先級分類
    const critical = news.filter(n => n.analysis.priority === 'critical');
    const high = news.filter(n => n.analysis.priority === 'high');
    const medium = news.filter(n => n.analysis.priority === 'medium');

    // Critical（立即關注）
    if (critical.length > 0) {
      output.push('━━━━━━━━━━━━━━━━━━');
      output.push('🔴 重大事件（立即關注）');
      output.push('━━━━━━━━━━━━━━━━━━');
      critical.forEach((n, i) => {
        output.push(`${i + 1}. ${n.title}`);
        output.push(`   📊 ${n.analysis.marketImplication}`);
        if (n.analysis.affectedAssets.length > 0) {
          output.push(`   🎯 影響：${n.analysis.affectedAssets.join('、')}`);
        }
        output.push('');
      });
    }

    // High（每日彙整）
    if (high.length > 0) {
      output.push('━━━━━━━━━━━━━━━━━━');
      output.push('🟡 重要新聞（每日彙整）');
      output.push('━━━━━━━━━━━━━━━━━━');
      high.forEach((n, i) => {
        output.push(`${i + 1}. ${n.title}`);
        output.push(`   📊 ${n.analysis.marketImplication}`);
        output.push('');
      });
    }

    // Medium（存檔參考）
    if (medium.length > 0) {
      output.push('━━━━━━━━━━━━━━━━━━');
      output.push('🟢 一般新聞（存檔參考）');
      output.push('━━━━━━━━━━━━━━━━━━');
      medium.forEach((n, i) => {
        output.push(`${i + 1}. ${n.title}`);
        output.push('');
      });
    }

    // 統計
    output.push('━━━━━━━━━━━━━━━━━━');
    output.push(`📊 統計：共 ${news.length} 則（🔴 ${critical.length} | 🟡 ${high.length} | 🟢 ${medium.length}）`);

    console.log(output.join('\n'));
  }

  /**
   * 查看突發事件（最近 24 小時）
   */
  async viewBreaking() {
    const news = await this.loadAnalyzedNews();

    if (news.length === 0) {
      console.log('⚠️  今日無新聞');
      return;
    }

    // 過濾最近 24 小時的重大事件
    const now = new Date();
    const last24h = news.filter(n => {
      if (!n.publishedAt) return true;  // 無時間戳記，保留
      const publishDate = new Date(n.publishedAt);
      const ageHours = (now - publishDate) / (1000 * 60 * 60);
      return ageHours < 24;
    });

    const breaking = last24h.filter(n => n.analysis.importance >= 9);

    if (breaking.length === 0) {
      console.log('✅ 最近 24 小時無重大事件');
      console.log(`📊 一般新聞：${last24h.length} 則`);
      return;
    }

    const output = [];
    output.push('🚨 突發重大事件（24 小時內）');
    output.push('');

    breaking.forEach((n, i) => {
      output.push(`${i + 1}. ${n.title}`);
      output.push(`   ⭐ 重要性：${n.analysis.importance} 分`);
      output.push(`   📊 ${n.analysis.marketImplication}`);
      if (n.analysis.affectedAssets.length > 0) {
        output.push(`   🎯 影響：${n.analysis.affectedAssets.join('、')}`);
      }
      if (n.publishedAt) {
        output.push(`   ⏰ ${n.publishedAt}`);
      }
      output.push('');
    });

    output.push('━━━━━━━━━━━━━━━━━━');
    output.push(`📊 共 ${breaking.length} 則重大事件（importance >= 9）`);

    console.log(output.join('\n'));
  }

  /**
   * 搜尋新聞
   */
  async viewSearch(keyword) {
    if (!keyword) {
      console.log('⚠️  請提供搜尋關鍵字');
      console.log('用法：node news-viewer.js search <關鍵字>');
      return;
    }

    const news = await this.loadAnalyzedNews();

    if (news.length === 0) {
      console.log('⚠️  今日無新聞');
      return;
    }

    // 搜尋標題、摘要、標籤
    const results = news.filter(n => {
      const text = `${n.title} ${n.summary || ''} ${n.analysis.tags.join(' ')}`.toLowerCase();
      return text.includes(keyword.toLowerCase());
    });

    if (results.length === 0) {
      console.log(`⚠️  找不到包含「${keyword}」的新聞`);
      return;
    }

    const output = [];
    output.push(`🔍 搜尋結果：「${keyword}」`);
    output.push('');

    results.forEach((n, i) => {
      output.push(`${i + 1}. ${n.title}`);
      output.push(`   ⭐ ${n.analysis.importance} 分 | ${n.analysis.category}`);
      if (n.analysis.tags.length > 0) {
        output.push(`   🏷️  ${n.analysis.tags.join(', ')}`);
      }
      output.push('');
    });

    output.push('━━━━━━━━━━━━━━━━━━');
    output.push(`📊 找到 ${results.length} 則相關新聞`);

    console.log(output.join('\n'));
  }

  /**
   * 查看 Critical 新聞（推播用）
   */
  async viewCritical() {
    const news = await this.loadAnalyzedNews();

    if (news.length === 0) {
      console.log('⚠️  今日無新聞');
      return;
    }

    const critical = news.filter(n => n.analysis.priority === 'critical');

    if (critical.length === 0) {
      console.log('✅ 今日無 Critical 新聞');
      return;
    }

    const output = [];
    output.push('🚨 今日重大事件');
    output.push('');

    critical.forEach((n, i) => {
      output.push(`${i + 1}. ${n.title}`);
      output.push(`   📊 ${n.analysis.marketImplication}`);
      if (n.analysis.affectedAssets.length > 0) {
        output.push(`   🎯 影響：${n.analysis.affectedAssets.join('、')}`);
      }
      output.push('');
    });

    output.push('━━━━━━━━━━━━━━━━━━');
    output.push(`共 ${critical.length} 則（🔴 Critical）`);

    console.log(output.join('\n'));
  }

  /**
   * 盤後摘要
   */
  async viewEveningSummary() {
    const news = await this.loadAnalyzedNews();

    if (news.length === 0) {
      console.log('⚠️  今日無新聞');
      return;
    }

    const critical = news.filter(n => n.analysis.priority === 'critical');
    const high = news.filter(n => n.analysis.priority === 'high');

    const output = [];
    output.push('🌆 盤後財經摘要');
    output.push(`📅 ${new Date().toISOString().split('T')[0]}`);
    output.push('');

    // Critical
    if (critical.length > 0) {
      output.push('🔴 重大事件：');
      critical.forEach((n, i) => {
        output.push(`${i + 1}. ${n.title}`);
      });
      output.push('');
    }

    // High（最多 3 則）
    if (high.length > 0) {
      output.push('🟡 重要新聞：');
      high.slice(0, 3).forEach((n, i) => {
        output.push(`${i + 1}. ${n.title}`);
      });
      if (high.length > 3) {
        output.push(`...還有 ${high.length - 3} 則`);
      }
      output.push('');
    }

    output.push('━━━━━━━━━━━━━━━━━━');
    output.push(`📊 共 ${news.length} 則（🔴 ${critical.length} | 🟡 ${high.length}）`);
    output.push('');
    output.push('💡 完整報告：/news');

    console.log(output.join('\n'));
  }
}

// CLI 使用
if (require.main === module) {
  const viewer = new NewsViewer();
  const action = process.argv[2] || 'today';
  const param = process.argv[3];

  (async () => {
    switch (action) {
      case 'today':
        await viewer.viewToday();
        break;
      case 'breaking':
        await viewer.viewBreaking();
        break;
      case 'search':
        await viewer.viewSearch(param);
        break;
      case 'critical':
        await viewer.viewCritical();
        break;
      case 'evening':
        await viewer.viewEveningSummary();
        break;
      default:
        console.log('用法：node news-viewer.js {today|breaking|search|critical|evening} [參數]');
        console.log('');
        console.log('指令：');
        console.log('  today      查看今日所有新聞');
        console.log('  breaking   查看突發事件（24小時內）');
        console.log('  search     搜尋新聞（需提供關鍵字）');
        console.log('  critical   查看 Critical 新聞');
        console.log('  evening    盤後摘要');
    }
  })();
}

module.exports = NewsViewer;
