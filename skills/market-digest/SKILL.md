---
name: market-digest
description: 財經新聞整合與個股追蹤工具。Use when Chris needs to (1) collect morning financial news (08:00-08:10 Taipei time), (2) generate integrated market reports (/today command), (3) search historical news (/query command), (4) manage stock watchlist, (5) check reminders for upcoming events. Handles LINE group morning reports, market data fetching, news aggregation, and Telegram notifications.
---

# Market Digest

財經新聞自動化整合系統，支援早報收集、歷史搜尋、個股追蹤、自動提醒。

## Quick Start

### 1. 收集早報（08:00-08:10）

當 Chris 在 Telegram 貼早報時，自動偵測並收集：

```bash
node scripts/morning-collector.js add-text "<早報內容>"
node scripts/morning-collector.js add-image <圖片路徑>
```

**回覆格式：**
```
✅ 已收集早報（第 N 則）
```

### 2. 生成報告（/today）

```bash
# 標準版（800 字，適合快速閱讀）
node scripts/smart-integrator.js integrate --level minimal

# 完整版（原文，包含所有細節）
node scripts/smart-integrator.js integrate --level full

# 整合並推播到 Telegram
node scripts/smart-integrator.js push
```

報告格式：
- 📈 市場概況（指數、匯率、商品）
- 🌐 重點新聞（去重後的關鍵事件）
- 🇹🇼 台灣焦點
- 📊 補充資訊

### 3. 搜尋歷史（/query）

```bash
# 搜尋最近 7 天
node scripts/query.js --keyword "台積電"

# 指定天數範圍
node scripts/query.js --keyword "聯發科" --days 30

# 只顯示數量
node scripts/query.js --keyword "台股" --count
```

搜尋範圍：
- `data/morning-collect/` - 早報原始資料
- `data/timeseries/reports/` - 生成的報告

### 4. Watchlist 管理

```bash
# 新增股票
node scripts/watchlist.js add 2330 2454

# 查看清單
node scripts/watchlist.js list

# 今日摘要（從早報提取）
node scripts/watchlist.js summary

# 歷史記錄
node scripts/watchlist.js history 2454 --days 14

# 移除股票
node scripts/watchlist.js remove 2330
```

## 資料結構

### 收集階段
```
data/morning-collect/2026-02-03.json
{
  "date": "2026-02-03",
  "items": [
    {"type": "text", "content": "...", "timestamp": "..."},
    {"type": "image", "path": "...", "timestamp": "..."}
  ]
}
```

### 整合階段
```
data/runtime/morning-report.txt  (最新報告)
data/timeseries/reports/2026/02/report-2026-02-03.txt
```

### Watchlist
```
data/watchlist.json
{
  "stocks": {
    "2330": {"name": "台積電", "addedAt": "..."},
    "2454": {"name": "聯發科", "addedAt": "..."}
  }
}
```

## 自動化（Cron）

系統已設定以下自動任務：

```cron
# 每日 08:30 (UTC 00:30) - 整合早報並推播
30 0 * * * node smart-integrator.js push

# 每日 20:00 (UTC 12:00) - 檢查明日提醒
0 12 * * * node reminder-checker.js

# 每週五 20:00 - 週報
0 12 * * 5 node weekly-summary.js
```

## 工作流程

### Morning Report Flow
```
08:00-08:10  Chris 貼早報 → morning-collector.js 收集
08:30        Cron 觸發 → smart-integrator.js 整合
             └─ 讀取 LINE 早報
             └─ 提取市場數據
             └─ 去重新聞
             └─ 生成報告
             └─ 推播到 Telegram
```

### Query Flow
```
/query 台積電 --days 7
  └─ 搜尋 data/morning-collect/*.json
  └─ 搜尋 data/timeseries/reports/**/*.txt
  └─ 過濾關鍵字
  └─ 排序 & 格式化
  └─ 回傳結果（限制 4000 字元）
```

### Watchlist Flow
```
watchlist summary
  └─ 讀取 data/watchlist.json
  └─ 從當日早報提取個股資訊
  └─ 格式化輸出（股票代碼 + 摘要）
```

## 進階功能

### Reminder System

自動從早報提取提醒事件（例：「2/3 聯發科法說會」）並於前一日推播：

```json
data/reminders/2026-02-03.json
{
  "date": "2026-02-03",
  "reminders": [
    {
      "text": "聯發科法說會",
      "priority": "high",
      "source": "morning-report"
    }
  ]
}
```

### Weekly Summary

每週五自動生成週報：
- 本週重大事件
- 表現最佳個股
- Watchlist 表現
- 下週關鍵事件

## 依賴套件

主要依賴（位於 `agents/market-digest/package.json`）：
- `axios` - HTTP 請求
- `cheerio` - HTML 解析
- `rss-parser` - RSS 抓取
- `levenshtein` - 新聞去重

## 疑難排解

### 早報收集失敗
- 檢查 `data/morning-collect/` 權限
- 確認時區設定（Asia/Taipei）

### 報告生成為空
- 檢查 `data/morning-collect/YYYY-MM-DD.json` 是否有資料
- 確認 news sources 是否正常（config.json）

### 搜尋結果過多
- 使用 `--count` 先檢查數量
- 縮小 `--days` 範圍
- 使用更精確的關鍵字

## References

詳細使用方式見 [references/usage.md](references/usage.md)
