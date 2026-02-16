#!/usr/bin/env node
const AIClient = require('./ai-client');

const watchlist = [
  { code: '2330', name: '台積電' },
  { code: '2454', name: '聯發科' },
  { code: '2408', name: '南亞科' }
];

const aiClient = new AIClient({ watchlist });

const testNews = {
  title: "Disney names parks boss Josh D'Amaro as its next CEO",
  summary: "Disney announced that Josh D'Amaro will become the company's next CEO.",
  source: "CNBC Business News"
};

(async () => {
  console.log('測試新聞：', testNews.title);
  console.log('');
  
  try {
    const result = await aiClient.analyze(testNews);
    console.log('分析結果：', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('分析失敗：', error);
  }
})();
