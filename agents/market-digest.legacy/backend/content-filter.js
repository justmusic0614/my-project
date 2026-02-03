// Content Filter - 嚴格相關性過濾（Ultra Runtime Optimized）
class ContentFilter {
  constructor() {
    // 允許的類別（白名單）
    this.relevantCategories = {
      macro: ['GDP', 'CPI', 'PMI', '通膨', '通胀', '經濟', '经济', '衰退', '成長', '增长'],
      centralBank: ['Fed', 'ECB', 'BoJ', '央行', '聯準會', '联准会', '升息', '降息', '利率', 'FOMC', '貨幣政策', '货币政策'],
      liquidity: ['流動性', '流动性', '美元', '美元指數', 'DXY', '信用', '債券', '债券', '殖利率', '收益率'],
      megaCapEarnings: ['台積電', 'TSMC', 'Apple', 'Microsoft', 'Google', 'Amazon', 'Meta', 'Nvidia', 'Tesla', '財報', '财报', '法說會', '法说会', 'earnings'],
      aiCapex: ['AI', '人工智慧', '人工智能', 'GPU', '資料中心', '数据中心', 'capex', '資本支出', '资本支出', '晶片', '芯片'],
      crossAsset: ['股債', '股债', 'VIX', '避險', '避险', '黃金', '黄金', '石油', 'crude', '商品', 'commodities'],
      taiwanCore: [
        // Mega cap 重大事件
        '台積電', 'TSMC', '聯電', 'UMC', '鴻海', 'Foxconn',
        // 關鍵字必須搭配重要事件詞
        // 不單獨用「台股」「半導體」（會另外檢查）
      ]
    };

    // 明確排除類別（黑名單）
    this.irrelevantKeywords = [
      // Lifestyle
      '房仲', '房地產', '房价', '租金', '裝潢', '装潢', '退休資產',
      // Military
      '國防', '国防', '軍事', '军事', '武器', '飛彈', '导弹', '潛艦', '潜艇', '海鯤',
      // Sports
      '體育', '体育', '球員', '球员', '賽事', '赛事', '奧運', '奥运',
      // KOL / Media
      '網紅', '网红', 'YouTuber', 'Podcast', '直播',
      // Clickbait patterns
      '必看', '必买', '秘密', '獨家', '独家', '爆料', '驚爆', '惊爆',
      // Investment advice tone
      '怎麼走', '怎么走', '紅包行情', '藏寶圖', '向錢衝', '向钱冲', '首選', '佈局', '布局', '搶進',
      '多頭', '空頭', '股王', '飆股', '獲利', '賺錢', '剽悍'
    ];

    // Mega cap 重要事件關鍵字（Taiwan core 嚴格版）
    this.taiwanCoreEvents = [
      '財報', '财报', '法說會', '法说会', 'earnings',
      '投資', '投资', '擴廠', '扩厂', 'capex',
      '產能', '产能', 'capacity',
      '技術', '技术', 'technology', '製程', '制程', 'process',
      '供應鏈', '供应链', 'supply chain',
      '地緣', '地缘', 'geopolitical'
    ];

    // Taiwan 政策/制度關鍵字
    this.taiwanPolicyKeywords = [
      '央行', '財政部', '金管會', '金管会',
      '貨幣政策', '货币政策', '利率決議',
      '稅制', '税制', '補貼', '补贴'
    ];

    // 個股過濾（僅保留 mega cap）
    this.megaCapOnly = ['台積電', 'TSMC', '聯電', 'UMC', '鴻海', 'Foxconn', 
                         'Apple', 'Microsoft', 'Google', 'Amazon', 'Meta', 'Nvidia', 'Tesla'];
    
    // 個股黑名單（非 mega cap）
    this.excludedStocks = ['京鼎', '景碩', '信驊', '昇達科', '大立光', '力積電', '世界'];

    // 專家建議模式（排除）
    this.expertAdvicePatterns = [
      /[：:].*(建議|认为|表示|看法|分析師|分析师|延續|格局|配置)/,
      /專家[：:]/,
      /分析師[：:]/,
      /.*[：:].*(多頭|空頭|看好|看壞|佈局)/,
      // 個人姓名開頭
      /^[趙李王張陳劉楊黃周吳徐孫馬朱胡郭何高林羅鄭梁謝宋唐許韓馮鄧曹彭曾蕭田董袁潘于蔣蔡余杜葉程蘇魏呂丁任沈姚盧姜崔鐘譚陸汪范金石廖賈夏韋付方白鄒孟熊秦邱江尹薛閻段雷侯龍史陶黎賀顧毛郝龔邵萬錢嚴覃武戴莫孔向湯]/
    ];
  }

  isRelevant(article) {
    const title = article.title.toLowerCase();
    const originalTitle = article.title;

    // 1. 檢查黑名單（明確排除）
    if (this.irrelevantKeywords.some(kw => originalTitle.includes(kw))) {
      return false;
    }

    // 2. 檢查專家建議模式
    if (this.expertAdvicePatterns.some(pattern => pattern.test(originalTitle))) {
      return false;
    }

    // 3. 檢查個股黑名單（非 mega cap）
    if (this.excludedStocks.some(stock => originalTitle.includes(stock))) {
      return false;
    }

    // 4. 如果提到個股，必須是 mega cap
    const mentionsStock = /\s[A-Z]{2,5}\s|股|產/.test(originalTitle);
    if (mentionsStock) {
      const isMegaCap = this.megaCapOnly.some(stock => originalTitle.includes(stock));
      if (!isMegaCap) {
        // 除非是產業新聞（不是個股）
        const isIndustryNews = originalTitle.includes('半導體') || 
                               originalTitle.includes('AI') || 
                               originalTitle.includes('晶片');
        if (!isIndustryNews) {
          return false;
        }
      }
    }

    // 5. 檢查是否符合任一相關類別（白名單）
    let matchesCategory = false;

    // 5a. Taiwan core 嚴格檢查
    const mentionsTaiwanMegaCap = this.megaCapOnly.slice(0, 6).some(stock => 
      originalTitle.includes(stock)
    );
    
    if (mentionsTaiwanMegaCap) {
      // 必須搭配重要事件關鍵字
      const hasImportantEvent = this.taiwanCoreEvents.some(event => 
        originalTitle.includes(event)
      );
      
      if (hasImportantEvent) {
        matchesCategory = true;
      }
    }

    // 5b. Taiwan 政策/制度新聞
    const isTaiwanPolicy = this.taiwanPolicyKeywords.some(kw => 
      originalTitle.includes(kw)
    ) && (originalTitle.includes('台灣') || originalTitle.includes('台湾'));
    
    if (isTaiwanPolicy) {
      matchesCategory = true;
    }

    // 5c. 其他相關類別（macro, central bank, liquidity 等）
    if (!matchesCategory) {
      matchesCategory = Object.entries(this.relevantCategories)
        .filter(([key]) => key !== 'taiwanCore') // Taiwan core 已單獨處理
        .some(([key, keywords]) =>
          keywords.some(kw => originalTitle.includes(kw) || title.includes(kw.toLowerCase()))
        );
    }

    return matchesCategory;
  }

  filterArticles(articles) {
    const filtered = articles.filter(article => this.isRelevant(article));
    const removed = articles.length - filtered.length;
    
    if (removed > 0) {
      console.log(`🔍 相關性過濾：移除 ${removed} 則不相關內容`);
    }
    
    return filtered;
  }
}

module.exports = ContentFilter;
