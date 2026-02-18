/**
 * Daily Brief Schema — Pipeline 資料結構定義
 *
 * 定義整個 Daily Brief 從 Phase 1→4 流動的資料格式。
 * 包含各層 Schema：
 *   - MarketData      (市場行情數據)
 *   - NewsItem        (新聞條目)
 *   - WatchlistItem   (Watchlist 項目)
 *   - EventItem       (事件行事曆)
 *   - DailyBriefData  (完整日報資料，Phase 3 輸出)
 *   - DailyBriefFinal (最終推播結構，Phase 4 輸出)
 *
 * 驗證使用 shared/schema-validator.js
 */

'use strict';

// ── 合理性門檻（與 config.json validation.thresholds 對齊）─────────────────
const THRESHOLDS = {
  TAIEX:  { min: 10000, max: 50000, maxDailyChangePct: 10 },
  SP500:  { min: 2000,  max: 15000, maxDailyChangePct: 7  },
  NASDAQ: { min: 5000,  max: 30000, maxDailyChangePct: 7  },
  USDTWD: { min: 28.0,  max: 35.0,  maxDailyChangePct: 2  },
  VIX:    { min: 8,     max: 90,    maxDailyChangePct: 50  },
  DXY:    { min: 80,    max: 130,   maxDailyChangePct: 3   },
  US10Y:  { min: 0.5,   max: 8.0,   maxDailyChangePct: 0.3 } // pp 非百分比
};

// ── 降級標記 ────────────────────────────────────────────────────────────────
const DEGRADATION_LABELS = {
  DELAYED:    '[DELAYED]',
  UNVERIFIED: '[UNVERIFIED]',
  NA:         'N/A'
};

// ── 重要性等級 ──────────────────────────────────────────────────────────────
const IMPORTANCE_LEVELS = ['P0', 'P1', 'P2', 'P3'];

// ── Schema: 單一市場數據點 ───────────────────────────────────────────────────
const MarketDataPointSchema = {
  type: 'object',
  required: ['value', 'source', 'fetchedAt'],
  properties: {
    value:       { type: 'number' },
    change:      { type: 'number' },         // 絕對變化
    changePct:   { type: 'number' },         // 百分比變化
    source:      { type: 'string' },         // twse / fmp / yahoo / finmind
    fetchedAt:   { type: 'string' },         // ISO 8601
    verified:    { type: 'boolean' },        // 是否交叉比對過
    degraded:    { type: 'string', enum: ['', 'DELAYED', 'UNVERIFIED', 'NA'] }
  }
};

// ── Schema: 市場行情（Phase 1+2 彙整）────────────────────────────────────────
const MarketDataSchema = {
  type: 'object',
  required: ['date'],
  properties: {
    date:    { type: 'string' },
    TAIEX:   MarketDataPointSchema,
    SP500:   MarketDataPointSchema,
    NASDAQ:  MarketDataPointSchema,
    DJI:     MarketDataPointSchema,
    USDTWD:  MarketDataPointSchema,
    VIX:     MarketDataPointSchema,
    DXY:     MarketDataPointSchema,
    US10Y:   MarketDataPointSchema,
    // 大宗商品
    GOLD:    MarketDataPointSchema,
    OIL_WTI: MarketDataPointSchema,
    COPPER:  MarketDataPointSchema,
    BTC:     MarketDataPointSchema,
    // 台股法人
    institutional: {
      type: 'object',
      properties: {
        foreign:   { type: 'number' },  // 外資買賣超（張）
        trust:     { type: 'number' },  // 投信買賣超
        dealer:    { type: 'number' },  // 自營商買賣超
        fetchedAt: { type: 'string' }
      }
    },
    // 台股融資融券
    margin: {
      type: 'object',
      properties: {
        marginBalance:     { type: 'number' }, // 融資餘額（億）
        shortBalance:      { type: 'number' }, // 融券餘額（張）
        marginChangePct:   { type: 'number' },
        fetchedAt:         { type: 'string' }
      }
    },
    // 台股成交量
    taiexVolume: { type: 'number' }  // 億元
  }
};

// ── Schema: 新聞條目 ─────────────────────────────────────────────────────────
const NewsItemSchema = {
  type: 'object',
  required: ['id', 'title', 'source', 'publishedAt', 'importance'],
  properties: {
    id:          { type: 'string' },
    title:       { type: 'string', minLength: 5 },
    summary:     { type: 'string' },
    source:      { type: 'string' },          // yahoo-tw / cnbc / udn / sec-edgar / perplexity
    url:         { type: 'string' },
    publishedAt: { type: 'string' },          // ISO 8601
    importance:  { type: 'string', enum: IMPORTANCE_LEVELS },
    category:    { type: 'string' },          // Macro_Policy / Structural_Theme / etc.
    keywords:    { type: 'array', items: { type: 'string' } },
    isDuplicate: { type: 'boolean' }
  }
};

// ── Schema: SEC 申報條目 ──────────────────────────────────────────────────────
const SecFilingSchema = {
  type: 'object',
  required: ['formType', 'company', 'filedAt'],
  properties: {
    formType:  { type: 'string' },     // 8-K / 13F / 4 / 10-K / 10-Q
    company:   { type: 'string' },
    cik:       { type: 'string' },
    filedAt:   { type: 'string' },     // ISO 8601
    accession: { type: 'string' },
    url:       { type: 'string' },
    summary:   { type: 'string' },
    importance: { type: 'string', enum: IMPORTANCE_LEVELS }
  }
};

// ── Schema: Watchlist 項目 ───────────────────────────────────────────────────
const WatchlistItemSchema = {
  type: 'object',
  required: ['symbol', 'price'],
  properties: {
    symbol:      { type: 'string' },
    name:        { type: 'string' },
    market:      { type: 'string', enum: ['tw', 'us'] },
    price:       { type: 'number' },
    changePct:   { type: 'number' },
    volume:      { type: 'number' },
    // 台股法人（watchlist 個股）
    foreignNet:  { type: 'number' },  // 外資買賣超（張）
    trustNet:    { type: 'number' },  // 投信買賣超
    fetchedAt:   { type: 'string' }
  }
};

// ── Schema: 事件行事曆條目 ────────────────────────────────────────────────────
const EventItemSchema = {
  type: 'object',
  required: ['date', 'title', 'type'],
  properties: {
    date:      { type: 'string' },
    title:     { type: 'string' },
    type:      { type: 'string', enum: ['earnings', 'economic', 'investor_conference', 'other'] },
    symbol:    { type: 'string' },
    expected:  { type: 'string' },  // 預期值（EPS、數字）
    actual:    { type: 'string' },  // 實際值（公布後）
    source:    { type: 'string' }   // fmp / mops / perplexity
  }
};

// ── Schema: Market Regime ────────────────────────────────────────────────────
const MarketRegimeSchema = {
  type: 'object',
  required: ['regime'],
  properties: {
    regime:      { type: 'string' },   // Risk-on / Risk-off / Neutral / Cautious
    confidence:  { type: 'number' },   // 0-1
    signals:     { type: 'array', items: { type: 'string' } }
  }
};

// ── Schema: AI 分析輸出 ──────────────────────────────────────────────────────
const AiAnalysisSchema = {
  type: 'object',
  properties: {
    dailySnapshot: {
      type: 'string',         // 2-3句 AI 摘要
      minLength: 10
    },
    structuralTheme: {
      type: 'object',
      properties: {
        theme:       { type: 'string' },
        description: { type: 'string' },
        relatedNews: { type: 'array', items: { type: 'string' } }  // news IDs
      }
    },
    geopolitics: {
      type: 'object',
      properties: {
        hasEvent:    { type: 'boolean' },
        summary:     { type: 'string' }
      }
    },
    topNews: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        required: ['newsId', 'analysis'],
        properties: {
          newsId:   { type: 'string' },
          analysis: { type: 'string' }
        }
      }
    },
    costUsd: { type: 'number' },
    model:   { type: 'string' }
  }
};

// ── Schema: 完整 Daily Brief 資料（Phase 3 輸出）─────────────────────────────
const DailyBriefDataSchema = {
  type: 'object',
  required: ['date', 'generatedAt', 'marketData'],
  properties: {
    date:           { type: 'string' },                  // YYYY-MM-DD
    generatedAt:    { type: 'string' },                  // ISO 8601
    isWeekend:      { type: 'boolean' },
    marketData:     MarketDataSchema,
    equityWinners:  {
      type: 'object',
      properties: {
        tw: { type: 'array', items: WatchlistItemSchema, maxItems: 5 },
        us: { type: 'array', items: WatchlistItemSchema, maxItems: 5 }
      }
    },
    equityLosers: {
      type: 'object',
      properties: {
        tw: { type: 'array', items: WatchlistItemSchema, maxItems: 5 },
        us: { type: 'array', items: WatchlistItemSchema, maxItems: 5 }
      }
    },
    watchlist:      { type: 'array', items: WatchlistItemSchema },
    news:           { type: 'array', items: NewsItemSchema },
    secFilings:     { type: 'array', items: SecFilingSchema },
    eventCalendar:  { type: 'array', items: EventItemSchema },
    marketRegime:   MarketRegimeSchema,
    aiAnalysis:     AiAnalysisSchema,
    pipelineStatus: {
      type: 'object',
      properties: {
        phase1: { type: 'string', enum: ['ok', 'degraded', 'failed', 'skipped'] },
        phase2: { type: 'string', enum: ['ok', 'degraded', 'failed', 'skipped'] },
        phase3: { type: 'string', enum: ['ok', 'degraded', 'failed', 'skipped'] }
      }
    }
  }
};

// ── 驗證函數 ─────────────────────────────────────────────────────────────────

/**
 * 驗證市場數據點是否在合理範圍內
 * @param {string} key - TAIEX / SP500 / etc.
 * @param {object} point - MarketDataPoint
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateMarketDataPoint(key, point) {
  const errors = [];
  const threshold = THRESHOLDS[key];

  if (!threshold || !point) return { valid: true, errors: [] };
  if (point.degraded === 'NA') return { valid: true, errors: [] };

  const { value, changePct } = point;

  if (typeof value === 'number') {
    if (value < threshold.min || value > threshold.max) {
      errors.push(`${key} 值 ${value} 超出合理範圍 [${threshold.min}, ${threshold.max}]`);
    }
    if (typeof changePct === 'number') {
      const absPct = Math.abs(changePct);
      if (absPct > threshold.maxDailyChangePct) {
        errors.push(`${key} 單日變幅 ${changePct.toFixed(2)}% 超出上限 ${threshold.maxDailyChangePct}%，標記為 UNVERIFIED`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 驗證完整 DailyBriefData（合理性檢查）
 * @param {object} data - DailyBriefData
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateDailyBriefData(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['data 不是物件'], warnings: [] };
  }

  if (!data.date) errors.push('缺少 date 欄位');
  if (!data.marketData) {
    errors.push('缺少 marketData');
  } else {
    const md = data.marketData;
    for (const key of Object.keys(THRESHOLDS)) {
      if (md[key]) {
        const result = validateMarketDataPoint(key, md[key]);
        if (!result.valid) {
          warnings.push(...result.errors);
        }
      }
    }
  }

  if (data.news && !Array.isArray(data.news)) {
    errors.push('news 必須是陣列');
  }

  if (data.watchlist && !Array.isArray(data.watchlist)) {
    errors.push('watchlist 必須是陣列');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * 交叉比對：比較兩個來源的同一市場數據，超出容差標記為 UNVERIFIED
 * @param {number} valueA - 來源 A 的數值
 * @param {number} valueB - 來源 B 的數值
 * @param {number} tolerance - 容差（小數，0.005 = 0.5%）
 * @returns {boolean} - 是否通過交叉比對
 */
function crossCheck(valueA, valueB, tolerance) {
  if (typeof valueA !== 'number' || typeof valueB !== 'number') return false;
  if (valueA === 0 || valueB === 0) return false;
  const diff = Math.abs(valueA - valueB) / Math.max(Math.abs(valueA), Math.abs(valueB));
  return diff <= tolerance;
}

module.exports = {
  THRESHOLDS,
  DEGRADATION_LABELS,
  IMPORTANCE_LEVELS,
  schemas: {
    MarketDataPoint: MarketDataPointSchema,
    MarketData:      MarketDataSchema,
    NewsItem:        NewsItemSchema,
    SecFiling:       SecFilingSchema,
    WatchlistItem:   WatchlistItemSchema,
    EventItem:       EventItemSchema,
    MarketRegime:    MarketRegimeSchema,
    AiAnalysis:      AiAnalysisSchema,
    DailyBriefData:  DailyBriefDataSchema
  },
  validate: {
    marketDataPoint:  validateMarketDataPoint,
    dailyBriefData:   validateDailyBriefData,
    crossCheck
  }
};
