// Section Router - 分配事件到適當的 section
class SectionRouter {
  constructor() {
    // Section 定義與關鍵字
    this.sections = {
      macro_policy: {
        keywords: ['Fed', 'ECB', 'BoJ', '央行', '聯準會', 'FOMC', '貨幣政策', 
                   'GDP', 'CPI', 'PMI', '通膨', '政策', '利率', '升息', '降息',
                   '流動性', '信用', '債券', '殖利率'],
        priority: 1
      },
      equity_market: {
        keywords: ['earnings', '財報', '法說會', 'capex', '資本支出',
                   'Apple', 'Microsoft', 'Google', 'Amazon', 'Meta', 'Nvidia', 'Tesla',
                   '台積電', 'TSMC', 'AI', 'GPU', '晶片', '半導體'],
        priority: 2
      },
      cross_asset: {
        keywords: ['USD', 'DXY', '美元', 'VIX', '避險', '黃金', '石油', 
                   'crude', 'WTI', 'commodities', '商品', 'UST', '美債'],
        priority: 3
      },
      taiwan_market: {
        keywords: ['TAIEX', '台股', '加權', 'TWD', '台幣', '台灣央行'],
        priority: 4
      }
    };
  }

  route(article) {
    const title = article.title.toLowerCase();
    const originalTitle = article.title;

    // 按優先順序檢查
    const sectionOrder = ['macro_policy', 'equity_market', 'cross_asset', 'taiwan_market'];
    
    for (const sectionKey of sectionOrder) {
      const section = this.sections[sectionKey];
      const matches = section.keywords.some(kw => 
        originalTitle.includes(kw) || title.includes(kw.toLowerCase())
      );
      
      if (matches) {
        return sectionKey;
      }
    }

    // 預設：Daily Snapshot
    return 'daily_snapshot';
  }

  routeBatch(articles) {
    const routed = {
      daily_snapshot: [],
      macro_policy: [],
      equity_market: [],
      cross_asset: [],
      taiwan_market: []
    };

    articles.forEach(article => {
      const section = this.route(article);
      routed[section].push(article);
    });

    return routed;
  }
}

module.exports = SectionRouter;
