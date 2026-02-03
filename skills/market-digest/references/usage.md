# Market Digest 使用指南

## 指令速查

### 收集早報（08:00-08:10）
```bash
node scripts/morning-collector.js add-text "<早報文字內容>"
node scripts/morning-collector.js add-image <圖片路徑>
node scripts/morning-collector.js status
```

### 生成報告
```bash
# 標準版（800 字）
node scripts/smart-integrator.js integrate --level minimal

# 完整版（原文）
node scripts/smart-integrator.js integrate --level full

# 推播到 Telegram
node scripts/smart-integrator.js push
```

### 搜尋歷史
```bash
# 預設搜尋最近 7 天
node scripts/query.js --keyword "台積電"

# 指定天數
node scripts/query.js --keyword "聯發科" --days 30

# 只顯示數量
node scripts/query.js --keyword "台股" --count
```

### Watchlist 管理
```bash
# 新增股票
node scripts/watchlist.js add 2330 2454

# 查看清單
node scripts/watchlist.js list

# 今日摘要
node scripts/watchlist.js summary

# 歷史記錄
node scripts/watchlist.js history 2454 --days 14

# 移除股票
node scripts/watchlist.js remove 2330
```

## 資料路徑

### 收集資料
- `data/morning-collect/YYYY-MM-DD.json` - 每日早報收集

### 生成報告
- `data/runtime/morning-report.txt` - 最新報告文字
- `data/timeseries/reports/YYYY/MM/report-YYYY-MM-DD.txt` - 歷史報告

### Watchlist
- `data/watchlist.json` - 追蹤清單
- `data/timeseries/market-data/` - 市場數據

### 提醒
- `data/reminders/YYYY-MM-DD.json` - 每日提醒事件

## 自動化流程

### Cron 排程
```cron
# 每日 08:30 (UTC 00:30) - 整合早報並推播
30 0 * * * cd ~/clawd/agents/market-digest && node smart-integrator.js push

# 每日 20:00 (UTC 12:00) - 檢查明日提醒
0 12 * * * cd ~/clawd/agents/market-digest && node reminder-checker.js

# 每週五 20:00 - 週報
0 12 * * 5 cd ~/clawd/agents/market-digest && node weekly-summary.js
```

## 設定檔

主要設定：`config.json`
```json
{
  "sources": ["yahoo-finance", "bloomberg"],
  "alerts": {
    "disk": 85,
    "cpu": 80
  }
}
```
