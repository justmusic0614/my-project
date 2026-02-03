// Time Series Storage System
// 時間序列資料儲存與查詢

const fs = require('fs');
const path = require('path');

class TimeSeriesStorage {
  constructor(basePath = null) {
    this.basePath = basePath || path.join(__dirname, '../data/timeseries');
    this.ensureDirectories();
  }

  /**
   * 確保目錄存在
   */
  ensureDirectories() {
    const dirs = [
      'market-data',
      'news',
      'reports',
      'analytics'
    ];

    for (const dir of dirs) {
      const fullPath = path.join(this.basePath, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }
  }

  /**
   * 取得檔案路徑（按年月分層）
   */
  getFilePath(type, date, filename) {
    const dateObj = new Date(date);
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    
    const dir = path.join(this.basePath, type, String(year), month);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    return path.join(dir, filename);
  }

  /**
   * 儲存市場數據
   */
  async saveMarketData(date, symbol, data) {
    const filename = `${symbol}-${date}.json`;
    const filePath = this.getFilePath('market-data', date, filename);
    
    const record = {
      date,
      symbol,
      timestamp: new Date().toISOString(),
      data
    };
    
    await fs.promises.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
    
    // 更新索引
    await this.updateIndex('market-data', date, symbol, {
      file: filePath,
      close: data.close || null,
      volume: data.volume || null
    });
    
    return filePath;
  }

  /**
   * 儲存新聞資料
   */
  async saveNews(date, news) {
    const filename = `news-${date}.json`;
    const filePath = this.getFilePath('news', date, filename);
    
    const record = {
      date,
      timestamp: new Date().toISOString(),
      count: news.length,
      news
    };
    
    await fs.promises.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
    
    // 更新索引
    await this.updateIndex('news', date, null, {
      file: filePath,
      count: news.length
    });
    
    return filePath;
  }

  /**
   * 儲存報告
   */
  async saveReport(date, report, metadata = {}) {
    // JSON 版本
    const jsonFilename = `report-${date}.json`;
    const jsonPath = this.getFilePath('reports', date, jsonFilename);
    
    const record = {
      date,
      timestamp: new Date().toISOString(),
      metadata,
      report
    };
    
    await fs.promises.writeFile(jsonPath, JSON.stringify(record, null, 2), 'utf8');
    
    // 純文字版本
    const txtFilename = `report-${date}.txt`;
    const txtPath = this.getFilePath('reports', date, txtFilename);
    await fs.promises.writeFile(txtPath, report, 'utf8');
    
    // 更新索引
    await this.updateIndex('reports', date, null, {
      jsonFile: jsonPath,
      txtFile: txtPath,
      length: report.length,
      ...metadata
    });
    
    return { jsonPath, txtPath };
  }

  /**
   * 查詢市場數據
   */
  async loadMarketData(date, symbol) {
    const filename = `${symbol}-${date}.json`;
    const filePath = this.getFilePath('market-data', date, filename);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const content = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(content);
  }

  /**
   * 查詢新聞資料
   */
  async loadNews(date) {
    const filename = `news-${date}.json`;
    const filePath = this.getFilePath('news', date, filename);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const content = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(content);
  }

  /**
   * 查詢報告
   */
  async loadReport(date, format = 'json') {
    const filename = format === 'txt' 
      ? `report-${date}.txt`
      : `report-${date}.json`;
    const filePath = this.getFilePath('reports', date, filename);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const content = await fs.promises.readFile(filePath, 'utf8');
    return format === 'txt' ? content : JSON.parse(content);
  }

  /**
   * 查詢日期範圍
   */
  async queryDateRange(type, startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const results = [];
    
    const current = new Date(start);
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      
      const dir = path.join(this.basePath, type, String(year), month);
      
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        const matchingFiles = files.filter(f => f.includes(dateStr));
        
        for (const file of matchingFiles) {
          const filePath = path.join(dir, file);
          try {
            const content = await fs.promises.readFile(filePath, 'utf8');
            results.push({
              date: dateStr,
              file: filePath,
              data: JSON.parse(content)
            });
          } catch (err) {
            console.error(`讀取 ${filePath} 失敗:`, err.message);
          }
        }
      }
      
      current.setDate(current.getDate() + 1);
    }
    
    return results;
  }

  /**
   * 更新索引（簡易版本，使用 JSON 檔案）
   */
  async updateIndex(type, date, symbol, metadata) {
    const indexFile = path.join(this.basePath, type, 'index.json');
    
    let index = {};
    if (fs.existsSync(indexFile)) {
      try {
        const content = await fs.promises.readFile(indexFile, 'utf8');
        index = JSON.parse(content);
      } catch (err) {
        console.error('讀取索引失敗:', err.message);
      }
    }
    
    const key = symbol ? `${date}_${symbol}` : date;
    index[key] = {
      date,
      symbol,
      timestamp: new Date().toISOString(),
      ...metadata
    };
    
    await fs.promises.writeFile(indexFile, JSON.stringify(index, null, 2), 'utf8');
  }

  /**
   * 取得統計資訊
   */
  async getStats() {
    const stats = {
      marketData: 0,
      news: 0,
      reports: 0
    };
    
    const types = [
      { name: 'marketData', dir: 'market-data' },
      { name: 'news', dir: 'news' },
      { name: 'reports', dir: 'reports' }
    ];
    
    for (const { name, dir } of types) {
      const indexFile = path.join(this.basePath, dir, 'index.json');
      if (fs.existsSync(indexFile)) {
        try {
          const content = await fs.promises.readFile(indexFile, 'utf8');
          const index = JSON.parse(content);
          stats[name] = Object.keys(index).length;
        } catch (err) {
          console.error(`讀取 ${name} 索引失敗:`, err.message);
        }
      }
    }
    
    return stats;
  }

  /**
   * 計算簡易統計指標
   */
  async calculateStats(symbol, startDate, endDate) {
    const data = await this.queryDateRange('market-data', startDate, endDate);
    const closes = data
      .filter(d => d.data.symbol === symbol && d.data.data.close)
      .map(d => d.data.data.close);
    
    if (closes.length === 0) {
      return null;
    }
    
    const mean = closes.reduce((a, b) => a + b, 0) / closes.length;
    const variance = closes.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / closes.length;
    const stdDev = Math.sqrt(variance);
    
    return {
      count: closes.length,
      mean: mean.toFixed(2),
      stdDev: stdDev.toFixed(2),
      min: Math.min(...closes).toFixed(2),
      max: Math.max(...closes).toFixed(2),
      latest: closes[closes.length - 1].toFixed(2)
    };
  }
}

module.exports = TimeSeriesStorage;
