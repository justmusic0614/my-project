// Data Source Adapter Base Class
// 設計目標：可無痛替換數據源（免費 API → 付費 API）

class DataSourceAdapter {
  constructor(name, config) {
    this.name = name;
    this.config = config;
  }

  // 所有 adapter 必須實作這些方法
  async fetchNews() {
    throw new Error('fetchNews() must be implemented');
  }

  async fetchMarketData(symbol) {
    throw new Error('fetchMarketData() must be implemented');
  }

  async fetchTechnicalIndicators(symbol, config) {
    throw new Error('fetchTechnicalIndicators() must be implemented');
  }

  // 統一的錯誤處理與重試邏輯
  async withRetry(fn, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (err) {
        if (i === maxRetries - 1) throw err;
        await this.sleep(1000 * (i + 1));
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 統一的信心度評分
  assessConfidence(data, metadata) {
    const age = Date.now() - new Date(metadata.timestamp).getTime();
    const ageHours = age / (1000 * 60 * 60);
    
    if (!data || Object.keys(data).length === 0) return 'LOW';
    if (ageHours > 24) return 'LOW';
    if (ageHours > 4) return 'MEDIUM';
    return 'HIGH';
  }
}

module.exports = DataSourceAdapter;
