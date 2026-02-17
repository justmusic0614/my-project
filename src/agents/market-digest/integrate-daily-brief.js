#!/usr/bin/env node
/**
 * @deprecated 2026-02-17 - 功能已併入 smart-integrator.js 的統一晨報
 * 使用 `node smart-integrator.js push --level standard` 取代
 * 將於穩定運行一週後刪除
 *
 * 原功能：將 Daily Brief 整合到 /today 指令
 */

const fs = require('fs');
const path = require('path');
const { smartIntegrate } = require('./smart-integrator');
const DailyBriefGenerator = require('./daily-brief-generator');

/**
 * 生成財經新聞區塊
 */
async function generateNewsSection() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const newsPath = path.join(__dirname, 'data/news-analyzed', `${today}.json`);
    
    // 讀取分析過的新聞
    let newsData;
    try {
      const content = fs.readFileSync(newsPath, 'utf8');
      newsData = JSON.parse(content);
    } catch (error) {
      return null;  // 無新聞資料
    }
    
    const news = newsData.news || [];
    if (news.length === 0) {
      return null;
    }
    
    // 依優先級分類
    const critical = news.filter(n => n.analysis.priority === 'critical');
    const high = news.filter(n => n.analysis.priority === 'high');
    
    const output = [];
    output.push('📰 今日重要財經新聞');
    output.push('');
    
    // Critical（最多 3 則）
    if (critical.length > 0) {
      output.push('🔴 重大事件（立即關注）');
      critical.slice(0, 3).forEach((n, i) => {
        output.push(`${i + 1}. ${n.title}`);
        output.push(`   📊 ${n.analysis.marketImplication}`);
      });
      output.push('');
    }
    
    // High（最多 3 則）
    if (high.length > 0) {
      output.push('🟡 重要新聞（每日彙整）');
      high.slice(0, 3).forEach((n, i) => {
        output.push(`${i + 1}. ${n.title}`);
        // 加入核心意義摘要（限制長度避免過長）
        const implication = n.analysis.marketImplication || '市場影響待觀察';
        output.push(`   💡 ${implication.substring(0, 40)}${implication.length > 40 ? '...' : ''}`);
      });
      if (high.length > 3) {
        output.push(`...還有 ${high.length - 3} 則`);
      }
      output.push('');
    }
    
    output.push('💡 完整新聞：/news');
    
    return output.join('\n');
    
  } catch (error) {
    console.error('生成新聞區塊失敗:', error.message);
    return null;
  }
}

async function generateWithDailyBrief(level = 'standard') {
  console.log('🔄 生成包含 Daily Brief 的報告...\n');

  try {
    // Step 1: 生成 Daily Brief
    console.log('📊 Step 1: 生成 Daily Brief...');
    const briefGenerator = new DailyBriefGenerator();
    const dailyBrief = await briefGenerator.generate();
    
    if (!dailyBrief) {
      console.log('⚠️  Daily Brief 生成失敗，使用原始報告');
      return await smartIntegrate(level);
    }
    
    await briefGenerator.saveToFile(dailyBrief);
    console.log('✅ Daily Brief 完成\n');

    // Step 2: 生成原始報告（如果有 LINE 早報）
    console.log('📝 Step 2: 生成早報摘要...');
    let morningReport = '';
    
    try {
      morningReport = await smartIntegrate(level);
      console.log('✅ 早報摘要完成\n');
    } catch (error) {
      console.log('⚠️  今日無早報資料，僅使用 Daily Brief\n');
    }

    // Step 3: 整合早報
    console.log('🔗 Step 3: 整合早報...');
    
    let finalReport = '';
    
    if (morningReport && morningReport.length > 0) {
      finalReport = dailyBrief + '\n\n━━━━━━━━━━━━━━━━━━\n\n' +
                    '📰 今日早報摘要\n\n' + morningReport;
    } else {
      finalReport = dailyBrief;
    }
    
    // Step 4: 整合財經新聞
    console.log('📰 Step 4: 整合財經新聞...');
    const newsSection = await generateNewsSection();
    if (newsSection) {
      finalReport += '\n\n━━━━━━━━━━━━━━━━━━\n\n' + newsSection;
      console.log('✅ 新聞整合完成\n');
    } else {
      console.log('⚠️  今日無財經新聞\n');
    }

    // Step 5: 儲存最終報告
    const outputPath = path.join(__dirname, 'data/runtime/morning-report.txt');
    fs.writeFileSync(outputPath, finalReport);
    
    console.log('✅ 整合完成！\n');
    console.log(`📂 報告位置：${outputPath}`);
    console.log(`📏 長度：${finalReport.length} 字元\n`);

    return finalReport;

  } catch (error) {
    console.error('❌ 整合失敗:', error);
    throw error;
  }
}

if (require.main === module) {
  const level = process.argv[2] || 'standard';
  
  generateWithDailyBrief(level)
    .then(report => {
      const showFull = process.argv.includes('--full');
      
      if (showFull) {
        // 完整輸出（僅在明確要求時）
        console.log('━━━━━━━━━━━━━━━━━━');
        console.log('📄 報告預覽：');
        console.log('━━━━━━━━━━━━━━━━━━\n');
        console.log(report.substring(0, 1500) + '...\n');
      } else {
        // 精簡輸出（預設）
        console.log('\n✅ 報告生成完成');
        console.log(`📂 位置：~/clawd/agents/market-digest/data/runtime/morning-report.txt`);
        console.log(`📏 長度：${report.length} 字元`);
        console.log('\n💡 使用 read 工具查看完整內容');
      }
    })
    .catch(error => {
      console.error('執行失敗:', error);
      process.exit(1);
    });
}

module.exports = { generateWithDailyBrief };
