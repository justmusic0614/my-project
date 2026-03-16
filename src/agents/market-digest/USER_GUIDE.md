# Market Digest 使用指南與技術規格

**完整版**  
**版本：** 1.0  
**最後更新：** 2026-02-03

---

## 📚 目錄

1. [系統概述](#系統概述)
2. [快速開始](#快速開始)
3. [完整功能](#完整功能)
4. [Telegram 指令](#telegram-指令)
5. [技術規格](#技術規格)
6. [資料結構](#資料結構)
7. [工作流程](#工作流程)
8. [自動化排程](#自動化排程)
9. [進階使用](#進階使用)
10. [疑難排解](#疑難排解)

---

## 系統概述

### 什麼是 Market Digest？

Market Digest 是自動化財經新聞整合系統，專為 Chris 設計的個人化財經資訊中樞。

### 核心功能（5 項）

1. **早報收集**：08:00-08:10 自動收集 LINE 群組早報
2. **智慧整合**：08:30 自動整合並推播極簡版報告
3. **歷史搜尋**：快速搜尋過去 N 天的早報內容
4. **個股追蹤**：Watchlist 追蹤關注個股，自動提取每日摘要
5. **提醒系統**：自動提取重要事件（法說會、經濟數據），前一日提醒

### 額外功能

- **週報匯總**：每週五自動生成本週財經回顧
- **分級輸出**：三種級別報告（Minimal/Standard/Full）

---

## 快速開始

### 日常使用（Telegram）

#### 早晨流程（08:00-08:30）

1. **08:00-08:10** 在 Telegram 貼 LINE 群組早報
   - Clawdbot 自動收集
   - 回覆：`✅ 已收集早報（第 N 則）`

2. **08:30** 自動收到極簡版報告
   ```
   🌅 02/03（週二） 上午08:30
   ━━━━━━━━━━━━━━━━━━
   📈 台股 ▼2.15% | 美股 ▲0.38%
   🔍 市場處於觀望狀態
   
   🌐 焦點：
     • 沃什確認出任聯準會主席...
     • 記憶體族群軋空行情延續...
   
   💬 輸入 /today 查看完整版
   ```

3. 如需詳細資訊，輸入 `/today`

#### 白天隨時查詢

```
/today              查看今日完整報告（標準版，800字）
/today full         查看原始早報全文（3000+字）
/query 台積電        搜尋「台積電」最近7天
/query 聯發科 --days 30  搜尋「聯發科」最近30天
/watchlist add 2330 新增追蹤個股
/watchlist list     查看追蹤清單
```

#### 晚上提醒（20:00）

如果明天有重要事件（法說會、經濟數據），自動收到提醒：

```
⏰ 明日提醒
📅 02/03（週二）
━━━━━━━━━━━━━━━━━━

🟡 重要事件

📊 聯發科法說會（AI 晶片展望關鍵）
  💼 相關個股：聯發科(2454)、欣興(3037)
```

#### 週五週報（20:00）

每週五自動收到本週財經回顧：

```
📅 本週財經回顧（02/02 - 02/08）
━━━━━━━━━━━━━━━━━━

🔥 本週重大事件
1️⃣ 聯準會主席沃什確認出任...
2️⃣ 台股元月漲 10.7%...

📈 本週漲幅亮點
1. 美光：+45.36%
2. 海力士：+34.3%

⭐ 我的關注股本週表現
📈 2454 聯發科：+8.5%
```

---

## 完整功能

### 1. 早報收集（Morning Collection）

#### 自動收集（AI 模式，推薦）

**時段：** 08:00-08:10 台北時間

**操作：** 直接在 Telegram 貼上 LINE 群組早報

**流程：**
1. Clawdbot 自動判斷是否為早報內容
2. 自動調用 `morning-collector.js add-text`
3. 回覆：`✅ 已收集早報（第 N 則）`

#### 手動收集（伺服器模式）

```bash
cd ~/clawd/agents/market-digest

# 新增文字訊息
node morning-collector.js add-text "早報內容..."

# 新增圖片訊息
node morning-collector.js add-image /path/to/image.jpg

# 查看收集狀態
node morning-collector.js status

# 查看已收集內容
node morning-collector.js show

# 清空今日收集
node morning-collector.js clear
```

#### 資料儲存

- **位置：** `data/morning-collect/YYYY-MM-DD.json`
- **格式：** JSON
- **內容：** 文字訊息 + 圖片路徑

**範例：**
```json
{
  "date": "2026-02-03",
  "messages": [
    {
      "type": "text",
      "content": "🌳2026 🐴AI 🤖Cathay Good Morning! ...",
      "timestamp": "2026-02-03T00:21:00.000Z"
    },
    {
      "type": "image",
      "path": "/path/to/image.jpg",
      "timestamp": "2026-02-03T00:25:00.000Z"
    }
  ]
}
```

---

### 2. 智慧整合與分級輸出（Tiered Output）

#### 三種輸出級別

| 級別 | 長度 | 用途 | 觸發方式 |
|------|------|------|---------|
| **Minimal** | 150-250 字 | 每日推播（08:30） | 自動 / `push --level minimal` |
| **Standard** | 600-1000 字 | 手動查詢 | `/today` |
| **Full** | 3000+ 字 | 深度查閱 | `/today full` |

#### Minimal（極簡版）

**內容：**
- 市場數據摘要（單行）
- 市場狀態（Regime）
- 焦點事件（前 3 條，縮短到 40 字）
- 提示「輸入 /today 查看完整版」

**範例：**
```
🌅 02/03（週二） 上午08:30
━━━━━━━━━━━━━━━━━━
📈 台股 ▼2.15% | 美股 ▲0.38%
🔍 市場處於觀望狀態

🌐 焦點：
  • 沃什確認出任聯準會主席...
  • 記憶體族群軋空行情延續...
  • 聯發科法說會今日登場...

💬 輸入 /today 查看完整版
```

#### Standard（標準版）

**內容：**
- 完整市場數據（台股、美股、匯率、技術指標）
- 市場狀態
- 重點事件（前 8 條，完整標題）
- 補充訊號（前 3 條）
- 台灣焦點
- 我的關注股（Watchlist，如有）
- 提示「輸入 /today full 查看原始早報全文」

**範例：**
```
🌅 每日財經匯總
📅 2026/02/03（週二） 上午08:30
━━━━━━━━━━━━━━━━━━

📈 市場概況

• 台股加權指數：31,624.029 ▼2.15%
  技術指標：MA5 32269.16 | MA20 31393.02 | RSI 60.04
• S&P 500：6,976.44 (+0.38%)
• Nasdaq：23,752.07 (+0.28%)
• 台幣：31.58 (貶1.5%)

🔍 市場狀態

• 市場處於觀望狀態，等待關鍵數據與政策訊號

🌐 重點事件

• 沃什確認出任聯準會主席，市場解讀其立場偏鷹
• 記憶體族群軋空行情延續，南亞科、美光大漲
• 聯發科法說會今日登場，關注 AI 晶片展望
...

📌 我的關注股（2 檔有消息）
━━━━━━━━━━━━━━━━━━

⭐ 2454 聯發科 (2 次提及)
  • 黃仁勳證實與聯發科合作開發新一代 N1 處理器

🔥 2408 南亞科 (3 次提及)
  • 列入台股強勢股，記憶體族群軋空行情延續

━━━━━━━━━━━━━━━━━━
⚠️ 免責聲明：本報告僅供資訊參考，不構成投資建議
💬 輸入 /today full 查看原始早報全文
```

#### Full（完整版）

**內容：**
- 原始 LINE 群組早報內容（完整保留）
- 所有細節、分析、數據

#### 伺服器指令

```bash
cd ~/clawd/agents/market-digest

# 生成極簡版
node smart-integrator.js integrate --level minimal

# 生成標準版
node smart-integrator.js integrate --level standard

# 生成完整版
node smart-integrator.js integrate --level full

# 推播（極簡版）
node smart-integrator.js push --level minimal
```

---

### 3. 快速檢索（Query Tool）

#### 功能

搜尋歷史早報內容，支援關鍵字、日期範圍、統計模式。

#### 使用方式

##### Telegram 指令

```
/query 沃什              搜尋「沃什」最近 7 天
/query 聯發科 --days 30   搜尋「聯發科」最近 30 天
/query 台股 --count      統計「台股」出現次數
```

##### 伺服器指令

```bash
cd ~/clawd/agents/market-digest

# 關鍵字搜尋（預設 7 天）
node query.js --keyword "沃什"

# 指定天數範圍
node query.js --keyword "聯發科" --days 30

# 統計模式（只顯示數量）
node query.js --keyword "台股" --count

# 個股搜尋
node query.js --stock "2330" --days 30
```

#### 搜尋範圍

- `data/morning-collect/*.json` - 早報原始資料
- `data/timeseries/reports/**/*.txt` - 生成的報告

#### 輸出範例

```
🔍 搜尋結果：沃什
📅 範圍：最近 7 天
━━━━━━━━━━━━━━━━━━

📅 2026-02-03
  • 沃什確認出任聯準會主席，市場解讀其立場偏鷹
  • 降息預期維持兩次，但市場擔心實際可能只有一次

📅 2026-02-02
  • 參議院確認沃什為下一任聯準會主席

━━━━━━━━━━━━━━━━━━
✅ 共找到 2 筆結果
```

---

### 4. 個股追蹤清單（Watchlist）

#### 功能

追蹤關注的個股，自動從早報中提取相關新聞並整合到報告中。

#### 使用方式

##### Telegram 指令

```
/watchlist add 2330 2454    新增股票到追蹤清單
/watchlist list             列出追蹤清單
/watchlist summary          今日摘要（從早報搜尋）
/watchlist history 2454     查詢個股歷史（最近 7 天）
/watchlist history 2454 --days 14  指定天數
/watchlist remove 2330      移除股票
```

##### 伺服器指令

```bash
cd ~/clawd/agents/market-digest

# 新增股票
node watchlist.js add 2330 2454 2408

# 列出追蹤清單
node watchlist.js list

# 今日摘要
node watchlist.js summary

# 查詢個股歷史
node watchlist.js history 2454 --days 14

# 移除股票
node watchlist.js remove 2330

# 清空追蹤清單
node watchlist.js clear
```

#### 整合到報告

在標準版（/today）報告中，自動加入「我的關注股」區塊：

```
📌 我的關注股（2 檔有消息）
━━━━━━━━━━━━━━━━━━

⭐ 2454 聯發科 (2 次提及)
  • 黃仁勳證實與聯發科合作開發新一代 N1 處理器

🔥 2408 南亞科 (3 次提及)
  • 列入台股強勢股，記憶體族群軋空行情延續
```

#### 支援股票（內建）

常見台股代碼與名稱對應：
- 2330 台積電
- 2454 聯發科
- 2317 鴻海
- 2408 南亞科
- 2412 中華電
- 2882 國泰金
- 3037 欣興
- 4958 神基
- 1590 亞德客
- 2233 宇瞻
...（約 20 檔內建）

#### 資料結構

**位置：** `data/watchlist.json`

**格式：**
```json
{
  "stocks": {
    "2330": {
      "name": "台積電",
      "addedAt": "2026-02-03T02:24:52.123Z"
    },
    "2454": {
      "name": "聯發科",
      "addedAt": "2026-02-03T02:24:52.123Z"
    }
  }
}
```

---

### 5. 關鍵數據提醒（Reminder System）

#### 功能

自動從早報中提取重要事件（法說會、經濟數據、除息日），並在前一天推播提醒。

#### 提醒類型

- **經濟數據**：非農就業、CPI、GDP 等
- **法說會**：上市公司法人說明會
- **除息日**：配息資訊
- **重要會議**：聯準會會議、央行決策

#### 工作流程

1. **提取提醒**（每日早報整合時自動執行）
   ```bash
   node reminder-extractor.js extract --date 2026-02-02
   ```
   - 自動識別日期格式（如「2/3 (週二)：聯發科法說會」）
   - 分類優先級（高/中/低）
   - 儲存到 `data/reminders/YYYY-MM-DD.json`

2. **檢查明日提醒**（每天 20:00 UTC 自動執行）
   ```bash
   node reminder-checker.js
   ```
   - 查找明天的提醒
   - 生成提醒通知（含影響說明、相關個股）
   - 推播到 Telegram

#### 提醒範例

```
⏰ 明日提醒
📅 02/03（週二）
━━━━━━━━━━━━━━━━━━

🔴 重要經濟數據

📢 美國非農就業數據前哨站
  💡 影響美股與台幣匯率，對台股影響較大

🟡 重要事件

📊 聯發科法說會（AI 晶片展望關鍵）
  💼 相關個股：聯發科(2454)、欣興(3037)

━━━━━━━━━━━━━━━━━━
💡 提醒：請提前規劃交易策略
```

#### 優先級分類

- 🔴 **高優先級**：重大經濟數據、央行決策
- 🟡 **中優先級**：法說會、財報、除息日
- 🟢 **低優先級**：一般事件

#### 資料結構

**位置：** `data/reminders/YYYY-MM-DD.json`

**格式：**
```json
{
  "date": "2026-02-03",
  "reminders": [
    {
      "text": "聯發科法說會",
      "priority": "medium",
      "category": "法說會",
      "relatedStocks": ["2454", "3037"],
      "impact": "AI 晶片展望關鍵",
      "source": "morning-report"
    }
  ]
}
```

#### 手動測試

```bash
cd ~/clawd/agents/market-digest

# 測試提醒檢查（不推播）
node reminder-checker.js --dry-run

# 實際推播
node reminder-checker.js
```

---

### 6. 週報自動匯總（Weekly Summary）

#### 功能

每週五自動生成本週財經回顧，彙整重大事件、漲幅亮點、關注股表現。

#### 週報內容

```
📅 本週財經回顧（02/02 - 02/08）
🗓️  2026 第 6 週
━━━━━━━━━━━━━━━━━━

🔥 本週重大事件

1️⃣ 聯準會主席沃什確認出任，降息預期維持兩次
   分類：貨幣政策

2️⃣ 台股元月漲 10.7%，創史上最強元月行情
   分類：市場動態

3️⃣ 記憶體族群軋空行情延續，南亞科領漲
   分類：產業趨勢

━━━━━━━━━━━━━━━━━━

📈 本週漲幅亮點

1. 美光：+45.36%
2. 海力士：+34.3%
3. ASML：+32.73%

━━━━━━━━━━━━━━━━━━

⭐ 我的關注股本週表現

📈 2454 聯發科：+8.5%（最佳）
📈 2408 南亞科：+6.2%
📉 2330 台積電：-0.8%

━━━━━━━━━━━━━━━━━━

📊 本週統計

• 早報收集天數：5 天
• 重大事件：15 則
• 高優先事件：5 則

━━━━━━━━━━━━━━━━━━
```

#### 使用方式

##### 自動執行（推薦）

- **每週五 20:00**（台北時間）自動生成並推播

##### 手動執行

```bash
cd ~/clawd/agents/market-digest

# 生成本週週報
node weekly-summary.js generate

# 生成指定週的週報
node weekly-summary.js generate --week 2026-W06

# 生成並推播
node weekly-summary.js push

# 查看生成的週報
cat data/runtime/weekly-summary.txt
```

#### 資料位置

- `data/runtime/weekly-summary.txt` - 最新週報
- `logs/weekly-summary.log` - 推播記錄

---

## Telegram 指令

### 查看報告

```
/today              查看今日完整報告（標準版，800字）
/today full         查看原始早報全文（3000+字）
```

### 搜尋歷史

```
/query <關鍵字>             搜尋最近 7 天
/query <關鍵字> --days <N>  搜尋最近 N 天
/query <關鍵字> --count     統計出現次數
```

**範例：**
```
/query 沃什
/query 聯發科 --days 30
/query 台股 --count
```

### Watchlist 管理

```
/watchlist add <股票代碼...>   新增股票到追蹤清單
/watchlist list               列出追蹤清單
/watchlist summary            今日摘要（從早報搜尋）
/watchlist history <股票代碼> 查詢個股歷史（最近 7 天）
/watchlist history <股票代碼> --days <N>  指定天數
/watchlist remove <股票代碼>  移除股票
```

**範例：**
```
/watchlist add 2330 2454
/watchlist list
/watchlist summary
/watchlist history 2454
/watchlist history 2454 --days 14
/watchlist remove 2330
```

---

## 技術規格

### 系統架構

```
market-digest/
├── morning-collector.js       # 早報收集器
├── smart-integrator.js        # 智慧整合器（分級輸出）
├── query.js                   # 快速檢索工具
├── watchlist.js               # 個股追蹤清單
├── reminder-extractor.js      # 提醒提取器
├── reminder-checker.js        # 提醒檢查器
├── weekly-summary.js          # 週報生成器
├── config.json                # 設定檔
├── package.json               # 依賴套件
├── backend/
│   ├── fetcher.js             # 市場數據抓取器
│   ├── sources/
│   │   └── plugins/
│   │       └── yahoo-finance/ # Yahoo Finance API plugin
│   └── runtime-input-gen.js   # 執行階段輸入生成器
├── data/
│   ├── morning-collect/       # 每日早報原始資料
│   │   └── YYYY-MM-DD.json
│   ├── reminders/             # 提醒資料
│   │   └── YYYY-MM-DD.json
│   ├── watchlist.json         # 追蹤清單
│   ├── runtime/
│   │   ├── morning-report.txt # 最新早報
│   │   └── weekly-summary.txt # 最新週報
│   └── timeseries/
│       └── reports/           # 時間序列報告
│           └── YYYY/MM/report-YYYY-MM-DD.txt
└── logs/
    ├── morning-report.log     # 早報推播記錄
    ├── reminder.log           # 提醒推播記錄
    └── weekly-summary.log     # 週報推播記錄
```

### 資料來源

#### 主要資料源：LINE 群組早報

- **來源：** 國泰證券早報（人工輸入）
- **時段：** 每日 08:00-08:10（台北時間）
- **收集工具：** `morning-collector.js`
- **存放位置：** `data/morning-collect/YYYY-MM-DD.json`
- **格式：** JSON（包含文字與圖片）

#### 市場數據：Yahoo Finance API

- **來源：** Yahoo Finance API
- **用途：** 即時市場數據
- **Plugin：** `backend/sources/plugins/yahoo-finance/`

**提供資料：**
- 台股加權指數（^TWII）
- S&P 500（^GSPC）
- Nasdaq（^IXIC）
- Dow Jones（^DJI）
- 台幣匯率（TWD=X）
- 技術指標：MA5、MA20、RSI

**更新頻率：** 每次報告生成時（約每日 08:30）

### Pipeline 配置

#### Taiwan Core 範圍（嚴格版）

**保留條件：**
- (台積電/聯電/鴻海) + (財報/投資/擴廠/產能/技術/供應鏈)
- 或 (央行/財政部/金管會) + 台灣政策

**排除：**
- 個股分析師建議
- 政治人物評論（非正式政策）
- 非 mega cap 個股

#### Clickbait 判斷

**策略：**
- 保留重要資訊，即使標題聳動
- 改寫標題為中性語氣
- 移除：驚嘆號、情緒動詞、clickbait 用詞

**改寫範例：**
- 「比特幣暴跌！」→「比特幣下跌」
- 「專家曝光藏寶圖」→ (移除 clickbait 詞)

#### Confidence Level

| Confidence | 新聞數量 | Risk Radar | 警示 |
|-----------|---------|-----------|------|
| HIGH | 12 則 | ✅ | 無 |
| MEDIUM | 12 則 | ✅ | 無（週末） |
| LOW | 3-5 則 | ❌ | ⚠️ Data limited |

#### 事件去重

每個事件只出現一次，不跨 section 重複。

#### 最大事件數

總計 ≤ 12 則新聞

---

## 資料結構

### 早報收集（morning-collect）

**檔案：** `data/morning-collect/YYYY-MM-DD.json`

```json
{
  "date": "2026-02-03",
  "messages": [
    {
      "type": "text",
      "content": "🌳2026 🐴AI 🤖Cathay Good Morning! ...",
      "timestamp": "2026-02-03T00:21:00.000Z"
    },
    {
      "type": "image",
      "path": "/path/to/image.jpg",
      "timestamp": "2026-02-03T00:25:00.000Z"
    }
  ]
}
```

### Watchlist

**檔案：** `data/watchlist.json`

```json
{
  "stocks": {
    "2330": {
      "name": "台積電",
      "addedAt": "2026-02-03T02:24:52.123Z"
    },
    "2454": {
      "name": "聯發科",
      "addedAt": "2026-02-03T02:24:52.123Z"
    }
  }
}
```

### 提醒資料（reminders）

**檔案：** `data/reminders/YYYY-MM-DD.json`

```json
{
  "date": "2026-02-03",
  "reminders": [
    {
      "text": "聯發科法說會",
      "priority": "medium",
      "category": "法說會",
      "relatedStocks": ["2454", "3037"],
      "impact": "AI 晶片展望關鍵",
      "source": "morning-report"
    }
  ]
}
```

### 時間序列報告

**檔案：** `data/timeseries/reports/YYYY/MM/report-YYYY-MM-DD.txt`

**格式：** 純文字（Markdown）

---

## 工作流程

### 早報整合流程

```
LINE 群組早報（08:00-08:10）
    ↓
morning-collector.js 收集
    ↓ 儲存到 data/morning-collect/
    ↓
smart-integrator.js 整合（08:30 自動執行）
    ↓
RuntimeInputGenerator
    ├─ 讀取 morning-collect/*.json（LINE 早報）
    ├─ 呼叫 Yahoo Finance API（市場數據）
    ├─ 計算技術指標（MA5/MA20/RSI）
    ├─ 套用 Research Signal Patch（事件分類）
    └─ 套用 Semantic Upgrade Patch（市場狀態）
    ↓
生成分級報告
    ├─ Minimal（150-250 字）→ 推播
    ├─ Standard（600-1000 字）→ /today
    └─ Full（3000+ 字）→ /today full
    ↓
儲存到 data/timeseries/reports/
```

### 查詢流程

```
/query 台積電 --days 7
  ↓
query.js
  ├─ 搜尋 data/morning-collect/*.json
  ├─ 搜尋 data/timeseries/reports/**/*.txt
  ├─ 過濾關鍵字
  ├─ 排序 & 格式化
  └─ 回傳結果（限制 4000 字元）
```

### Watchlist 流程

```
watchlist summary
  ↓
watchlist.js
  ├─ 讀取 data/watchlist.json
  ├─ 從當日早報提取個股資訊
  ├─ 格式化輸出（股票代碼 + 摘要）
  └─ 整合到報告
```

### 提醒流程

```
早報整合（08:30）
  ↓
reminder-extractor.js extract
  ├─ 自動識別日期格式
  ├─ 提取重要事件
  ├─ 分類優先級
  └─ 儲存到 data/reminders/*.json
  
每日 20:00
  ↓
reminder-checker.js
  ├─ 查找明天的提醒
  ├─ 生成提醒通知
  └─ 推播到 Telegram
```

### 週報流程

```
每週五 20:00
  ↓
weekly-summary.js
  ├─ 讀取本週早報（data/morning-collect/）
  ├─ 提取重大事件
  ├─ 計算漲幅亮點
  ├─ 查詢 Watchlist 表現
  ├─ 生成週報
  └─ 推播到 Telegram
```

---

## 自動化排程

### Cron Jobs

```bash
# 編輯 crontab
crontab -e

# 每天 08:30（台北時間 = UTC 00:30）推播早報（minimal）
30 0 * * * cd ~/clawd/agents/market-digest && node smart-integrator.js push --level minimal

# 每天 20:00（台北時間 = UTC 12:00）檢查明日提醒
0 12 * * * cd ~/clawd/agents/market-digest && node reminder-checker.js

# 每週五 20:00（台北時間 = UTC 12:00）推播週報
0 12 * * 5 cd ~/clawd/agents/market-digest && node weekly-summary.js push
```

### 時區轉換

**台北時間 = UTC + 8 小時**

| 台北時間 | UTC 時間 |
|---------|---------|
| 08:00 | 00:00 |
| 08:30 | 00:30 |
| 20:00 | 12:00 |

### 驗收 Cron

```bash
# 檢查 crontab
crontab -l | grep market-digest

# 預期輸出：看到上面三行

# 檢查執行記錄
tail -f ~/clawd/agents/market-digest/logs/morning-report.log
tail -f ~/clawd/agents/market-digest/logs/reminder.log
tail -f ~/clawd/agents/market-digest/logs/weekly-summary.log
```

---

## 進階使用

### 批次新增多檔股票

```bash
# Telegram
/watchlist add 2330 2454 2408 3037 4958 1590 2233

# 伺服器
node watchlist.js add 2330 2454 2408 3037 4958 1590 2233
```

### 查看某檔股票的長期趨勢

```bash
# 伺服器
node watchlist.js history 2454 --days 90

# 看到聯發科最近 90 天的所有提及
```

### 統計某個主題的熱度

```bash
# Telegram
/query 降息 --count

# 伺服器
node query.js --keyword "降息" --count

# 預期輸出：
# ✅ 找到 12 筆結果
```

### 手動生成週報（非週五）

```bash
cd ~/clawd/agents/market-digest

# 生成指定週的週報
node weekly-summary.js generate --week 2026-W05

# 查看生成的週報
cat data/runtime/weekly-summary.txt
```

### 測試提醒系統

```bash
cd ~/clawd/agents/market-digest

# 測試提醒檢查（不推播）
node reminder-checker.js --dry-run

# 預期輸出：如果明天有提醒，會顯示提醒內容
```

---

## 疑難排解

### 問題 1：早報未收集

**現象：** 貼早報後沒有收到「✅ 已收集早報」回覆

**檢查：**
```bash
cd ~/clawd/agents/market-digest
ls -lh data/morning-collect/$(date +%Y-%m-%d).json
```

**修復：**
```bash
# 手動執行收集
node morning-collector.js add-text "早報內容"

# 檢查 Telegram 連線
clawdbot message send --channel telegram --target REDACTED_CHAT_ID --message "測試"
```

---

### 問題 2：`/today` 沒有反應

**現象：** 輸入 `/today` 沒有收到報告

**檢查：**
```bash
cd ~/clawd/agents/market-digest
node smart-integrator.js integrate --level standard
```

**可能原因：**
- 當日沒有早報資料
- `data/morning-collect/YYYY-MM-DD.json` 不存在

**修復：**
```bash
# 確認有早報資料
ls -lh data/morning-collect/*.json

# 手動收集早報
node morning-collector.js add-text "早報內容"
```

---

### 問題 3：`/query` 找不到結果

**現象：** 搜尋關鍵字沒有結果

**檢查：**
```bash
# 確認有早報資料
ls -lh data/morning-collect/*.json

# 手動測試搜尋
cd ~/clawd/agents/market-digest
node query.js --keyword "測試關鍵字"
```

**可能原因：**
- 該關鍵字不存在於早報中
- 日期範圍內沒有早報資料

---

### 問題 4：Watchlist 沒有顯示在報告中

**現象：** `/today` 報告中沒有「我的關注股」區塊

**檢查：**
```bash
cd ~/clawd/agents/market-digest
node watchlist.js list
```

**可能原因：**
- Watchlist 是空的
- 當日早報中沒有提到追蹤的個股

**修復：**
```bash
# 新增股票到 watchlist
node watchlist.js add 2330 2454 2408

# 測試摘要
node watchlist.js summary
```

---

### 問題 5：Cron 沒有自動執行

**現象：** 08:30 沒有收到報告推播

**檢查：**
```bash
# 檢查 crontab
crontab -l | grep market-digest

# 檢查 cron service
systemctl status cron

# 檢查執行記錄
tail -f ~/clawd/agents/market-digest/logs/morning-report.log
```

**修復：**
```bash
# 重新設定 cron
crontab -e

# 確保有以下行：
# 30 0 * * * cd ~/clawd/agents/market-digest && node smart-integrator.js push --level minimal

# 手動測試推播
cd ~/clawd/agents/market-digest
node smart-integrator.js push --level minimal
```

---

### 問題 6：市場數據抓取失敗

**現象：** 報告中市場數據為空或顯示錯誤

**檢查：**
```bash
cd ~/clawd/agents/market-digest
node backend/sources/plugins/yahoo-finance/plugin.js
```

**可能原因：**
- Yahoo Finance API 暫時無法連線
- 網路問題

**修復：**
- 等待 API 恢復
- 檢查網路連線

---

### 問題 7：推播失敗

**現象：** 報告生成成功，但沒有推播到 Telegram

**檢查：**
```bash
# 檢查推播記錄
tail -f ~/clawd/agents/market-digest/logs/morning-report.log

# 測試 clawdbot message 指令
clawdbot message send --channel telegram --target REDACTED_CHAT_ID --message "測試"
```

**修復：**
```bash
# 檢查 openclaw-gateway 狀態
systemctl --user status openclaw-gateway

# 重啟 gateway
systemctl --user restart openclaw-gateway
```

---

## 附錄

### 依賴套件

**主要依賴（位於 `package.json`）：**
- `axios` - HTTP 請求
- `cheerio` - HTML 解析
- `rss-parser` - RSS 抓取（legacy）
- `levenshtein` - 新聞去重

### 相關文件

- `QUICKSTART.md` - 快速開始指南
- `FEATURES_SUMMARY.md` - 功能總覽
- `MORNING_INTEGRATION.md` - 早報整合說明
- `TIERED_OUTPUT.md` - 分級輸出說明
- `QUERY_TOOL.md` - 快速檢索說明
- `DATA_SOURCES.md` - 資料來源說明
- `PIPELINE.md` - Pipeline 配置

### 維護建議

#### 每日檢查

```bash
# 檢查早報收集狀態
cd ~/clawd/agents/market-digest
node morning-collector.js status

# 預期輸出：
# 📅 日期：2026-02-03
# 📝 文字訊息：1 則
# 🖼️ 圖片訊息：0 張
# ⏰ 收集時段：是
```

#### 每週檢查

```bash
# 健康度檢查
node sre/health-check.js

# Production Readiness
node sre/production-readiness-report.js

# 檢查 Yahoo Finance API
node backend/sources/plugins/yahoo-finance/plugin.js
```

#### 每月檢查

- 檢查 watchlist 表現
- 調整追蹤清單
- 清理舊日誌（保留 30 天）

---

**最後更新：** 2026-02-03  
**維護者：** Chris  
**系統版本：** Market Digest v1.0  
**文件位置：** `~/clawd/agents/market-digest/USER_GUIDE.md`
