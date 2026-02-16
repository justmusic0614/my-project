// English Residue Cleaner - 15% threshold gate
class EnglishCleaner {
  constructor() {
    // PROPER_NOUN_ALLOWLIST（严格版）
    this.properNouns = [
      'Fed', 'ECB', 'BOJ', 'FOMC',
      'GDP', 'CPI', 'PPI', 'PMI', 'VIX', 'WTI', 'DXY',
      'TSMC', 'AI', 'GPU',
      'US10Y', 'SPX', 'Nasdaq'
    ];
    
    // 扩展列表（常见但可翻译）
    this.extendedNouns = [
      'Apple', 'Microsoft', 'Google', 'Amazon', 'Meta', 'Nvidia', 'Tesla',
      'UMC', 'Foxconn',
      'Trump', 'Biden', 'Powell',
      'CEO', 'CFO',
      'S&P', 'Dow', 'TAIEX',
      'USD', 'TWD', 'EUR', 'JPY', 'CNY'
    ];
  }

  calculateEnglishRatio(text) {
    // 移除允许的专有名词（核心 + 扩展）
    let cleanedText = text;
    const allAllowed = [...this.properNouns, ...this.extendedNouns];
    
    allAllowed.forEach(noun => {
      cleanedText = cleanedText.replace(new RegExp(noun, 'gi'), '');
    });

    // 计算剩余英文字母比例
    const englishChars = (cleanedText.match(/[a-zA-Z]/g) || []).length;
    const totalChars = cleanedText.replace(/\s/g, '').length;
    
    if (totalChars === 0) return 0;
    
    return englishChars / totalChars;
  }

  needsCleaning(text) {
    // ENGLISH_RESIDUE_GATE: 25% threshold
    return this.calculateEnglishRatio(text) > 0.25;
  }

  clean(text) {
    let cleaned = text;
    
    // APOSTROPHE_FIXER: "X's" => "X 的"
    cleaned = cleaned.replace(/(\w+)'s\s/g, '$1 的 ');
    
    // 增强翻译映射（常见残留词）
    const translations = {
      // Prepositions & connectors
      'to': '至',
      'from': '來自', 
      'From': '來自',
      'with': '隨著',
      'With': '隨著',
      'on': '於',
      'On': '於',
      'in': '在',
      'In': '在',
      'at': '於',
      'At': '於',
      'for': '為',
      'For': '為',
      'by': '由',
      'By': '由',
      
      // Verbs
      'Add': '增加',
      'Adds': '增加',
      'Is': '為',
      'Are': '為',
      'Vanishes': '消失',
      'Vanish': '消失',
      'Slide': '下滑',
      'Slides': '下滑',
      'Rise': '上升',
      'Rises': '上升',
      'Fall': '下跌',
      'Falls': '下跌',
      'Rally': '反彈',
      'Rallies': '反彈',
      
      // Adjectives & nouns
      'Latest': '最新',
      'Risk': '風險',
      'Risks': '風險',
      'Outlook': '展望',
      'Growth': '成長',
      'Inflation': '通膨',
      'Blow': '打擊',
      'Traders': '交易員',
      'Pressure': '壓力',
      'Budget': '預算',
      'Spending': '支出',
      'Push': '推動',
      'Most': '最',
      'Since': '自',
      'After': '之後',
      'Amid': '因應'
    };

    Object.entries(translations).forEach(([en, zh]) => {
      cleaned = cleaned.replace(new RegExp(`\\b${en}\\b`, 'g'), zh);
    });

    return cleaned.trim();
  }

  // FRAGMENT_DETECTOR: 检测破碎翻译
  isBrokenTranslation(text) {
    const prepositions = ['to', 'from', 'with', 'add', 'on', 'in', 'at', 'for', 'by'];
    const englishFragments = text.match(/\b[a-zA-Z]{3,}\b/g) || [];
    
    // 移除允许的专有名词
    const allAllowed = [...this.properNouns, ...this.extendedNouns];
    const nonAllowedFragments = englishFragments.filter(word => 
      !allAllowed.some(noun => noun.toLowerCase() === word.toLowerCase())
    );

    // 如果有 >=2 个非允许英文词 AND 包含介词
    const hasPrepositions = prepositions.some(prep => 
      text.toLowerCase().includes(prep)
    );

    return nonAllowedFragments.length >= 2 && hasPrepositions;
  }

  cleanBatch(articles) {
    return articles.map(article => {
      let title = article.title;
      
      // FRAGMENT_DETECTOR + 改写逻辑
      if (this.isBrokenTranslation(title)) {
        // 第一次改写
        title = this.clean(title);
        
        if (this.isBrokenTranslation(title)) {
          // 第二次改写
          title = this.clean(title);
          
          if (this.isBrokenTranslation(title)) {
            console.log(`⚠️  破碎翻译，丢弃：${article.title}`);
            return null;
          }
        }
      }
      
      // ENGLISH_RESIDUE_GATE (25%)
      if (this.needsCleaning(title)) {
        // 第一次改写
        title = this.clean(title);
        
        if (this.needsCleaning(title)) {
          // 第二次改写
          title = this.clean(title);
          
          if (this.needsCleaning(title)) {
            console.log(`⚠️  高英文残留，丢弃：${article.title}`);
            return null;
          }
        }
      }
      
      return {
        ...article,
        title: title,
        title_original: article.title
      };
    }).filter(a => a !== null);
  }
}

module.exports = EnglishCleaner;
