// AI 翻譯器 - 使用簡單的規則翻譯
// 未來可整合更完整的翻譯 API

class AITranslator {
  translateTitle(title) {
    // 專有名詞保留
    const preserved = {
      'Trump': 'Trump',
      'Fed': 'Fed',
      'Wall Street': 'Wall Street',
      'Bitcoin': 'Bitcoin',
      'S&P 500': 'S&P 500',
      'Nasdaq': 'Nasdaq',
      'Warsh': 'Warsh',
      'SNAP': 'SNAP',
      'Kevin Warsh': 'Kevin Warsh',
      'GDP': 'GDP',
      'CPI': 'CPI'
    };

    // 關鍵詞翻譯對照
    const translations = {
      'Wall Street Week': 'Wall Street 週報',
      'Picks': '提名',
      'US State Capitalism': '美國國家資本主義',
      'Cuts': '削減',
      'Business of Youth Sports': '青少年體育產業',
      'India Raises Tax': '印度提高稅收',
      'Stock Derivatives Trading': '股票衍生品交易',
      'Blow to Traders': '對交易員的打擊',
      'Record': '創紀錄',
      'Debt Sales': '債券發行',
      'Pressure': '施壓',
      'Bonds': '債券',
      'Break Below': '跌破',
      'Signals': '顯示',
      'Crisis of Confidence': '信心危機',
      'Regulating': '監管',
      'Expanding': '擴張中的',
      'Gambling Market': '博弈市場',
      'Gaming Revenue': '博弈營收',
      'Beats Estimate': '超過預期',
      'Entertainment Offerings': '娛樂項目',
      'Clarifies': '澄清',
      'Weak Yen': '日元疲軟',
      'Remarks': '言論',
      'Election Rally': '選舉造勢',
      'Coal Association': '煤炭協會',
      'Quota': '配額',
      'Risks': '可能導致',
      'Mine Shutdowns': '礦場關閉',
      'Vows to Speed Up': '承諾加速',
      'Investment Law': '投資法',
      'Tariff': '關稅',
      'Spending Push': '支出推動',
      'Budget': '預算',
      'Counter Global Risks': '應對全球風險'
    };

    // 簡單替換式翻譯
    let translated = title;
    
    // 先保護專有名詞
    Object.entries(preserved).forEach(([en, zh]) => {
      translated = translated.replace(new RegExp(en, 'g'), `__${en}__`);
    });

    // 翻譯關鍵片語
    Object.entries(translations).forEach(([en, zh]) => {
      translated = translated.replace(new RegExp(en, 'gi'), zh);
    });

    // 恢復專有名詞
    Object.entries(preserved).forEach(([en, zh]) => {
      translated = translated.replace(new RegExp(`__${en}__`, 'g'), zh);
    });

    // 如果翻譯後仍有大量英文，保留原文
    const englishRatio = (translated.match(/[a-zA-Z]/g) || []).length / translated.length;
    if (englishRatio > 0.5) {
      return title;  // 保留原文
    }

    return translated;
  }

  needsTranslation(text) {
    const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
    const totalChars = text.length;
    return totalChars > 0 && (englishChars / totalChars) > 0.4;
  }
}

module.exports = AITranslator;
