# Market Digest

股票追蹤與分析系統，整合財報、籌碼面數據與智慧分析。

## 快速開始

### Telegram 指令
```
/financial        # 日報
/weekly          # 週報
/analyze 2330    # 單檔分析
/alerts          # 異常檢查
```

### 建立追蹤清單
```
/watchlist add 2330 2454 2408
```

## 文件導覽

- **QUICK_REFERENCE.md** - 快速參考卡（必讀）
- **USER_MANUAL.md** - 完整使用手冊
- **FEATURES_SUMMARY.md** - 功能總覽
- **DEPLOYMENT_COMPLETE.md** - 部署報告

## 專案狀態

**版本：** Phase 2 Complete  
**完成度：** 100%（6/6 核心項目）  
**狀態：** ✅ 可使用

## 核心功能

- ✅ 財報數據（營收、EPS）
- ✅ 籌碼面數據（融資、法人）
- ✅ 智慧分析（評分、異常）
- ✅ 週報統計（法人動向）
- ✅ Telegram 整合
- ✅ 智慧提醒

## 自動功能

- **08:30 每日：** 早報整合推播
- **16:00 每日：** 異常檢測推播

## 技術支援

問題或建議透過 Telegram 告訴 Clawdbot。

---

## 實作狀態

**版本**: v1.0
**完成度**: 100%（所有核心模組已實作）
**部署位置**: VPS `/home/clawbot/clawd/agents/market-digest/`

### 核心實作檔案

**數據獲取與分析**：
- `financial-data-fetcher.js` - 財報數據整合（營收、EPS）
- `chip-data-fetcher.js` - 籌碼面數據抓取（融資、法人）
- `chip-analyzer.js` - 智慧分析引擎（綜合評分、風險警示）

**報告生成**：
- `daily-brief-generator.js` - 早報生成器
- `weekly-summary.js` - 週報生成
- `news-collector.js` - 新聞收集器
- `news-analyzer.js` - 新聞分析引擎

**自動化與監控**：
- `alert-monitor.js` - 異常監控（融資使用率、法人動向）
- `reminder-checker.js` - 提醒系統
- `agent.js` - Telegram 指令介面

**後端支援**：
- `backend/` - 資料處理、翻譯、過濾模組
- `sre/` - 健康檢查、穩定性工具
- `utils/` - 工具函式庫

### 自動化排程（需在 VPS 上通過 crontab 設置）

```bash
# 早報收集（08:00-08:10 台北時間）
0 0 * * * cd ~/clawd/agents/market-digest && node news-collector.js

# 早報推播（08:30 台北時間）
30 0 * * * cd ~/clawd/agents/market-digest && bash morning-summary.sh

# 異常檢測（16:00 台北時間 = 08:00 UTC）
0 8 * * * cd ~/clawd/agents/market-digest && node alert-monitor.js

# 週報推播（每週日 20:00 台北時間 = 12:00 UTC）
0 12 * * 0 cd ~/clawd/agents/market-digest && node weekly-summary.js
```

### 本地開發

```bash
# 安裝依賴
cd src/agents/market-digest
npm install

# 測試 Telegram 指令介面
node agent.js

# 手動執行早報生成
node daily-brief-generator.js
```

### 部署到 VPS

```bash
# 從本地同步到 VPS
./tools/vps-sync.sh

# 或使用部署腳本（會自動重啟）
./tools/vps-deploy.sh market-digest
```
