// RSS News Feed Adapter
const DataSourceAdapter = require('./adapter');
const Parser = require('rss-parser');

class RSSAdapter extends DataSourceAdapter {
  constructor(name, url, config) {
    super(name, config);
    this.url = url;
    this.parser = new Parser({
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ClawbotDigest/1.0)'
      }
    });
  }

  async fetchNews() {
    return this.withRetry(async () => {
      const feed = await this.parser.parseURL(this.url);
      
      const articles = feed.items.map(item => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate || item.isoDate,
        summary: item.contentSnippet || item.summary || '',
        source: this.name,
        guid: item.guid || item.link
      }));

      return {
        data: articles,
        metadata: {
          source: this.name,
          timestamp: new Date().toISOString(),
          count: articles.length,
          confidence: 'HIGH'
        }
      };
    });
  }
}

module.exports = RSSAdapter;
