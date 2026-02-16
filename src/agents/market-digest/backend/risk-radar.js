// Risk Radar Generator - CRITICAL 等級必須輸出
class RiskRadarGenerator {
  generate(criticalNews, marketData) {
    if (!criticalNews || criticalNews.length === 0) {
      return null;
    }

    // 選擇最重要的 CRITICAL 新聞
    const topCritical = criticalNews[0];
    
    return {
      trigger: this.extractTrigger(topCritical),
      immediate_reaction: this.extractReaction(topCritical, marketData),
      key_uncertainty: this.extractUncertainty(topCritical)
    };
  }

  extractTrigger(news) {
    // 簡化版：直接用新聞標題作為觸發因素
    let trigger = news.title.replace(/^[🚨📌ℹ️⭐]\s*/, '');
    trigger = trigger.replace(/《[^》]+》/g, '').trim();
    return trigger;
  }

  extractReaction(news, marketData) {
    // 基於市場數據推斷反應（市場关闭/延迟/低信心 => N/A）
    const reactions = [];

    if (marketData.tw_stock) {
      const tw = marketData.tw_stock.data;
      const meta = marketData.tw_stock.metadata;
      
      // 检查是否为延迟/低信心数据
      if (meta.confidence === 'LOW' || tw.changePct === null || tw.changePct === 0) {
        reactions.push('台股：N/A（市场关闭/延迟）');
      } else if (tw.changePct) {
        const direction = tw.changePct > 0 ? '上涨' : '下跌';
        reactions.push(`台股${direction} ${Math.abs(tw.changePct).toFixed(2)}%`);
      }
    }

    if (marketData.us_stock) {
      const us = marketData.us_stock.gspc?.data;
      const meta = marketData.us_stock.gspc?.metadata;
      
      if (meta && meta.confidence === 'LOW' || !us || us.changePct === null) {
        reactions.push('美股：N/A（数据不足）');
      } else if (us && us.changePct) {
        const direction = us.changePct > 0 ? '上涨' : '下跌';
        reactions.push(`美股${direction} ${Math.abs(us.changePct).toFixed(2)}%`);
      }
    }

    return reactions.length > 0 ? reactions.join('；') : 'N/A（数据不足）';
  }

  extractUncertainty(news) {
    // 關鍵不確定性（簡化版）
    const title = news.title.toLowerCase();
    
    if (title.includes('fed') || title.includes('央行') || title.includes('聯準會')) {
      return '政策路徑與時機';
    }
    
    if (title.includes('tariff') || title.includes('關稅') || title.includes('貿易')) {
      return '貿易政策發展';
    }
    
    if (title.includes('bitcoin') || title.includes('比特幣') || title.includes('crypto')) {
      return '加密貨幣監管動向';
    }
    
    return '後續發展與市場反應';
  }
}

module.exports = RiskRadarGenerator;
