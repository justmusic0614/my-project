# Market Digest Agent - 完整規格說明書

**版本**: 3.0 (Pipeline Architecture)
**最後更新**: 2026-02-18
**運行環境**: VPS (159.65.136.0)
**使用者**: clawbot
**狀態**: 🔄 Refactoring in Progress (階段 0 完成)

---

## 重構進度追蹤

| 階段 | 內容 | 狀態 |
|------|------|------|
| 0 | 準備：deprecated/ + 新目錄骨架 + 配置更新 | ✅ 完成 |
| 1 | 共用層調整 | ⏳ 待開始 |
| 2 | 收集器層建設 | ⏳ 待開始 |
| 3 | 處理器層建設 | ⏳ 待開始 |
| 4 | 渲染+推播層建設 | ⏳ 待開始 |
| 5 | Pipeline 整合 | ⏳ 待開始 |
| 6 | Telegram 命令 | ⏳ 待開始 |
| 7 | SRE + 部署 | ⏳ 待開始 |

**設計文件**: 詳見 `plans/happy-mapping-stonebraker.md`

---

## 目錄

1. [系統概述](#系統概述)
2. [運行環境](#運行環境)
3. [系統架構](#系統架構)
4. [核心模組](#核心模組)
5. [資料源配置](#資料源配置)
6. [資料處理流程](#資料處理流程)
7. [SRE 系統](#sre-系統)
8. [配置管理](#配置管理)
9. [資料結構](#資料結構)
10. [監控與告警](#監控與告警)
11. [部署與運維](#部署與運維)
12. [API 規格](#api-規格)

---

## 系統概述

### 功能定位
Market Digest Agent 是一個自動化的全球市場資訊整合系統，負責：
- **多源資料收集**: API 優先（TWSE/FMP/FinMind/SEC EDGAR）+ RSS 輔助 + Perplexity 研究
- **智能去重**: Jaccard 相似度 + 關鍵字重疊（閾值 85%）
- **重要性評分**: P0-P3 四級分類（Fed/FOMC/CPI 為 P0 最高優先）
- **資料驗證**: Schema + 合理性檢查 + 多源交叉比對
- **市場數據**: 整合台股、美股、匯率、大宗商品、加密貨幣
- **AI 分析**: Claude API Two-Stage（Haiku 4.5 篩選 → Sonnet 4.5 深度分析）
- **統一日報**: Daily Brief 固定格式，每日 08:00（台北）推播
- **週報**: 每週五 17:30（台北）推播週度總結

### 核心特性
- 🔄 **Pipeline 架構重構中**: 4 階段 Pipeline（收集→處理→渲染→推播）
- ✅ **高可靠性**: 自動錯誤恢復、優雅降級、熔斷保護
- ✅ **標準化架構**: 統一 HTTP、快取、日誌、去重邏輯
- ✅ **配置驅動**: 所有配置可從 config.json 和 .env 調整
- ✅ **資料驗證層**: Schema 驗證 + 合理性門檻 + 交叉比對
- ✅ **成本控制**: $2/天預算，預估實際 ~$0.08/天

---

## 運行環境

### 硬體規格
```
主機: DigitalOcean Droplet
IP: 159.65.136.0
CPU: 1 core (x86_64)
RAM: 2GB (實際可用 ~1.1GB)
Disk: 48GB (已用 15GB, 可用 33GB)
```

### 軟體環境
```
OS: Linux (Ubuntu/Debian)
Node.js: v22.22.0 (via nvm)
Package Manager: npm
OpenClaw CLI: v2026.2.12
Process Manager: systemd / cron
```

### 系統狀態（即時）
```
Overall Status: HEALTHY ✅
Disk: 33252MB free (69%) ✅
Memory: 1018MB free (52%) ✅
Processes: 2 market-digest processes running ✅
Data Files: All critical files present ✅
Logs: 0MB (3 files) ✅
```

---

## 系統架構

### 目錄結構（v3.0 新架構）
```
market-digest/
├── index.js                      # 統一入口（CLI + Cron 路由）
├── config.json                   # 主配置（v2.0）
├── .env                          # 環境變數
├── package.json                  # npm 依賴（v2.0.0）
│
├── pipeline/                     # Pipeline 編排層
│   ├── orchestrator.js           # 總指揮（phase 管理、重試、降級）
│   ├── phase1-us-collect.js      # 05:30 美股收集
│   ├── phase2-tw-collect.js      # 07:30 台股+RSS+Perplexity
│   ├── phase3-process.js         # 07:45 驗證+去重+AI分析
│   ├── phase4-assemble.js        # 08:00 組裝+推播
│   └── weekly-pipeline.js        # 週報 Pipeline
│
├── collectors/                   # 資料收集層
│   ├── base-collector.js         # 基礎類（基於 DataSourceAdapter）
│   ├── twse-collector.js         # TWSE/MOPS
│   ├── fmp-collector.js          # FMP 美股
│   ├── finmind-collector.js      # FinMind 台股
│   ├── sec-edgar-collector.js    # SEC EDGAR（新建）
│   ├── yahoo-collector.js        # Yahoo Finance
│   ├── rss-collector.js          # RSS 4源
│   └── perplexity-collector.js   # Perplexity（固定+動態）
│
├── processors/                   # 資料處理層
│   ├── validator.js              # Schema+合理性+交叉比對
│   ├── deduplicator.js           # 去重（封裝 shared/deduplicator）
│   ├── ai-analyzer.js            # Two-Stage AI（Haiku→Sonnet）
│   └── importance-scorer.js      # 重要性評分
│
├── renderers/                    # 渲染層
│   ├── daily-renderer.js         # Daily Brief 格式
│   ├── weekly-renderer.js        # 週報格式
│   ├── telegram-formatter.js     # Telegram 格式化+分割
│   └── section-templates.js      # 區塊模板
│
├── publishers/                   # 推播層
│   ├── telegram-publisher.js     # Telegram 推播
│   ├── archive-publisher.js      # 本地存檔+Git commit
│   └── alert-publisher.js        # 告警推播
│
├── commands/                     # Telegram 命令
│   ├── command-router.js         # 命令路由
│   ├── cmd-today.js              # /today
│   ├── cmd-watchlist.js          # /watchlist
│   ├── cmd-financial.js          # /financial
│   ├── cmd-weekly.js             # /weekly
│   ├── cmd-analyze.js            # /analyze <代號>
│   ├── cmd-news.js               # /news
│   ├── cmd-query.js              # /query
│   └── cmd-alerts.js             # /alerts
│
├── shared/                       # 共用層（沿用+擴展）
│   ├── http-client.js            # 沿用
│   ├── cache-manager.js          # 沿用
│   ├── logger.js                 # 沿用
│   ├── deduplicator.js           # 沿用
│   ├── config-loader.js          # 擴展（SEC/Anthropic 配置）
│   ├── schema-validator.js       # 擴展（合理性檢查）
│   ├── rate-limiter.js           # 擴展（SEC rate limit）
│   ├── cost-ledger.js            # 從 backend/ 移入
│   └── schemas/                  # 擴展
│       └── daily-brief.schema.js # 新增
│
├── sre/                          # SRE（沿用+擴展）
│   ├── circuit-breaker.js        # 沿用
│   ├── graceful-degradation.js   # 擴展（phase-level 降級）
│   ├── health-check.js           # 擴展（pipeline-state 檢查）
│   ├── metrics-collector.js      # 擴展（pipeline 指標）
│   ├── alerting-rules.js         # 擴展（pipeline 告警）
│   ├── cron-wrapper.sh           # 擴展（多階段 cron）
│   └── backup-strategy.sh        # 沿用
│
├── test/                         # 單元測試
│   ├── test-collectors.js
│   ├── test-processors.js
│   ├── test-renderers.js
│   ├── test-pipeline.js
│   └── test-validators.js
│
├── data/
│   ├── pipeline-state/           # 各 phase 中間結果
│   ├── daily-brief/              # 日報存檔
│   ├── weekly-report/            # 週報存檔
│   ├── watchlist.json
│   └── ...cache 目錄（沿用）
│
├── deprecated/                   # 舊模組保留（可回滾）
│   ├── smart-integrator.js
│   ├── morning-integrator.js
│   ├── daily-brief-generator.js
│   ├── generate-brief-pipeline.js
│   ├── institutional-renderer.js
│   ├── news-collector.js
│   ├── news-analyzer.js
│   ├── telegram-wrapper.sh
│   └── push-morning-report.sh
│
├── backend/                      # 業務邏輯層（漸進遷移）
│   ├── sources/                  # 資料源插件（遷移至 collectors/）
│   └── ...
│
└── logs/
```

### 核心模組清單（v3.0）

**統一入口** (1 個)：
- `index.js` - CLI + Cron 路由（建設中）

**Pipeline 編排** (6 個)：
- `pipeline/orchestrator.js` - 總指揮（phase 管理、重試、降級）
- `pipeline/phase1-us-collect.js` - 美股收集
- `pipeline/phase2-tw-collect.js` - 台股+RSS+Perplexity
- `pipeline/phase3-process.js` - 驗證+去重+AI 分析
- `pipeline/phase4-assemble.js` - 組裝+推播
- `pipeline/weekly-pipeline.js` - 週報 Pipeline

**資料收集** (8 個)：
- `collectors/base-collector.js` - 基礎類
- `collectors/twse-collector.js` - TWSE/MOPS
- `collectors/fmp-collector.js` - FMP 美股
- `collectors/finmind-collector.js` - FinMind 台股
- `collectors/sec-edgar-collector.js` - SEC EDGAR
- `collectors/yahoo-collector.js` - Yahoo Finance
- `collectors/rss-collector.js` - RSS 4源
- `collectors/perplexity-collector.js` - Perplexity

**資料處理** (4 個)：
- `processors/validator.js` - 驗證（Schema+合理性+交叉比對）
- `processors/deduplicator.js` - 去重
- `processors/ai-analyzer.js` - Two-Stage AI 分析
- `processors/importance-scorer.js` - 重要性評分

**渲染層** (4 個)：
- `renderers/daily-renderer.js` - Daily Brief 格式
- `renderers/weekly-renderer.js` - 週報格式
- `renderers/telegram-formatter.js` - Telegram 格式化+分割
- `renderers/section-templates.js` - 區塊模板

**推播層** (3 個)：
- `publishers/telegram-publisher.js` - Telegram 推播
- `publishers/archive-publisher.js` - 存檔+Git commit
- `publishers/alert-publisher.js` - 告警推播

**Telegram 命令** (9 個)：
- `commands/command-router.js` - 命令路由
- `commands/cmd-today.js` - /today（完整日報）
- `commands/cmd-watchlist.js` - /watchlist
- `commands/cmd-financial.js` - /financial
- `commands/cmd-weekly.js` - /weekly
- `commands/cmd-analyze.js` - /analyze（即時深度分析）
- `commands/cmd-news.js` - /news
- `commands/cmd-query.js` - /query
- `commands/cmd-alerts.js` - /alerts

**共用模組** (9 個，位於 shared/)：
- HTTP Client, Cache Manager, Logger, Deduplicator
- Config Loader, Schema Validator, Rate Limiter, Cost Ledger
- daily-brief.schema.js（新增）

**SRE 模組** (7 個，位於 sre/)：
- Circuit Breaker, Graceful Degradation, Health Check
- Metrics Collector, Alerting Rules, Cron Wrapper, Backup Strategy

**已棄用** (9 個，位於 deprecated/)：
- smart-integrator.js, morning-integrator.js, daily-brief-generator.js
- generate-brief-pipeline.js, institutional-renderer.js
- news-collector.js, news-analyzer.js
- telegram-wrapper.sh, push-morning-report.sh

---

## 核心模組

### 1. 共用基礎層 (shared/)

#### HTTP Client (`shared/http-client.js`)
**功能**：統一 HTTP 請求處理
```javascript
class HttpClient {
  timeout: 10000ms         // 超時時間
  retries: 3              // 重試次數
  userAgent: "MarketDigest/1.0"

  methods:
    - fetch(url, options)      // 通用請求
    - fetchRSS(url)            // RSS 特化
    - fetchJSON(url)           // JSON 特化
}
```

**特性**：
- ✅ 自動超時管理（10 秒）
- ✅ 指數退避重試（最多 3 次）
- ✅ 錯誤分類（網絡 vs 應用）
- ✅ 結構化日誌記錄

#### Cache Manager (`shared/cache-manager.js`)
**功能**：統一快取管理
```javascript
class CacheManager {
  methods:
    - get(key, ttl)           // 讀取快取
    - set(key, data, ttl)     // 寫入快取
    - invalidate(pattern)     // 失效快取（glob）
    - getStats()              // 統計（命中率、大小）
}
```

**TTL 配置**：
```json
{
  "stockInfo": 86400000,      // 24h
  "monthlyRevenue": 3600000,  // 1h
  "news": 1800000,            // 30min
  "marketData": 300000        // 5min
}
```

**特性**：
- ✅ Atomic write（原子寫入）
- ✅ TTL 自動過期
- ✅ 命中率統計
- ✅ 最大容量限制（100MB）

#### Logger (`shared/logger.js`)
**功能**：結構化日誌系統
```javascript
class Logger {
  levels: INFO, WARN, ERROR, DEBUG
  format: JSON (可解析)

  methods:
    - info(message, context)
    - warn(message, context)
    - error(message, context, error)
    - debug(message, context)
}
```

**輸出格式**：
```json
{
  "timestamp": "2026-02-16T18:00:00Z",
  "level": "INFO",
  "component": "news-fetcher",
  "message": "Fetched 85 news items",
  "context": { "source": "yahoo-tw" }
}
```

#### Deduplicator (`shared/deduplicator.js`)
**功能**：新聞去重
```javascript
class NewsDeduplicator {
  algorithm: "jaccard" | "levenshtein" | "keywords"
  threshold: 0.85

  methods:
    - deduplicate(newsArray)
    - deduplicateByTitlePrefix()
    - deduplicateByKeywords()
    - deduplicateByLevenshtein()
}
```

**算法**：
- **Jaccard 相似度**: 標題前 10 字符比對
- **Levenshtein 距離**: 編輯距離計算
- **關鍵字重疊**: 最少 3 個關鍵字重疊

**效能**：
- 準確率：85%+
- 處理速度：~50ms per pair

#### Config Loader (`shared/config-loader.js`)
**功能**：配置載入與環境變數插值
```javascript
class ConfigLoader {
  methods:
    - load()                     // 載入 config.json
    - get(keyPath, defaultValue) // 點記法取值
    - interpolateEnv(obj)        // ${VAR} 替換
    - getHttp(), getCache(), ...  // 專用 getter
}
```

**環境變數語法**：
```json
{
  "telegram": {
    "botToken": "${TELEGRAM_BOT_TOKEN}",
    "chatId": "${TELEGRAM_CHAT_ID:-default_id}"
  }
}
```

#### Schema Validator (`shared/schema-validator.js`)
**功能**：JSON Schema 驗證
```javascript
class SchemaValidator {
  methods:
    - validate(data, schema, name)
    - validateNews(data)
    - validateMarketData(data)
    - validateFinancial(data)
    - validateChip(data)
    - validateWatchlist(data)
}
```

**驗證項目**：
- 類型檢查（string, number, array, object）
- 必填欄位（required fields）
- 格式驗證（ISO8601, URL, YYYY-MM-DD）
- Enum 驗證
- 長度/模式檢查

#### Schema Migrator (`shared/schema-migrator.js`)
**功能**：資料版本遷移
```javascript
class SchemaMigrator {
  methods:
    - migrateNews(oldData)
    - migrateMarketData(oldData)
    - migrateFile(filePath, type)
    - detectVersion(data)
}
```

**特性**：
- ✅ 自動偵測舊格式
- ✅ 資料正規化
- ✅ Dry-run 模式（測試遷移）
- ✅ 備份支援

---

### 2. SRE 可靠性系統 (sre/)

#### Metrics Collector (`sre/metrics-collector.js`)
**功能**：系統指標收集
```javascript
class MetricsCollector {
  metrics:
    - http: { totalRequests, successRequests, failedRequests }
    - cache: { hits, misses, totalRequests }
    - dataProcessing: { totalOperations }
    - system: { startTime, lastUpdateTime }

  methods:
    - recordHttpRequest(url, duration, statusCode)
    - recordCacheHit(key, isHit)
    - recordDataProcessing(type, count, duration)
    - getAverageHttpLatency()
    - getCacheHitRate()
    - getHttpSuccessRate()
    - getSummary()
    - exportPrometheus()        // Prometheus 格式
}
```

**保留策略**：
- HTTP 請求記錄：最近 1000 筆
- 資料處理記錄：最近 500 筆
- 自動保存：每 60 秒

**Prometheus 匯出**：
```prometheus
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total 1234

# HELP cache_hit_rate_percent Cache hit rate percentage
# TYPE cache_hit_rate_percent gauge
cache_hit_rate_percent 66.70
```

#### Alerting Rules (`sre/alerting-rules.js`)
**功能**：多層級告警系統
```javascript
const ALERT_RULES = [
  {
    id: "api_latency_high",
    name: "API 延遲過高 (Warning)",
    severity: "warning",
    threshold: 5000,           // 5s
    condition: (metrics) => metrics.getAverageHttpLatency() > 5000
  },
  {
    id: "api_latency_critical",
    name: "API 延遲嚴重 (Critical)",
    severity: "critical",
    threshold: 10000,          // 10s
    condition: (metrics) => metrics.getAverageHttpLatency() > 10000
  },
  {
    id: "cache_hit_ratio_low",
    name: "快取命中率低",
    severity: "warning",
    threshold: 0.5,            // 50%
    condition: (metrics) => metrics.getCacheHitRate() < 0.5
  },
  {
    id: "http_error_rate_high",
    name: "HTTP 錯誤率高 (Warning)",
    severity: "warning",
    threshold: 0.1,            // 10%
    condition: (metrics) => (1 - metrics.getHttpSuccessRate()) > 0.1
  },
  {
    id: "http_error_rate_critical",
    name: "HTTP 錯誤率嚴重 (Critical)",
    severity: "critical",
    threshold: 0.5,            // 50%
    condition: (metrics) => (1 - metrics.getHttpSuccessRate()) > 0.5
  }
];
```

**告警歷史**：
- 保留最近 100 筆告警
- 統計：總數、warning/critical 分佈

#### Health Check (`sre/health-check.js`)
**功能**：系統健康檢查
```javascript
class HealthChecker {
  checks:
    - disk: { totalMB, usedMB, freeMB, freePercent }
    - memory: { totalMB, usedMB, freeMB, freePercent }
    - process: { isRunning, processCount }
    - dataFiles: { results }
    - logs: { logFileCount, totalSizeMB }

  thresholds:
    - diskFreePercent: 10%     // 磁碟可用 < 10% = critical
    - diskFreeMB: 500MB
    - memoryFreePercent: 15%   // 記憶體可用 < 15% = critical
    - memoryFreeMB: 200MB

  methods:
    - checkAll()
    - checkDiskSpace()
    - checkMemory()
    - checkProcess()
    - checkDataFiles()
    - checkLogs()
    - evaluateOverallStatus()
    - getStats()
}
```

**狀態等級**：
- `healthy` - 所有檢查正常
- `warning` - 部分指標接近閾值
- `critical` - 超過關鍵閾值
- `error` - 檢查執行失敗

**歷史記錄**：
- 保留最近 100 次檢查
- 儲存於 `logs/health-check.json`

#### Backup Strategy (`sre/backup-strategy.sh`)
**功能**：自動備份腳本
```bash
#!/bin/bash
# 每日備份腳本（7 天保留）

BACKUP_DIR="/home/clawbot/clawd/agents/market-digest/backups"

# 備份內容
backup_data() {
  # data/ 目錄（排除快取）
  tar -czf "data-${DATE}.tar.gz" \
    --exclude='data/*-cache' \
    --exclude='*.tmp' \
    data/
}

backup_config() {
  # 配置檔案
  tar -czf "config-${DATE}.tar.gz" config.json .env
}

cleanup_old_backups() {
  # 刪除 7 天前的備份
  find "${BACKUP_DIR}" -name "*.tar.gz" -mtime +7 -delete
}
```

**執行方式**：
- 手動：`./sre/backup-strategy.sh`
- 自動：Cron 排程（建議每日 02:00）

**備份內容**：
- `data/` 目錄（排除快取）
- `config.json`
- `.env` 環境變數

#### Circuit Breaker (`sre/circuit-breaker.js`)
**功能**：熔斷器保護
```javascript
class CircuitBreaker {
  states: CLOSED, OPEN, HALF_OPEN

  config:
    threshold: 5              // 失敗 5 次後開啟
    timeout: 60000            // 60s 後嘗試恢復
    resetTimeout: 300000      // 5min 後重置

  methods:
    - execute(fn)             // 執行受保護的函式
    - recordSuccess()
    - recordFailure()
    - getState()
}
```

**狀態轉換**：
```
CLOSED (正常) --[5 次失敗]--> OPEN (熔斷)
OPEN --[60s 後]--> HALF_OPEN (半開)
HALF_OPEN --[成功]--> CLOSED
HALF_OPEN --[失敗]--> OPEN
```

#### Graceful Degradation (`sre/graceful-degradation.js`)
**功能**：優雅降級
```javascript
class GracefulDegradation {
  strategies:
    - useCache: API 失敗時使用快取
    - skipOptional: 跳過非必要模組
    - defaultValue: 使用預設值

  methods:
    - fetchWithFallback(url, fallbackData)
    - executeWithFallback(fn, fallback)
}
```

**降級場景**：
1. API 超時 → 使用快取資料
2. 分析模組失敗 → 跳過 AI 分析
3. 推播失敗 → 記錄日誌，稍後重試

---

## 資料源配置

### RSS 新聞源（4 個）

#### 1. Yahoo Finance 台股
```json
{
  "id": "yahoo-tw",
  "name": "Yahoo Finance 台股",
  "url": "https://tw.stock.yahoo.com/rss?category=tw-market",
  "type": "rss",
  "category": "Taiwan_Market",
  "enabled": true
}
```
- 更新頻率：即時
- 語言：繁體中文
- 內容：台股新聞、個股報導

#### 2. CNBC Business News
```json
{
  "id": "cnbc-business",
  "name": "CNBC Business News",
  "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147",
  "type": "rss",
  "category": "Equity_Market",
  "enabled": true
}
```
- 更新頻率：即時
- 語言：英文
- 內容：全球商業新聞

#### 3. CNBC Markets
```json
{
  "id": "cnbc-investing",
  "name": "CNBC Markets",
  "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069",
  "type": "rss",
  "category": "Equity_Market",
  "enabled": true
}
```
- 更新頻率：即時
- 語言：英文
- 內容：市場分析、投資資訊

#### 4. 經濟日報 (UDN)
```json
{
  "id": "udn-business",
  "name": "經濟日報",
  "url": "https://money.udn.com/rssfeed/news/1001/5591/latest",
  "type": "rss",
  "category": "Taiwan_Market",
  "enabled": true
}
```
- 更新頻率：即時
- 語言：繁體中文
- 內容：台股財經新聞

### API 資料源

#### 1. Yahoo Finance API
```json
{
  "yahoo": {
    "base": "https://query1.finance.yahoo.com/v8/finance/chart/",
    "enabled": true
  }
}
```
**提供數據**：
- 股價即時報價
- 歷史價格數據
- 技術指標（MA, RSI）

#### 2. TWSE (台灣證券交易所)
```json
{
  "twse": {
    "dailyTrade": "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
    "marginTrading": "https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN",
    "institutional": "https://www.twse.com.tw/rwd/zh/fund/T86",
    "enabled": true
  }
}
```
**提供數據**：
- 每日交易統計
- 融資融券數據
- 三大法人買賣超

#### 3. MOPS (公開資訊觀測站)
```json
{
  "mops": {
    "stockInfo": "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
    "monthlyRevenue": "https://openapi.twse.com.tw/v1/opendata/t187ap05_L",
    "quarterlyReport": "https://openapi.twse.com.tw/v1/opendata/t187ap14_L",
    "financialRatio": "https://openapi.twse.com.tw/v1/opendata/t187ap06_L",
    "enabled": true
  }
}
```
**提供數據**：
- 上市公司基本資料
- 月營收數據
- 季度財報
- 財務比率

### 人工輸入源

#### LINE 群組早報
```json
{
  "manual_input": {
    "type": "line_group",
    "description": "LINE 群組早報（主要資料源）",
    "enabled": true
  }
}
```
**收集方式**：
- 透過 `morning-collector.js` 手動輸入
- 格式：結構化文字（markdown）
- 時間：每日 07:00-08:00

**內容包含**：
- 前一日市場總結
- 重要事件回顧
- 今日關注焦點

---

## 資料處理流程

### 完整工作流程

```
┌─────────────────────────────────────────────────────────────┐
│                    1. 資料收集 (Collect)                      │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│ │ RSS Fetcher │  │LINE Collect │  │ API Fetcher │          │
│ │ (4 sources) │  │ (manual)    │  │ (TWSE/MOPS) │          │
│ └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │
│        │                 │                 │                  │
│        └─────────────────┴─────────────────┘                 │
│                           │                                   │
└───────────────────────────┼───────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  2. 資料驗證 (Validate)                       │
├─────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐       │
│ │ Schema Validator                                  │       │
│ │ - 檢查必填欄位                                     │       │
│ │ - 驗證資料格式 (ISO8601, URL)                    │       │
│ │ - 類型檢查                                        │       │
│ └───────────────────────────────────────────────────┘       │
└───────────────────────────┼───────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    3. 去重 (Deduplication)                    │
├─────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐       │
│ │ Deduplicator (Jaccard / Levenshtein)            │       │
│ │ - 標題前 10 字符比對                              │       │
│ │ - 關鍵字重疊檢測 (>3 個)                         │       │
│ │ - 去重準確率：85%+                                │       │
│ └───────────────────────────────────────────────────┘       │
│                           │                                   │
│                           ▼                                   │
│                 ┌─────────────────┐                          │
│                 │ 85 → 60 articles │                          │
│                 └─────────────────┘                          │
└───────────────────────────┼───────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  4. 重要性評分 (Scoring)                      │
├─────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐       │
│ │ Importance Scorer                                 │       │
│ │ - Critical: Fed、央行、台積電 (權重 3.0)          │       │
│ │ - High: 財報、GDP、CPI (權重 2.0)                │       │
│ │ - Medium: 一般市場新聞 (權重 1.0)                 │       │
│ │ - Low: 其他 (權重 0.5)                            │       │
│ └───────────────────────────────────────────────────┘       │
└───────────────────────────┼───────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     5. AI 分析 (Analysis)                     │
├─────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐       │
│ │ AI Client (OpenClaw)                              │       │
│ │ - 自動摘要生成 (2-3 句)                          │       │
│ │ - 關鍵字提取 (3-5 個)                             │       │
│ │ - 情感分析 (正面/中性/負面)                      │       │
│ └───────────────────────────────────────────────────┘       │
└───────────────────────────┼───────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  6. 整合生成 (Integration)                    │
├─────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐       │
│ │ Smart Integrator                                  │       │
│ │ - 合併 LINE 早報 + RSS 新聞                      │       │
│ │ - 加入市場數據 (指數、匯率)                       │       │
│ │ - 生成結構化早報                                  │       │
│ └───────────────────────────────────────────────────┘       │
│                           │                                   │
│                           ▼                                   │
│ ┌───────────────────────────────────────────────────┐       │
│ │ Brief Generator                                   │       │
│ │ - Markdown 格式                                   │       │
│ │ - Plain Text 格式                                 │       │
│ │ - JSON 格式 (API)                                 │       │
│ └───────────────────────────────────────────────────┘       │
└───────────────────────────┼───────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     7. 推播 (Publish)                         │
├─────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐       │
│ │ Telegram Publisher                                │       │
│ │ - 每日 08:00 自動推播                             │       │
│ │ - 最大訊息長度：4000 字符                         │       │
│ │ - 超過長度自動分割                                │       │
│ │ - Markdown 格式渲染                               │       │
│ └───────────────────────────────────────────────────┘       │
│                           │                                   │
│                           ▼                                   │
│                  ┌────────────────┐                          │
│                  │ 📱 Telegram Bot │                          │
│                  └────────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

### 處理時間

| 階段 | 預估時間 | 說明 |
|------|---------|------|
| 資料收集 | 15-20s | RSS 抓取 + API 請求 |
| 資料驗證 | 1-2s | JSON Schema 驗證 |
| 去重 | 3-5s | Levenshtein 計算 (60 篇) |
| 重要性評分 | 1-2s | 關鍵字匹配 |
| AI 分析 | 10-15s | OpenClaw API 呼叫 |
| 整合生成 | 2-3s | 合併與格式化 |
| 推播 | 1-2s | Telegram API |
| **總計** | **~35-50s** | 完整執行 |

---

## SRE 系統

### 可靠性保證

#### 1. Circuit Breaker（熔斷器）
```javascript
狀態: CLOSED (正常運行)
失敗閾值: 5 次
超時時間: 60s
重置時間: 5min

機制:
- 連續失敗 5 次 → OPEN（熔斷）
- 熔斷後 60s → HALF_OPEN（嘗試恢復）
- 恢復成功 → CLOSED
- 恢復失敗 → OPEN（繼續熔斷）
```

**保護的服務**：
- RSS 抓取
- API 請求（TWSE, MOPS, Yahoo）
- OpenClaw AI 呼叫

#### 2. Graceful Degradation（優雅降級）
```javascript
降級策略:
1. API 超時 → 使用快取資料
2. AI 分析失敗 → 跳過 AI，使用基礎分析
3. 推播失敗 → 記錄日誌，排程重試
4. 非關鍵模組失敗 → 跳過，不影響主流程
```

**關鍵 vs 非關鍵**：
- 關鍵：資料收集、去重、生成早報
- 非關鍵：AI 分析、技術指標、推播

#### 3. Health Check（健康檢查）
```javascript
檢查項目: 6 項
執行頻率: 每 5 分鐘 (300s)

1. 磁碟空間
   - 閾值: 500MB / 10%
   - 當前: 33252MB (69%) ✅

2. 記憶體使用
   - 閾值: 200MB / 15%
   - 當前: 1018MB (52%) ✅

3. 進程狀態
   - 預期: 1-2 個進程
   - 當前: 2 個進程 ✅

4. 資料檔案完整性
   - 檢查: news-collect/, daily-brief/, watchlist.json
   - 狀態: All present ✅

5. 日誌大小
   - 警告閾值: 100MB
   - 當前: 0MB ✅

6. 快取健康
   - 檢查: 快取目錄存在且可寫
   - 狀態: Healthy ✅
```

#### 4. Metrics Collection（指標收集）
```javascript
收集頻率: 每 60 秒
保留策略:
  - HTTP 請求: 最近 1000 筆
  - 快取操作: 全部
  - 處理操作: 最近 500 筆

指標類型:
1. HTTP 指標
   - 總請求數
   - 成功/失敗次數
   - 平均延遲
   - 成功率

2. 快取指標
   - 命中/未命中次數
   - 命中率
   - 快取大小

3. 處理指標
   - 處理操作數
   - 處理時間
   - 吞吐量 (items/s)

4. 系統指標
   - 運行時間 (uptime)
   - 最後更新時間
```

**匯出格式**：
- JSON (內部使用)
- Prometheus (監控系統整合)

#### 5. Alerting（告警）
```javascript
告警規則: 5 個
嚴重等級: warning, critical

規則詳情:
1. API 延遲 > 5s (warning)
2. API 延遲 > 10s (critical)
3. 快取命中率 < 50% (warning)
4. HTTP 錯誤率 > 10% (warning)
5. HTTP 錯誤率 > 50% (critical)

通知方式:
- Console 輸出
- 日誌記錄
- (可擴展) Telegram 通知
```

#### 6. Backup（備份）
```javascript
備份頻率: 每日
保留期限: 7 天
備份內容:
  - data/ (排除快取)
  - config.json
  - .env

執行方式:
  - 手動: ./sre/backup-strategy.sh
  - 自動: Cron 排程 (建議 02:00)

壓縮格式: tar.gz
平均大小: ~5-10MB
```

### 錯誤處理

#### 自動重試
```javascript
重試策略: 指數退避
最大重試: 3 次
延遲公式: delay = base * 2^attempt

範例:
- 第 1 次失敗 → 等待 1s → 重試
- 第 2 次失敗 → 等待 2s → 重試
- 第 3 次失敗 → 等待 4s → 重試
- 第 4 次失敗 → 放棄，記錄錯誤
```

#### 錯誤分類
```javascript
1. 網絡錯誤 (Network Error)
   - 超時 (ETIMEDOUT)
   - 連接拒絕 (ECONNREFUSED)
   - DNS 解析失敗 (ENOTFOUND)
   → 策略: 重試 + 使用快取

2. 應用錯誤 (Application Error)
   - HTTP 4xx (Client Error)
   - HTTP 5xx (Server Error)
   - JSON 解析失敗
   → 策略: 記錄日誌 + 跳過該項目

3. 資料錯誤 (Data Error)
   - Schema 驗證失敗
   - 必填欄位缺失
   → 策略: 修正或丟棄

4. 系統錯誤 (System Error)
   - 記憶體不足 (ENOMEM)
   - 磁碟空間不足 (ENOSPC)
   → 策略: 觸發 critical 告警
```

---

## 配置管理

### config.json 完整配置

```json
{
  "version": "1.0",
  "lastUpdated": "2026-02-17",

  "http": {
    "timeout": 10000,
    "retries": 3,
    "userAgent": "MarketDigest/1.0 (Node.js)",
    "headers": {
      "User-Agent": "MarketDigest/1.0 (Node.js)"
    }
  },

  "cache": {
    "enabled": true,
    "ttl": {
      "stockInfo": 86400000,
      "monthlyRevenue": 3600000,
      "quarterlyReport": 86400000,
      "dividend": 86400000,
      "financialRatio": 86400000,
      "dailyTrade": 3600000,
      "chipData": 3600000,
      "marginTrading": 3600000,
      "institutional": 3600000,
      "news": 1800000,
      "marketData": 300000
    },
    "maxSize": "100MB",
    "paths": {
      "financial": "data/financial-cache",
      "chip": "data/chip-cache",
      "news": "data/news-cache"
    }
  },

  "deduplication": {
    "algorithm": "jaccard",
    "threshold": 0.85,
    "keywordOverlapMin": 3,
    "titlePrefixLength": 10,
    "enabled": true
  },

  "dataSources": {
    "rss": [
      {
        "id": "yahoo-tw",
        "name": "Yahoo Finance 台股",
        "url": "https://tw.stock.yahoo.com/rss?category=tw-market",
        "type": "rss",
        "category": "Taiwan_Market",
        "enabled": true
      },
      {
        "id": "cnbc-business",
        "name": "CNBC Business News",
        "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147",
        "type": "rss",
        "category": "Equity_Market",
        "enabled": true
      },
      {
        "id": "cnbc-investing",
        "name": "CNBC Markets",
        "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069",
        "type": "rss",
        "category": "Equity_Market",
        "enabled": true
      },
      {
        "id": "udn-business",
        "name": "經濟日報",
        "url": "https://money.udn.com/rssfeed/news/1001/5591/latest",
        "type": "rss",
        "category": "Taiwan_Market",
        "enabled": true
      }
    ],
    "api": {
      "yahoo": {
        "base": "https://query1.finance.yahoo.com/v8/finance/chart/",
        "enabled": true
      },
      "twse": {
        "dailyTrade": "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
        "marginTrading": "https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN",
        "institutional": "https://www.twse.com.tw/rwd/zh/fund/T86",
        "enabled": true
      },
      "mops": {
        "stockInfo": "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
        "monthlyRevenue": "https://openapi.twse.com.tw/v1/opendata/t187ap05_L",
        "quarterlyReport": "https://openapi.twse.com.tw/v1/opendata/t187ap14_L",
        "financialRatio": "https://openapi.twse.com.tw/v1/opendata/t187ap06_L",
        "enabled": true
      }
    },
    "manual_input": {
      "type": "line_group",
      "description": "LINE 群組早報（主要資料源）",
      "enabled": true
    }
  },

  "logging": {
    "level": "info",
    "format": "pretty",
    "output": "stdout",
    "errorOutput": "stderr",
    "file": {
      "enabled": false,
      "path": "logs/market-digest.log",
      "maxSize": "10MB",
      "maxFiles": 7
    }
  },

  "telegram": {
    "botToken": "${TELEGRAM_BOT_TOKEN}",
    "chatId": "${TELEGRAM_CHAT_ID}",
    "enabled": true,
    "maxMessageLength": 4000,
    "preview": {
      "maxItems": 3
    },
    "fullReport": {
      "maxItems": 10
    }
  },

  "processing": {
    "dedup_threshold": 0.85,
    "min_news_count": 5,
    "max_age_hours": 24,
    "filterKeywords": true,
    "keywords": [
      "台積電", "TSMC", "外資", "台股", "美股",
      "Fed", "AI", "聯發科", "鴻海"
    ]
  },

  "technicalIndicators": {
    "ma_periods": [5, 20],
    "rsi_period": 14,
    "enabled": true
  },

  "importanceRules": {
    "critical_keywords": [
      "Fed", "央行", "升息", "降息", "台積電", "TSMC"
    ],
    "high_keywords": [
      "財報", "法說會", "GDP", "CPI", "聯電", "鴻海",
      "台股", "加權指數"
    ],
    "taiwan_keywords": [
      "台股", "台積電", "聯電", "鴻海", "大立光",
      "台灣", "TSMC"
    ],
    "volume_spike_threshold": 1.5,
    "price_change_threshold": 2.0
  },

  "paths": {
    "data": "data",
    "cache": "data/cache",
    "output": "data/output",
    "newsCollect": "data/news-collect",
    "dailyBrief": "data/daily-brief",
    "watchlist": "data/watchlist.json",
    "logs": "logs"
  },

  "dataRetention": {
    "news": 30,
    "marketData": 90,
    "cache": 7,
    "logs": 30
  },

  "sre": {
    "healthCheck": {
      "enabled": true,
      "interval": 300000
    },
    "circuitBreaker": {
      "enabled": true,
      "threshold": 5,
      "timeout": 60000,
      "resetTimeout": 300000
    },
    "metrics": {
      "enabled": true,
      "collectInterval": 60000
    }
  }
}
```

### .env 環境變數

```bash
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# API
API_TIMEOUT_MS=10000
API_RETRIES=3

# Cache
CACHE_ENABLED=true

# Data Retention
DATA_RETENTION_NEWS_DAYS=30
DATA_RETENTION_MARKET_DATA_DAYS=90
DATA_RETENTION_CACHE_DAYS=7
DATA_RETENTION_LOGS_DAYS=30

# SRE
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT_MS=60000
HEALTH_CHECK_INTERVAL_MS=300000
METRICS_COLLECT_INTERVAL_MS=60000

# Environment
NODE_ENV=production
TZ=Asia/Taipei
```

---

## 資料結構

### News Schema (news.schema.js)

```javascript
{
  version: "1.0",
  timestamp: "2026-02-17T08:00:00Z",
  source: "market-digest",
  date: "2026-02-17",
  count: 85,
  data: [
    {
      id: "uuid-string",
      title: "標題",
      source: "Yahoo Finance",
      sourceId: "yahoo-tw",
      category: "Taiwan_Market",
      link: "https://...",
      pubDate: "2026-02-17T00:00:00Z",  // ISO 8601
      description: "描述",
      importance: "high",  // critical | high | medium | low
      keywords: ["台積電", "TSMC"]
    }
  ]
}
```

### Market Data Schema (market-data.schema.js)

```javascript
{
  version: "1.0",
  timestamp: "2026-02-17T15:30:00Z",
  date: "2026-02-17",
  indices: {
    twii: {
      value: 32195.359,
      change: -1.85,
      changePercent: -0.0574,
      volume: 123456789
    },
    sp500: {
      value: 6917.81,
      change: -60.19,
      changePercent: -0.0087,
      volume: 987654321
    }
  },
  fx: {
    usdtwd: {
      value: 31.58,
      change: 0.47,
      changePercent: 1.51
    }
  },
  commodities: {
    gold: { value: 2050.00 },
    oil: { value: 75.20 }
  },
  vix: { value: 15.32 }
}
```

### Financial Schema (financial.schema.js)

```javascript
{
  version: "1.0",
  timestamp: "2026-02-17T08:00:00Z",
  stockCode: "2330",
  stock: {
    code: "2330",
    name: "台積電",
    industry: "半導體"
  },
  monthlyRevenue: {
    period: "2026-01",
    revenue: 234567890,
    mom: 5.2,  // 月增率
    yoy: 12.5  // 年增率
  },
  quarterlyReport: {
    period: "2025Q4",
    revenue: 987654321,
    netIncome: 123456789,
    eps: 12.34
  }
}
```

### Chip Schema (chip.schema.js)

```javascript
{
  version: "1.0",
  timestamp: "2026-02-17T08:00:00Z",
  date: "2026-02-17",
  stock: {
    code: "2330",
    name: "台積電"
  },
  margin: {
    marginPurchase: 123456,    // 融資買進
    marginSale: 67890,          // 融資賣出
    marginBalance: 234567,      // 融資餘額
    shortSale: 12345,           // 融券賣出
    shortCover: 6789,           // 融券回補
    shortBalance: 34567         // 融券餘額
  },
  institutional: {
    foreign: 123456,    // 外資買賣超
    trust: 12345,       // 投信買賣超
    dealer: 1234        // 自營商買賣超
  }
}
```

### Watchlist Schema (watchlist.schema.js)

```javascript
{
  version: "1.0",
  stocks: [
    {
      code: "2330",
      name: "台積電",
      addedAt: "2026-01-01T00:00:00Z",
      tags: ["半導體", "權值股"],
      notes: "觀察 AI 伺服器需求"
    }
  ],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-02-17T08:00:00Z"
}
```

---

## 監控與告警

### Prometheus Metrics

#### HTTP Metrics
```prometheus
# Total HTTP requests
http_requests_total 1234

# Successful HTTP requests
http_requests_success_total 1100

# Failed HTTP requests
http_requests_failed_total 134

# Average HTTP request duration (ms)
http_request_duration_ms 250.5
```

#### Cache Metrics
```prometheus
# Total cache hits
cache_hits_total 850

# Total cache misses
cache_misses_total 200

# Cache hit rate (%)
cache_hit_rate_percent 81.00
```

#### System Metrics
```prometheus
# System uptime (seconds)
system_uptime_seconds 86400

# Disk free space (MB)
disk_free_mb 33252

# Memory free (MB)
memory_free_mb 1018
```

### Alert Rules Summary

| Alert ID | Name | Severity | Threshold | Status |
|----------|------|----------|-----------|--------|
| api_latency_high | API 延遲過高 | warning | 5000ms | ✅ Normal |
| api_latency_critical | API 延遲嚴重 | critical | 10000ms | ✅ Normal |
| cache_hit_ratio_low | 快取命中率低 | warning | 50% | ✅ Normal |
| http_error_rate_high | HTTP 錯誤率高 | warning | 10% | ✅ Normal |
| http_error_rate_critical | HTTP 錯誤率嚴重 | critical | 50% | ✅ Normal |

---

## 部署與運維

### 排程任務 (Cron)

```cron
# 每日早報推播（每日 00:30）
30 0 * * * /home/clawbot/clawd/agents/market-digest/sre/cron-wrapper.sh morning-report "cd /home/clawbot/clawd/agents/market-digest && node smart-integrator.js push"

# 健康檢查（每 5 分鐘）
*/5 * * * * /home/clawbot/clawd/agents/market-digest/sre/cron-wrapper.sh health-check "cd /home/clawbot/clawd/agents/market-digest && node sre/health-check.js"

# 每日備份（每日 02:00）
0 2 * * * /home/clawbot/clawd/agents/market-digest/sre/backup-strategy.sh

# 日誌清理（每週日 03:00）
0 3 * * 0 find /home/clawbot/clawd/agents/market-digest/logs -name "*.log" -mtime +30 -delete

# 快取清理（每日 04:00）
0 4 * * * find /home/clawbot/clawd/agents/market-digest/data/*-cache -type f -mtime +7 -delete
```

### 維護命令

#### 健康檢查
```bash
cd ~/clawd/agents/market-digest
node sre/health-check.js
```

#### 指標檢視
```bash
cd ~/clawd/agents/market-digest
node sre/metrics-collector.js
```

#### 手動備份
```bash
cd ~/clawd/agents/market-digest
./sre/backup-strategy.sh
```

#### 測試 SRE 系統
```bash
cd ~/clawd/agents/market-digest
node test-sre-integration.js
```

#### 查看日誌
```bash
cd ~/clawd/agents/market-digest
tail -f logs/cron-morning-report.log
tail -f logs/health-check.json
```

---

## API 規格

### 內部命令 API

#### `/run` - 執行完整流程
```bash
node agent.js /run
```
**功能**：執行完整的資料收集、處理、生成流程

#### `/fetch` - 僅抓取新聞
```bash
node agent.js /fetch
```
**功能**：從 RSS 源抓取新聞，不進行後續處理

#### `/analyze` - 僅分析現有新聞
```bash
node agent.js /analyze
```
**功能**：對已收集的新聞進行 AI 分析

#### `/generate` - 僅生成早報
```bash
node agent.js /generate
```
**功能**：根據現有資料生成早報

#### `/push` - 僅推播
```bash
node agent.js /push
```
**功能**：推播已生成的早報至 Telegram

---

## 依賴項

### NPM Packages

```json
{
  "dependencies": {
    "axios": "^1.13.4",           // HTTP 請求
    "node-fetch": "^2.7.0",       // Fetch API
    "rss-parser": "^3.13.0"       // RSS 解析
  }
}
```

### 外部服務

| 服務 | 用途 | 必要性 |
|------|------|--------|
| Telegram Bot API | 推播早報 | 必要 |
| Yahoo Finance API | 股價數據 | 選用 |
| TWSE API | 台股數據 | 選用 |
| MOPS API | 財報數據 | 選用 |
| OpenClaw | AI 分析 | 選用 |

---

## 效能指標

### 處理效能

| 指標 | 數值 | 說明 |
|------|------|------|
| 啟動時間 | ~2.5s | 載入模組 + 初始化 |
| RSS 抓取 | 15-20s | 4 個來源並行 |
| 去重處理 | 3-5s | 60 篇新聞 |
| AI 分析 | 10-15s | OpenClaw API |
| 早報生成 | 2-3s | 格式化與輸出 |
| **完整流程** | **35-50s** | 端到端 |

### 資源使用

| 資源 | 使用量 | 峰值 |
|------|--------|------|
| CPU | 5-10% | 30% |
| 記憶體 | 50-70MB | 150MB |
| 磁碟 I/O | 低 | 中 (生成時) |
| 網絡 I/O | 中 (抓取時) | 高 |

---

## 版本歷史

### v2.0 - Architecture Refactored (2026-02-16)
**重大更新**：
- ✅ Phase 1: 統一基礎層（HTTP, Cache, Logger, Deduplicator）
- ✅ Phase 2: 資料結構標準化（JSON Schema）
- ✅ Phase 3: 配置管理優化（config.json, .env）
- ✅ Phase 4: 模組整合與清理
- ✅ Phase 5: SRE 增強（Metrics, Alerting, Backup, Health Check）
- ✅ Phase 6: 文件整理

**改善指標**：
- 代碼重複減少 >1100 行
- 模組從 70+ 減少到 ~30 個
- 文檔從 42 個減少到 6 個核心
- 維護成本降低 50%

### v1.5 - SRE Complete (2026-02-XX)
- ✅ Circuit Breaker
- ✅ Graceful Degradation
- ✅ Health Check
- ✅ Error Handler

### v1.0 - MVP (2026-01-XX)
- ✅ 基礎新聞聚合
- ✅ 早報生成
- ✅ Telegram 推播

---

## 聯絡資訊

- **專案維護者**: clawbot
- **運行環境**: VPS (159.65.136.0)
- **OpenClaw Version**: v2026.2.12
- **Node.js Version**: v22.22.0
- **專案路徑**: `/home/clawbot/clawd/agents/market-digest/`

---

**文件版本**: 2.0
**最後更新**: 2026-02-16
**狀態**: ✅ Production Ready (100%)
