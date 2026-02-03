# Legacy 資料源

此目錄保留舊的資料源架構，供未來參考或重新啟用。

## 📁 檔案說明

- **`rss.js`** - RSS adapter（已被 plugin 架構取代）
- **`yahoo.js`** - 舊版 Yahoo adapter（已被 yahoo-finance plugin 取代）
- **`bloomberg/`** - Bloomberg RSS plugin（未啟用）
- **`custom-api/`** - 自定義 API plugin（未啟用）

## 📊 當前資料流

### 主要資料源：LINE 群組早報（手動輸入）
- **收集工具：** `morning-collector.js`
- **存放位置：** `data/morning-collect/`
- **格式：** JSON（包含文字與圖片）

### 市場數據：Yahoo Finance API
- **Plugin：** `backend/sources/plugins/yahoo-finance/`
- **用途：** 台股/美股指數、匯率

## 🔄 若需重新啟用

1. 將檔案移回 `backend/sources/`
   ```bash
   mv backend/sources/legacy/rss.js backend/sources/
   ```

2. 更新 `config.json`
   ```json
   {
     "data_sources": {
       "tw_news": [
         {
           "name": "Yahoo 奇摩股市",
           "type": "rss",
           "url": "https://tw.stock.yahoo.com/rss",
           "enabled": true
         }
       ]
     }
   }
   ```

3. 測試 RSS 連線
   ```bash
   node test-news-sources.js
   ```

4. 更新 `backend/fetcher.js`（重新引入 RSSAdapter）

## ⚠️ 注意事項

- 這些檔案已移至 legacy，表示當前系統不依賴它們
- 若重新啟用，需確保依賴套件已安裝（`rss-parser`）
- 建議先在測試環境驗證再部署

---

**移至 legacy 日期：** 2026-02-03  
**原因：** 當前主要依賴 LINE 群組早報，RSS feeds 未使用
