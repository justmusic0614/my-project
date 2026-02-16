/**
 * Schema Migrator - 資料遷移工具
 * 功能：
 * - 將舊格式資料遷移到新 schema
 * - 支援批次遷移
 * - 保留原始資料備份
 */

const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('./logger');
const SchemaValidator = require('./schema-validator');

const logger = createLogger('schema-migrator');
const validator = new SchemaValidator();

class SchemaMigrator {
  constructor(options = {}) {
    this.dryRun = options.dryRun || false;
    this.backup = options.backup !== false; // 預設備份
  }

  /**
   * 遷移新聞資料
   */
  async migrateNews(oldData) {
    logger.info('開始遷移新聞資料');

    // 如果已經是新格式，直接返回
    if (oldData.version === '1.0' && oldData.data) {
      logger.info('資料已經是新格式');
      return oldData;
    }

    const newData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      source: 'market-digest',
      date: oldData.date || new Date().toISOString().split('T')[0],
      count: 0,
      data: []
    };

    // 處理各種舊格式
    if (Array.isArray(oldData)) {
      // 格式 1：直接陣列
      newData.data = oldData.map(item => this.normalizeNewsItem(item));
    } else if (oldData.news) {
      // 格式 2：{ news: [...] }
      newData.data = oldData.news.map(item => this.normalizeNewsItem(item));
    } else if (oldData.items) {
      // 格式 3：{ items: [...] }
      newData.data = oldData.items.map(item => this.normalizeNewsItem(item));
    }

    newData.count = newData.data.length;

    // 驗證
    const validation = validator.validateNews(newData);
    if (!validation.valid) {
      logger.warn('遷移後資料驗證失敗', { errors: validation.errors });
    }

    logger.success('新聞資料遷移完成', { count: newData.count });
    return newData;
  }

  /**
   * 標準化新聞項目
   */
  normalizeNewsItem(item) {
    return {
      id: item.id || this.generateHash(item.title),
      title: item.title || item.content || '',
      source: item.source || item.sourceName || 'Unknown',
      sourceId: item.sourceId || item.source_id || this.slugify(item.source || 'unknown'),
      category: item.category || this.detectCategory(item),
      link: item.link || item.url || '',
      pubDate: this.normalizeDate(item.pubDate || item.publishedAt || item.date),
      description: item.description || item.summary || '',
      importance: item.importance || this.detectImportance(item),
      keywords: item.keywords || this.extractKeywords(item.title || ''),
      analyzed: item.analyzed || false
    };
  }

  /**
   * 遷移市場資料
   */
  async migrateMarketData(oldData) {
    logger.info('開始遷移市場資料');

    const newData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      date: oldData.date || new Date().toISOString().split('T')[0],
      source: 'market-digest',
      indices: {},
      fx: {},
      commodities: {},
      vix: oldData.vix || null
    };

    // 遷移指數資料
    if (oldData.tw_stock) {
      newData.indices.twii = {
        value: oldData.tw_stock.index || 0,
        change: oldData.tw_stock.change || 0,
        changePercent: this.calculatePercent(oldData.tw_stock.change, oldData.tw_stock.index),
        volume: oldData.tw_stock.volume || 0
      };
    }

    if (oldData.us_stock) {
      if (oldData.us_stock.sp500) {
        newData.indices.sp500 = { value: oldData.us_stock.sp500, change: 0, changePercent: 0 };
      }
      if (oldData.us_stock.nasdaq) {
        newData.indices.nasdaq = { value: oldData.us_stock.nasdaq, change: 0, changePercent: 0 };
      }
      if (oldData.us_stock.dow) {
        newData.indices.dow = { value: oldData.us_stock.dow, change: 0, changePercent: 0 };
      }
    }

    // 遷移外匯資料
    if (oldData.fx) {
      if (oldData.fx.usdtwd) {
        newData.fx.usdtwd = { value: oldData.fx.usdtwd, change: 0, changePercent: 0 };
      }
      if (oldData.fx.dxy) {
        newData.fx.dxy = { value: oldData.fx.dxy, change: 0, changePercent: 0 };
      }
    }

    // 遷移商品資料
    if (oldData.commodities) {
      if (oldData.commodities.gold) {
        newData.commodities.gold = { 
          value: oldData.commodities.gold, 
          change: 0, 
          changePercent: 0,
          unit: 'USD/oz'
        };
      }
      if (oldData.commodities.oil) {
        newData.commodities.oil = { 
          value: oldData.commodities.oil, 
          change: 0, 
          changePercent: 0,
          unit: 'USD/bbl'
        };
      }
    }

    logger.success('市場資料遷移完成');
    return newData;
  }

  /**
   * 遷移追蹤清單
   */
  async migrateWatchlist(oldData) {
    logger.info('開始遷移追蹤清單');

    // 如果已經有 version，檢查是否需要更新
    if (oldData.version === '1.0') {
      logger.info('追蹤清單已經是新格式');
      return oldData;
    }

    const newData = {
      version: '1.0',
      stocks: [],
      createdAt: oldData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // 遷移股票項目
    if (oldData.stocks && Array.isArray(oldData.stocks)) {
      newData.stocks = oldData.stocks.map(stock => ({
        code: stock.code,
        name: stock.name,
        addedAt: stock.addedAt || newData.createdAt,
        tags: stock.tags || [],
        notes: stock.notes || ''
      }));
    }

    logger.success('追蹤清單遷移完成', { count: newData.stocks.length });
    return newData;
  }

  /**
   * 批次遷移檔案
   */
  async migrateFile(filePath, type) {
    try {
      logger.info(`遷移檔案：${filePath}`);

      // 備份
      if (this.backup && !this.dryRun) {
        const backupPath = `${filePath}.backup-${Date.now()}`;
        await fs.copyFile(filePath, backupPath);
        logger.info(`已備份：${backupPath}`);
      }

      // 讀取
      const content = await fs.readFile(filePath, 'utf8');
      const oldData = JSON.parse(content);

      // 遷移
      let newData;
      switch (type) {
        case 'news':
          newData = await this.migrateNews(oldData);
          break;
        case 'market-data':
          newData = await this.migrateMarketData(oldData);
          break;
        case 'watchlist':
          newData = await this.migrateWatchlist(oldData);
          break;
        default:
          throw new Error(`Unknown type: ${type}`);
      }

      // 寫入
      if (!this.dryRun) {
        await fs.writeFile(filePath, JSON.stringify(newData, null, 2));
        logger.success(`遷移完成：${filePath}`);
      } else {
        logger.info(`[DRY RUN] 會遷移：${filePath}`);
      }

      return { success: true, file: filePath };

    } catch (error) {
      logger.error(`遷移失敗：${filePath}`, error);
      return { success: false, file: filePath, error: error.message };
    }
  }

  /**
   * 工具方法：生成雜湊
   */
  generateHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * 工具方法：Slugify
   */
  slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  /**
   * 工具方法：偵測類別
   */
  detectCategory(item) {
    const text = (item.title || '') + (item.description || '');
    if (/台股|台灣|台積電|聯發科/.test(text)) return 'Taiwan_Market';
    if (/美股|標普|道瓊|nasdaq/i.test(text)) return 'Equity_Market';
    if (/外匯|美元|台幣/.test(text)) return 'Forex';
    if (/黃金|原油|商品/.test(text)) return 'Commodity';
    return 'General';
  }

  /**
   * 工具方法：偵測重要性
   */
  detectImportance(item) {
    const text = (item.title || '') + (item.description || '');
    if (/暴漲|暴跌|重大|緊急/.test(text)) return 'critical';
    if (/台積電|TSMC|Fed|央行/.test(text)) return 'high';
    return 'medium';
  }

  /**
   * 工具方法：提取關鍵字
   */
  extractKeywords(title) {
    const keywords = [];
    const patterns = ['台積電', 'TSMC', '聯發科', '外資', '台股', '美股', 'Fed', 'AI'];
    for (const kw of patterns) {
      if (title.includes(kw)) keywords.push(kw);
    }
    return keywords;
  }

  /**
   * 工具方法：標準化日期
   */
  normalizeDate(date) {
    if (!date) return new Date().toISOString();
    try {
      return new Date(date).toISOString();
    } catch (e) {
      return new Date().toISOString();
    }
  }

  /**
   * 工具方法：計算百分比
   */
  calculatePercent(change, base) {
    if (!base || base === 0) return 0;
    return (change / (base - change)) * 100;
  }
}

module.exports = SchemaMigrator;
