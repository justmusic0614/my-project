# Daily Brief 部署指南

**版本：** 1.0  
**日期：** 2026-02-04  
**狀態：** ✅ 可部署

---

## 🚀 快速部署（3 步驟）

### Step 1：測試功能

```bash
cd ~/clawd/agents/market-digest

# 生成 Daily Brief
node daily-brief-generator.js

# 查看結果
cat data/daily-brief/$(date +%Y-%m-%d).txt
```

**預期結果：** 
- ✅ 生成完整的 Daily Brief（包含 10 個 sections）
- ✅ Daily_Snapshot 顯示 3-5 個重點
- ✅ Market_Regime 顯示市場狀態
- ✅ Watchlist_Focus 顯示追蹤股票

---

### Step 2：設定自動執行

```bash
cd ~/clawd/agents/market-digest
bash setup-daily-brief-cron.sh
```

**Cron Job：**
```cron
# 每日 08:30 UTC (台北 16:30) - 生成並推播 Daily Brief
30 0 * * * cd ~/clawd/agents/market-digest && node integrate-daily-brief.js >> logs/daily-brief.log 2>&1
```

**驗證：**
```bash
crontab -l | grep daily-brief
```

---

### Step 3：測試 /today 指令

在 Telegram 輸入：
```
/today
```

**預期行為：**
1. Clawdbot 執行 `node integrate-daily-brief.js`
2. 讀取 `data/runtime/morning-report.txt`
3. 推播 Daily Brief 到 Telegram

---

## 📋 驗收清單

### 功能驗收

- [ ] **新聞搜集**：`node news-collector.js` 正常運作
- [ ] **AI 分析**：`node news-analyzer.js` 正常運作
- [ ] **Daily Brief 生成**：`node daily-brief-generator.js` 正常運作
- [ ] **Watchlist 整合**：顯示正確的股票代碼與名稱
- [ ] **10 個 sections**：全部正常顯示
- [ ] **格式正確**：符合 Daily_Market_Brief 規格

### 整合驗收

- [ ] **AGENTS.md 更新**：`/today` 指令已更新
- [ ] **Cron Job 設定**：每日自動執行
- [ ] **日誌記錄**：`logs/daily-brief.log` 正常寫入
- [ ] **Telegram 推播**：`/today` 指令正常推播

### 文件驗收

- [ ] **MVP_COMPLETE.md**：完成報告已建立
- [ ] **DEPLOYMENT_GUIDE.md**：部署指南已建立（本檔案）
- [ ] **README 更新**：功能說明已更新

---

## 🔧 設定檔

### 1. Watchlist

**位置：** `data/watchlist.json`

**格式：**
```json
{
  "stocks": [
    { "code": "2330", "name": "台積電" },
    { "code": "2454", "name": "聯發科" },
    { "code": "2408", "name": "南亞科" }
  ]
}
```

**修改：**
```bash
# 使用現有的 watchlist.js
cd ~/clawd/agents/market-digest
node watchlist.js add 2330 2454 2408
node watchlist.js list
```

---

### 2. 市場數據來源

**位置：** `config.json`

**已整合：**
- 台股指數 (^TWII)
- 美股指數 (^GSPC, ^IXIC)
- 匯率 (TWD=X)
- 技術指標 (MA5, MA20, RSI)

---

### 3. 新聞來源

**當前：**
- Yahoo Finance News API

**未來擴充：**
- Reuters RSS
- 經濟日報 RSS
- MoneyDJ API

---

## 📊 日誌與監控

### 查看日誌

```bash
# Daily Brief 生成日誌
tail -f ~/clawd/agents/market-digest/logs/daily-brief.log

# 新聞搜集日誌
tail -f ~/clawd/agents/market-digest/logs/news-collector.log

# 整合日誌
tail -f ~/clawd/agents/market-digest/logs/morning-report.log
```

### 檢查輸出檔案

```bash
# Daily Brief
ls -lh ~/clawd/agents/market-digest/data/daily-brief/

# 新聞資料
ls -lh ~/clawd/agents/market-digest/data/news-analyzed/

# 完整報告
cat ~/clawd/agents/market-digest/data/runtime/morning-report.txt
```

---

## 🐛 疑難排解

### 問題 1：Daily Brief 生成失敗

**檢查：**
```bash
cd ~/clawd/agents/market-digest
node daily-brief-generator.js
```

**可能原因：**
- 缺少分析數據 (`data/news-analyzed/` 為空)
- Watchlist 檔案損壞
- 市場數據 API 無法連線

**解決方案：**
```bash
# 手動執行完整 Pipeline
node generate-brief-pipeline.js
```

---

### 問題 2：/today 指令沒反應

**檢查：**
```bash
# 檢查 AGENTS.md 是否更新
grep "integrate-daily-brief" ~/clawd/AGENTS.md

# 手動執行整合腳本
cd ~/clawd/agents/market-digest
node integrate-daily-brief.js
```

---

### 問題 3：Cron Job 沒執行

**檢查：**
```bash
# 查看 crontab
crontab -l | grep daily-brief

# 查看 cron 日誌
grep CRON /var/log/syslog | grep daily-brief | tail -10

# 測試 Cron 環境
cd ~/clawd/agents/market-digest && node -v
```

---

### 問題 4：Watchlist 沒顯示

**檢查：**
```bash
# 確認 watchlist.json 存在
cat ~/clawd/agents/market-digest/data/watchlist.json

# 檢查格式
node -e "console.log(JSON.parse(require('fs').readFileSync('data/watchlist.json','utf8')))"
```

---

## 🔄 更新與維護

### 每日檢查

```bash
# 查看今日 Daily Brief
cat ~/clawd/agents/market-digest/data/daily-brief/$(date +%Y-%m-%d).txt

# 檢查 Cron 是否執行
tail -20 ~/clawd/agents/market-digest/logs/daily-brief.log
```

### 每週檢查

```bash
# 檢查過去 7 天的輸出
ls -lht ~/clawd/agents/market-digest/data/daily-brief/ | head -10

# 清理舊日誌（保留 30 天）
find ~/clawd/agents/market-digest/logs/ -name "*.log" -mtime +30 -delete
```

### 手動更新 Watchlist

```bash
cd ~/clawd/agents/market-digest

# 新增股票
node watchlist.js add 2330 2454

# 移除股票
node watchlist.js remove 2330

# 查看清單
node watchlist.js list
```

---

## 📞 支援

### 文件

- **MVP 完成報告：** `MVP_COMPLETE.md`
- **使用指南：** `USER_GUIDE.md`（如果有）
- **功能摘要：** `FEATURES_SUMMARY.md`（market-digest 既有）

### 指令速查

```bash
# 生成 Daily Brief
node daily-brief-generator.js

# 完整 Pipeline（搜集 → 分析 → 生成）
node generate-brief-pipeline.js

# 整合到 /today
node integrate-daily-brief.js

# 測試腳本
bash test-daily-brief-mvp.sh

# 設定 Cron
bash setup-daily-brief-cron.sh
```

---

## ✅ 部署完成確認

完成以下檢查清單：

- [ ] Daily Brief 可正常生成
- [ ] Watchlist 顯示正確
- [ ] 格式符合規格（10 sections）
- [ ] Cron Job 已設定
- [ ] /today 指令已測試
- [ ] 日誌正常記錄
- [ ] 備份腳本已設定（選用）

---

**部署完成！** 🎉

如有問題，請查看：
- `logs/daily-brief.log`
- `MVP_COMPLETE.md`
- 或執行 `bash test-daily-brief-mvp.sh`
