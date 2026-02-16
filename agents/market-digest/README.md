# Market Digest Agent

**智能台股早報生成系統**

Market Digest 是一個自動化的市場資訊整合系統，每日收集、分析和整合台股相關新聞與市場數據，生成結構化早報並推播至 Telegram。

## 🚀 快速開始

```bash
# 1. 安裝依賴
npm install

# 2. 配置環境變數
cp .env.example .env
# 編輯 .env 設定 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID

# 3. 執行早報生成
node agent.js /run

# 4. 查看輸出
cat data/daily-brief/$(date +%Y-%m-%d).txt
```

詳細說明請參考 [QUICKSTART.md](./QUICKSTART.md)

## ✨ 核心功能

- **多來源新聞聚合**: 整合 RSS（Yahoo Finance, CNBC, 經濟日報）和 LINE 群組早報
- **智能去重**: 使用 Levenshtein 距離和關鍵字重疊算法，85%+ 準確率
- **重要性評分**: 多因子評分系統（關鍵字、來源、時效性）
- **AI 分析**: 自動摘要、關鍵字提取、情感分析
- **市場數據**: 台股指數、美股、匯率、技術指標
- **自動推播**: 每日 08:00 推播至 Telegram
- **SRE 系統**: Circuit Breaker、Graceful Degradation、Health Check

## 📂 專案結構

```
market-digest/
├── agent.js              # 主程式入口
├── config.json           # 配置檔案
├── .env                  # 環境變數（需自行建立）
│
├── shared/               # 共用模組
│   ├── http-client.js    # HTTP 請求封裝
│   ├── cache-manager.js  # 快取管理
│   ├── logger.js         # 日誌系統
│   ├── deduplicator.js   # 去重邏輯
│   ├── config-loader.js  # 配置載入
│   └── schemas/          # 資料結構 Schema
│
├── sre/                  # SRE 模組
│   ├── metrics-collector.js    # 指標收集
│   ├── alerting-rules.js       # 告警規則
│   ├── health-check.js         # 健康檢查
│   └── backup-strategy.sh      # 備份腳本
│
├── data/                 # 資料目錄
│   ├── news-collect/     # 新聞收集
│   ├── daily-brief/      # 每日摘要
│   └── watchlist.json    # 監控清單
│
└── docs/                 # 文件
    ├── reference/        # 參考文檔
    └── archive/          # 歷史文檔
```

## 📚 文件導覽

### 核心文檔
- [README.md](./README.md) - 本文件，專案總覽
- [QUICKSTART.md](./QUICKSTART.md) - 快速開始指南
- [DATA_SOURCES.md](./DATA_SOURCES.md) - 資料源說明
- [USER_GUIDE.md](./USER_GUIDE.md) - 完整使用手冊
- [CHANGELOG.md](./CHANGELOG.md) - 更新記錄
- [REFACTORING_NOTES.md](./REFACTORING_NOTES.md) - 重構筆記

### 參考文檔（docs/reference/）
- [DEPLOYMENT_GUIDE.md](./docs/reference/DEPLOYMENT_GUIDE.md) - 部署指南
- [PIPELINE.md](./docs/reference/PIPELINE.md) - 資料處理流程
- [QUERY_TOOL.md](./docs/reference/QUERY_TOOL.md) - 查詢工具使用
- [QUICK_REFERENCE.md](./docs/reference/QUICK_REFERENCE.md) - 快速參考
- [SRE_QUICK_REFERENCE.md](./docs/reference/SRE_QUICK_REFERENCE.md) - SRE 快速參考

### 歷史文檔（docs/archive/）
- 實作報告、升級記錄、技術研究等歷史文檔

## 🔧 配置

主要配置檔案：`config.json`

```json
{
  "http": {
    "timeout": 10000,
    "retries": 3
  },
  "cache": {
    "ttl": {
      "news": 1800000,
      "marketData": 300000
    }
  },
  "dataSources": {
    "rss": [...],
    "api": {...}
  }
}
```

環境變數：`.env`

```bash
TELEGRAM_BOT_TOKEN=your_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
LOG_LEVEL=info
```

## 🛠️ 開發

### 執行測試

```bash
# SRE 整合測試
node test-sre-integration.js

# 健康檢查
node sre/health-check.js

# 指標檢視
node sre/metrics-collector.js
```

### 排程設定

```bash
# 設定每日早報 cron
./setup-daily-brief-cron.sh

# 設定 SRE 監控 cron
./setup-sre-cron.sh
```

## 📊 系統監控

### 健康檢查

```bash
node sre/health-check.js
```

檢查項目：磁碟空間、記憶體使用、進程狀態、資料檔案完整性

### 指標收集

- HTTP 請求延遲和成功率
- 快取命中率
- 資料處理統計
- 支援 Prometheus 格式匯出

### 告警系統

- API 延遲過高（5s warning, 10s critical）
- 快取命中率低於 50%
- HTTP 錯誤率過高（10% warning, 50% critical）

## 🔄 備份策略

```bash
# 手動備份
./sre/backup-strategy.sh

# 自動備份（每日 cron）
# data/ 和配置檔案
# 7 天保留期限
```

## 🤝 貢獻

請參考 [REFACTORING_NOTES.md](./REFACTORING_NOTES.md) 了解專案架構和待處理項目。

## 📝 授權

Private Project

## 📞 聯絡

- 專案維護者：clawbot
- 運行環境：VPS (159.65.136.0)
