// Bullet Formatter - 將新聞轉為 Fact-driven Bullet
class BulletFormatter {
  formatBullet(article) {
    // 移除 emoji 前綴
    let title = article.title.replace(/^[🚨📌ℹ️⭐]\s*/, '');
    
    // 移除媒體標籤格式 《xxx》【xxx】〈xxx〉
    title = title.replace(/[《【〈][^》】〉]+[》】〉]/g, '');
    
    // 移除專家姓名前綴（中文姓名：）
    title = title.replace(/^[趙李王張陳劉楊黃周吳徐孫馬朱胡郭何高林羅鄭梁謝宋唐許韓馮鄧曹彭曾蕭田董袁潘于蔣蔡余杜葉程蘇魏呂丁任沈姚盧姜崔鐘譚陸汪范金石廖賈夏韋付方白鄒孟熊秦邱江尹薛閻段雷侯龍史陶黎賀顧毛郝龔邵萬錢嚴覃武戴莫孔向湯][^：:]+[：:]\s*/, '');
    
    title = title.trim();

    // 提取關鍵信息
    const bullet = this.extractFactDriven(title, article);
    
    return bullet;
  }

  extractFactDriven(title, article) {
    // 改寫成中性語氣（看內容不看標題風格）
    let fact = title;

    // 替換情緒性動詞
    const replacements = {
      '暴跌': '下跌',
      '暴漲': '上漲',
      '飆升': '上升',
      '崩盤': '下跌',
      '大漲': '上漲',
      '大跌': '下跌',
      '狂飆': '上漲',
      '重挫': '下跌',
      '慘跌': '下跌'
    };

    Object.entries(replacements).forEach(([emotion, neutral]) => {
      fact = fact.replace(new RegExp(emotion, 'g'), neutral);
    });

    // 移除驚嘆號和問號
    fact = fact.replace(/[！!？?]/g, '');

    // 移除 clickbait 用詞（但保留內容）
    const clickbaitTerms = [
      '爆料', '驚爆', '獨家', '秘密', '必看', '必買',
      '曝光', '揭秘', '震撼', '重磅'
    ];
    
    clickbaitTerms.forEach(term => {
      fact = fact.replace(new RegExp(term, 'g'), '');
    });

    fact = fact.trim();
    
    return fact;
  }

  // 生成標準化 bullet（未來可擴充為結構化解析）
  generateStructuredBullet(subject, event, data, implication) {
    let parts = [subject, event];
    
    if (data) {
      parts.push(data);
    }
    
    if (implication) {
      parts.push(`(${implication})`);
    }
    
    return parts.join('，');
  }
}

module.exports = BulletFormatter;
