// 新聞翻譯器 - 將英文新聞標題翻譯成繁體中文
// 使用 Clawdbot 的 AI 能力

class NewsTranslator {
  constructor() {
    this.cache = new Map();
  }

  // 批次翻譯新聞標題
  async translateBatch(articles) {
    const toTranslate = articles.filter(article => 
      this.needsTranslation(article.title)
    );

    if (toTranslate.length === 0) {
      return articles;
    }

    console.log(`🌐 翻譯 ${toTranslate.length} 則英文新聞...`);

    // 準備翻譯請求
    const titles = toTranslate.map(a => a.title);
    const translated = await this.translateTitles(titles);

    // 更新文章標題
    const translatedMap = new Map();
    toTranslate.forEach((article, i) => {
      translatedMap.set(article.guid, translated[i]);
    });

    return articles.map(article => {
      if (translatedMap.has(article.guid)) {
        return {
          ...article,
          title_original: article.title,
          title: translatedMap.get(article.guid)
        };
      }
      return article;
    });
  }

  needsTranslation(text) {
    // 簡單判斷：超過 30% 是英文字母
    const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
    const totalChars = text.length;
    return totalChars > 0 && (englishChars / totalChars) > 0.3;
  }

  async translateTitles(titles) {
    // 這裡會整合 Clawdbot 的翻譯能力
    // 暫時使用簡化版：保留專有名詞，翻譯其他
    
    const prompt = `請將以下財經新聞標題翻譯成繁體中文。
保留專有名詞（公司名、人名、地名、指數名稱）的英文原文。
每行一個標題，直接輸出翻譯結果，不要編號：

${titles.join('\n')}`;

    // TODO: 整合 Clawdbot AI
    // 現階段回傳簡化處理
    return this.simplifyTranslation(titles);
  }

  simplifyTranslation(titles) {
    // 簡化版：關鍵詞對照表
    const keywords = {
      'Trump': 'Trump',
      'Fed': 'Fed',
      'Wall Street': 'Wall Street',
      'Bitcoin': 'Bitcoin',
      'S&P 500': 'S&P 500',
      'Nasdaq': 'Nasdaq',
      'raises': '提高',
      'tax': '稅',
      'trading': '交易',
      'stock': '股票',
      'derivatives': '衍生性商品',
      'market': '市場',
      'revenue': '營收',
      'beats': '超過',
      'estimate': '預期',
      'budget': '預算',
      'spending': '支出',
      'investment': '投資',
      'risks': '風險',
      'tariff': '關稅'
    };

    // 暫時保留英文，之後整合 AI 翻譯
    return titles;
  }
}

module.exports = NewsTranslator;
