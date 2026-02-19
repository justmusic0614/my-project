/**
 * ImportanceScorer — 新聞重要性評分器
 * Phase 3 第三步：在 AI 分析前做規則式預篩選
 *
 * 功能：
 *   1. 基於關鍵字規則將新聞評為 P0-P3
 *   2. 計算原始分數（0-100），供 AI 分析排序參考
 *   3. 識別觸發地緣政治查詢的事件
 *   4. 輸出按 P0→P3 排序的新聞清單
 *
 * 評分邏輯：
 *   - 關鍵字命中 → 加分（P0 關鍵字 +40, P1 +25, P2 +15）
 *   - 來源可信度 → 加分（P0 source +10, P1 +5）
 *   - 新鮮度 → 加分（6h 內 +15, 12h 內 +10, 24h 內 +0）
 *   - 滿分 100
 */

'use strict';

const { createLogger } = require('../shared/logger');

const logger = createLogger('processor:importance-scorer');

// 關鍵字配置（與 rss-collector.js IMPORTANCE_KEYWORDS 對齊，此為完整版）
const KEYWORDS = {
  P0: [
    // 總經政策
    'Fed', 'FOMC', 'CPI', 'PCE', 'GDP', 'NFP', '非農', '央行', '升息', '降息',
    'interest rate', 'rate hike', 'rate cut', 'quantitative', 'QT', 'QE',
    'recession', '衰退', 'inflation', '通膨', 'unemployment', '失業率',
    // 系統性事件
    'default', '違約', 'bankruptcy', '破產', 'bailout', '紓困',
    'financial crisis', '金融危機', 'systemic risk', 'market crash',
    // 地緣政治
    'war', '戰爭', 'conflict', '衝突', 'sanctions', '制裁', 'invasion', '入侵'
  ],
  P1: [
    // 重要財報/法說
    'earnings', '財報', 'revenue', 'EPS', '法說會', 'guidance', '展望',
    'beat', 'miss', 'estimate', 'forecast',
    // 核心持股
    'NVIDIA', 'NVDA', '台積電', 'TSMC', 'TSM', 'Apple', 'AAPL',
    'Microsoft', 'MSFT', 'Google', 'Alphabet', 'GOOGL', 'Amazon', 'AMZN',
    'Meta', 'Broadcom', 'AVGO', 'AMD', 'Intel',
    // 產業主題
    'AI', 'artificial intelligence', '人工智慧', 'semiconductor', '半導體',
    'chip', '晶片', 'CoWoS', 'HBM', 'GPU', 'data center', '資料中心'
  ],
  P2: [
    // 法人籌碼
    '外資', '投信', '自營商', '三大法人', '買超', '賣超',
    'institutional', 'foreign', 'net buy', 'net sell',
    // 融資融券
    '融資', '融券', 'margin', 'short interest',
    // 一般市場
    '美股', '台股', '大盤', '指數', 'S&P', 'Nasdaq', '那斯達克', 'Dow',
    '漲跌', '收盤', 'close', '成交量', 'volume'
  ]
};

// 黑名單關鍵字（娛樂/點擊誘導/政治社會類，強制降為 P3）
const BLACKLIST_KEYWORDS = [
  // 娛樂/體育
  '胡瓜', '綜藝', '演藝', '藝人', '明星', '電影', '戲劇', '偶像',
  '球賽', '選手', '運動員', '比賽', '奧運', '世界盃', 'NBA', 'MLB',
  '音樂', '演唱會', '歌手', 'KTV', '遊戲', '電競',
  // 點擊誘導
  '驚爆', '獨家', '震撼', '震驚', '必看', '秘訣', '內幕', '爆料', '揭密',
  '淘金攻略', '潛力黑馬', '飆股', '神準', '必賺', '穩賺',
  '名嘴', '專家說', '大師', '算命', '風水', '命理',
  // 政治/社會事件
  '選舉', '投票', '候選人', '政黨', '立委', '議員', '市長', '總統',
  '抗議', '示威', '遊行', '罷工', '陳情', '請願',
  // 生活/教育/文化
  '旅遊', '觀光', '美食', '餐廳', '咖啡', '甜點',
  '學校', '大學', '考試', '升學', '補習班',
  '展覽', '博物館', '藝術', '文化節', '慶典'
];

// 來源可信度等級
const SOURCE_CREDIBILITY = {
  P0: ['sec-edgar', 'reuters', 'bloomberg', 'wsj', 'ft'],
  P1: ['cnbc-business', 'cnbc-investing', 'yahoo-finance', 'yahoo-tw']
};

// 地緣政治觸發關鍵字（觸發 Perplexity 地緣政治查詢）
const GEOPOLITICS_TRIGGERS = [
  'war', '戰爭', 'military', '軍事', 'sanctions', '制裁', 'nuclear', '核武',
  'Taiwan Strait', '台海', 'China', '中國', 'Russia', '俄羅斯',
  'Middle East', '中東', 'oil supply', '石油供應', 'OPEC'
];

class ImportanceScorer {
  /**
   * 對新聞陣列評分並排序
   * @param {object[]} newsItems
   * @returns {{ scored: ScoredNewsItem[], geopoliticsTrigger: boolean }}
   */
  score(newsItems) {
    if (!Array.isArray(newsItems) || newsItems.length === 0) {
      return { scored: [], geopoliticsTrigger: false };
    }

    const scored = newsItems.map(item => this._scoreItem(item));

    // 按 P0→P3，再按 rawScore 降序排序
    scored.sort((a, b) => {
      const pa = this._priorityNum(a.importance);
      const pb = this._priorityNum(b.importance);
      if (pa !== pb) return pa - pb;
      return b.rawScore - a.rawScore;
    });

    const geopoliticsTrigger = this._checkGeopoliticsTrigger(newsItems);

    const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
    scored.forEach(s => { counts[s.importance] = (counts[s.importance] || 0) + 1; });

    logger.info('importance scoring complete', {
      total: scored.length,
      P0: counts.P0, P1: counts.P1, P2: counts.P2, P3: counts.P3,
      geopoliticsTrigger
    });

    return { scored, geopoliticsTrigger };
  }

  /**
   * 對單一新聞評分
   */
  _scoreItem(item) {
    const text   = `${item.title || ''} ${item.summary || ''}`;
    let score    = 0;
    let priority = 'P3';

    // 黑名單檢查（優先，強制降為 P3）
    const isBlacklisted = BLACKLIST_KEYWORDS.some(kw => text.toLowerCase().includes(kw.toLowerCase()));
    if (isBlacklisted) {
      return {
        ...item,
        importance: 'P3',
        rawScore: 5  // 基礎分
      };
    }

    // 關鍵字評分（P0 優先）
    let p0Hit = 0, p1Hit = 0, p2Hit = 0;

    for (const kw of KEYWORDS.P0) {
      if (text.toLowerCase().includes(kw.toLowerCase())) p0Hit++;
    }
    for (const kw of KEYWORDS.P1) {
      if (text.toLowerCase().includes(kw.toLowerCase())) p1Hit++;
    }
    for (const kw of KEYWORDS.P2) {
      if (text.toLowerCase().includes(kw.toLowerCase())) p2Hit++;
    }

    // 決定優先級（任一命中即升級）
    if (p0Hit > 0) {
      priority = 'P0';
      score += Math.min(40 + (p0Hit - 1) * 5, 60); // P0 命中 40-60 分
    } else if (p1Hit > 0) {
      priority = 'P1';
      score += Math.min(25 + (p1Hit - 1) * 5, 45); // P1 命中 25-45 分
    } else if (p2Hit > 0) {
      priority = 'P2';
      score += Math.min(15 + (p2Hit - 1) * 3, 30); // P2 命中 15-30 分
    } else {
      score += 5; // P3 基礎分
    }

    // 原始重要性（從 RSS 收集器傳入）也計入
    if (item.importance && item.importance !== 'P3') {
      const existingBonus = { P0: 10, P1: 8, P2: 4 };
      score += existingBonus[item.importance] || 0;
      // 取最高優先級
      if (this._priorityNum(item.importance) < this._priorityNum(priority)) {
        priority = item.importance;
      }
    }

    // 來源可信度加分
    const src = (item.source || '').toLowerCase();
    if (SOURCE_CREDIBILITY.P0.some(s => src.includes(s))) {
      score += 10;
    } else if (SOURCE_CREDIBILITY.P1.some(s => src.includes(s))) {
      score += 5;
    }

    // 新鮮度加分
    const ageMs = Date.now() - new Date(item.publishedAt || 0).getTime();
    const ageHours = ageMs / 3600000;
    if (ageHours <= 6)  score += 15;
    else if (ageHours <= 12) score += 10;
    // >12h: +0

    return {
      ...item,
      importance: priority,
      rawScore: Math.min(score, 100)
    };
  }

  /**
   * 檢查是否有地緣政治觸發事件
   */
  _checkGeopoliticsTrigger(newsItems) {
    const allText = newsItems.map(n => `${n.title} ${n.summary || ''}`).join(' ');
    return GEOPOLITICS_TRIGGERS.some(kw => allText.toLowerCase().includes(kw.toLowerCase()));
  }

  _priorityNum(p) {
    return { P0: 0, P1: 1, P2: 2, P3: 3 }[p] ?? 3;
  }

  /**
   * 篩選 AI 輸入新聞（Top N 或按優先級門檻）
   * @param {object[]} scored - score() 的輸出
   * @param {object}   opts
   * @param {number}   opts.maxForHaiku   - 送入 Haiku 的最大筆數（預設 50）
   * @param {number}   opts.maxForSonnet  - 送入 Sonnet 的最大筆數（預設 15）
   * @returns {{ forHaiku: object[], forSonnet: object[] }}
   */
  selectForAI(scored, opts = {}) {
    const maxForHaiku  = opts.maxForHaiku  ?? 50;
    const maxForSonnet = opts.maxForSonnet ?? 15;

    // Haiku 接收 P0-P3 的前 N 筆
    const forHaiku = scored.slice(0, maxForHaiku);

    // Sonnet 接收 Haiku 評分後的 Top N（外部傳入 haiku 結果後再呼叫）
    // 這裡先返回規則式篩選的 P0+P1
    const highPriority = scored.filter(n => n.importance === 'P0' || n.importance === 'P1');
    const forSonnet = highPriority.length >= maxForSonnet
      ? highPriority.slice(0, maxForSonnet)
      : [...highPriority, ...scored.filter(n => n.importance === 'P2')].slice(0, maxForSonnet);

    return { forHaiku, forSonnet };
  }
}

// 單例
const importanceScorer = new ImportanceScorer();

module.exports = importanceScorer;
module.exports.ImportanceScorer = ImportanceScorer;
module.exports.KEYWORDS = KEYWORDS;
module.exports.GEOPOLITICS_TRIGGERS = GEOPOLITICS_TRIGGERS;
