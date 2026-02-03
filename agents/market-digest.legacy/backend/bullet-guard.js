// POST_RENDER_BULLET_GUARD - 确定性后处理（无 LLM）
class BulletGuard {
  constructor() {
    this.maxLength = 45;
    this.preferredLength = 28;
    this.englishThreshold = 0.15;
    
    // 允许的专有名词
    this.properNouns = [
      'Fed', 'ECB', 'BOJ', 'FOMC',
      'GDP', 'CPI', 'PPI', 'PMI', 'VIX', 'WTI', 'DXY',
      'TSMC', 'AI', 'GPU',
      'US10Y', 'SPX', 'Nasdaq', 'S&P'
    ];
  }

  guard(bullet) {
    let result = bullet;

    // 1. 长度检查
    if (this.getLength(result) > this.maxLength) {
      result = this.truncate(result);
    }

    // 2. 英文比例检查
    if (this.getEnglishRatio(result) > this.englishThreshold) {
      result = this.stripNonAllowedEnglish(result);
    }

    return result;
  }

  getLength(text) {
    // 中文字符计 1，英文/数字/空格计 0.5
    let length = 0;
    for (const char of text) {
      if (/[\u4e00-\u9fa5]/.test(char)) {
        length += 1; // 中文
      } else {
        length += 0.5; // 英文/数字/符号
      }
    }
    return Math.ceil(length);
  }

  truncate(text) {
    // 截断至 42 + "…"
    let length = 0;
    let result = '';
    
    for (const char of text) {
      const charLen = /[\u4e00-\u9fa5]/.test(char) ? 1 : 0.5;
      if (length + charLen > 42) break;
      result += char;
      length += charLen;
    }
    
    return result.trim() + '…';
  }

  getEnglishRatio(text) {
    // 移除允许的专有名词
    let cleaned = text;
    this.properNouns.forEach(noun => {
      cleaned = cleaned.replace(new RegExp(noun, 'gi'), '');
    });

    const englishChars = (cleaned.match(/[a-zA-Z]/g) || []).length;
    const totalChars = cleaned.replace(/\s/g, '').length;
    
    if (totalChars === 0) return 0;
    
    return englishChars / totalChars;
  }

  stripNonAllowedEnglish(text) {
    // 移除非允许的英文词（简单处理）
    const words = text.split(/\s+/);
    const cleaned = words.map(word => {
      // 如果是专有名词，保留
      if (this.properNouns.some(noun => word.includes(noun))) {
        return word;
      }
      
      // 如果是纯英文词（非专有名词），移除
      if (/^[a-zA-Z]+$/.test(word)) {
        return '';
      }
      
      return word;
    }).filter(w => w.length > 0);
    
    return cleaned.join(' ').replace(/\s+/g, ' ').trim();
  }

  guardBatch(sectionBullets) {
    const guarded = {};
    
    Object.entries(sectionBullets).forEach(([section, bullets]) => {
      guarded[section] = bullets.map(bullet => this.guard(bullet));
    });
    
    return guarded;
  }
}

module.exports = BulletGuard;
