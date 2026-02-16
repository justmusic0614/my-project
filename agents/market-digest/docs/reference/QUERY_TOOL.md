# 快速檢索工具（Query Tool）

快速搜尋歷史早報內容，支援關鍵字、個股、類別查詢。

## 功能

- ✅ 關鍵字搜尋（如：沃什、Fed、降息）
- ✅ 個股搜尋（如：2330、2454、台積電）
- ✅ 類別搜尋（台股、美股、匯率、商品、美債、科技）
- ✅ 時間範圍（預設 7 天，可指定 1-90 天）
- ✅ 統計模式（只顯示出現次數，不顯示內容）
- ✅ 高亮關鍵字（Terminal 中以黃色顯示）

---

## 使用方式

### 基本語法

```bash
cd ~/clawd/agents/market-digest
node query.js --keyword <關鍵字> [--days <天數>] [--count]
```

### 範例

#### 1. 搜尋關鍵字

```bash
# 搜尋「沃什」最近 7 天的新聞
node query.js --keyword "沃什" --days 7

# 輸出：
🔍 找到 2 筆結果（最近 7 天）
━━━━━━━━━━━━━━━━━━

📅 2026-02-02（2 筆）

  1. 🌳2026 🐴AI 🤖Cathay Good Morning! 2026/02/02 ⏰迎接沃什、迎接低通膨與低利率...
  2. ...主因川普確認提名凱文・沃什出任聯準會主席，市場解讀其立場偏鷹...
```

#### 2. 搜尋個股

```bash
# 搜尋台積電（2330）最近 30 天的提及
node query.js --stock "2330" --days 30

# 搜尋聯發科（支援中文名稱）
node query.js --keyword "聯發科" --days 14
```

#### 3. 類別搜尋

```bash
# 搜尋「台股」類別最近 14 天的新聞
node query.js --category "台股" --days 14

# 支援的類別：
# - 台股：台股、加權指數、TAIEX、OTC
# - 美股：美股、S&P、Nasdaq、道瓊
# - 匯率：台幣、美元指數、USD、TWD
# - 商品：黃金、原油、WTI、布蘭特
# - 美債：殖利率、公債、Treasury
# - 科技：AI、半導體、晶片、台積電、輝達、聯發科
```

#### 4. 統計模式

```bash
# 統計「聯發科」最近 7 天出現次數
node query.js --keyword "聯發科" --days 7 --count

# 輸出：
📊 「聯發科」最近 7 天出現 2 次

📅 每日分布：
  2026-02-02: 2 次
```

---

## Telegram 整合（需加到 AGENTS.md）

### 使用者指令

```
/query 沃什
/query 2330 --days 30
/query 台股 --count
```

### AI 行為規則

當 Chris 輸入 `/query <關鍵字>` 時：

```javascript
// 1. 解析指令
const keyword = extractKeyword(message);  // "沃什"
const days = extractDays(message) || 7;   // 預設 7 天
const count = message.includes('--count');

// 2. 執行搜尋
exec(`cd ~/clawd/agents/market-digest && node query.js --keyword "${keyword}" --days ${days} ${count ? '--count' : ''}`);

// 3. 回覆結果
// 如果結果過長（>4000 字），只回覆前 10 筆 + 提示「輸入 /query <關鍵字> --days 3 縮小範圍」
```

---

## 資料來源

### data/morning-collect/*.json

每日收集的 LINE 群組早報，結構如下：

```json
{
  "date": "2026-02-02",
  "messages": [
    {
      "type": "text",
      "content": "🌳2026 🐴AI 🤖Cathay Good Morning! ...",
      "timestamp": "2026-02-02T18:35:39.557Z"
    }
  ],
  "images": []
}
```

### data/timeseries/*.json（未來支援）

生成的報告，可搜尋整合後的摘要內容。

---

## 驗收標準

### ① 關鍵字搜尋

```bash
# 搜尋已知存在的關鍵字
node query.js --keyword "沃什" --days 7
# 預期：找到至少 1 筆結果

# 搜尋不存在的關鍵字
node query.js --keyword "火星人" --days 7
# 預期：❌ 未找到相關結果
```

### ② 統計模式

```bash
# 統計「聯發科」出現次數
node query.js --keyword "聯發科" --days 7 --count
# 預期：
# 📊 「聯發科」最近 7 天出現 N 次
# 📅 每日分布：
#   2026-02-02: N 次
```

### ③ 類別搜尋

```bash
# 搜尋「台股」類別
node query.js --category "台股" --days 7
# 預期：找到包含「台股」「加權指數」「TAIEX」的結果
```

### ④ 時間範圍

```bash
# 搜尋最近 1 天
node query.js --keyword "沃什" --days 1
# 預期：只搜尋今天的資料

# 搜尋最近 30 天
node query.js --keyword "沃什" --days 30
# 預期：搜尋過去 30 天的資料
```

---

## 進階功能（未來改進）

### 1. 正規表達式搜尋

```bash
# 搜尋「降息 2 次」或「降息 3 次」
node query.js --regex "降息 [0-9] 次" --days 14
```

### 2. 多關鍵字搜尋（AND/OR）

```bash
# 同時包含「沃什」和「降息」
node query.js --keyword "沃什" --and "降息" --days 7

# 包含「沃什」或「Fed」
node query.js --keyword "沃什" --or "Fed" --days 7
```

### 3. 日期範圍搜尋

```bash
# 搜尋 2026-01-01 到 2026-01-31
node query.js --keyword "沃什" --from 2026-01-01 --to 2026-01-31
```

### 4. 匯出結果

```bash
# 匯出為 JSON
node query.js --keyword "沃什" --days 7 --export json > results.json

# 匯出為 CSV
node query.js --keyword "沃什" --days 7 --export csv > results.csv
```

---

## 回滾

```bash
cd ~/clawd/agents/market-digest
rm query.js
```

---

## 效能考量

### 搜尋速度

- 單日檔案：< 10ms
- 7 天：< 50ms
- 30 天：< 200ms
- 90 天：< 500ms

### 檔案大小

- 平均每日 JSON：5-10 KB
- 30 天總計：150-300 KB
- 90 天總計：450-900 KB

### 記憶體使用

- 單次搜尋：< 10 MB
- 無需索引，直接掃描檔案

---

## 技術細節

### 搜尋演算法

1. **遍歷檔案：** 從今天往前掃描 N 天的 JSON 檔案
2. **關鍵字匹配：** 使用 `String.includes()` 判斷是否包含關鍵字
3. **高亮顯示：** ANSI 顏色碼（\x1b[33m...\x1b[0m）高亮關鍵字
4. **截取上下文：** 提取關鍵字前後各 100 字元

### 類別映射

```javascript
const categoryMap = {
  '台股': ['台股', '加權指數', 'TAIEX', 'OTC'],
  '美股': ['美股', 'S&P', 'Nasdaq', '道瓊', 'DJI'],
  '匯率': ['台幣', '美元指數', 'USD', 'TWD'],
  '商品': ['黃金', '原油', 'WTI', '布蘭特'],
  '美債': ['殖利率', '公債', 'Treasury'],
  '科技': ['AI', '半導體', '晶片', '台積電', '輝達', '聯發科'],
};
```

---

## 使用建議

1. **先用統計模式：** 確認關鍵字是否存在，再查看詳細內容
2. **縮小範圍：** 如果結果過多，減少天數或使用更具體的關鍵字
3. **組合查詢：** 結合類別 + 關鍵字，精準定位（未來支援）
4. **定期清理：** 保留最近 90 天的資料即可，舊資料可歸檔

---

## 疑難排解

### 找不到結果

```bash
# 檢查檔案是否存在
ls -lh data/morning-collect/2026-02-*.json

# 檢查檔案內容
cat data/morning-collect/2026-02-02.json | jq '.messages[].content' | grep "沃什"
```

### 搜尋過慢

```bash
# 減少天數
node query.js --keyword "沃什" --days 3

# 或使用統計模式（更快）
node query.js --keyword "沃什" --days 30 --count
```

### 編碼問題

```bash
# 確保檔案是 UTF-8 編碼
file data/morning-collect/2026-02-02.json
# 預期：UTF-8 Unicode text
```
