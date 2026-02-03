// 測試台股新聞來源
const Parser = require('rss-parser');
const parser = new Parser({ timeout: 10000 });

const sources = [
  { name: '自由時報財經', url: 'https://ec.ltn.com.tw/rss/news.xml' },
  { name: '工商時報', url: 'https://ctee.com.tw/feed' },
  { name: '經濟日報', url: 'https://money.udn.com/rssfeed/news/1001/1/5591?ch=money' },
  { name: 'Yahoo 奇摩股市', url: 'https://tw.stock.yahoo.com/rss' }
];

async function testSource(source) {
  try {
    console.log(`\n測試：${source.name}`);
    const feed = await parser.parseURL(source.url);
    console.log(`✅ 成功！取得 ${feed.items.length} 則新聞`);
    console.log(`   範例：${feed.items[0]?.title || 'N/A'}`);
    return true;
  } catch (err) {
    console.log(`❌ 失敗：${err.message}`);
    return false;
  }
}

async function testAll() {
  for (const source of sources) {
    await testSource(source);
  }
}

testAll();
