# Market Digest 功能總覽

已完成的 5 項優化功能（2026-02-03）。

---

## ✅ 1. 分級輸出（Tiered Output）

### 功能
三種級別的報告輸出，適應不同使用情境。

### 級別

| 級別 | 長度 | 用途 | 觸發方式 |
|------|------|------|---------|
| **Minimal** | 150-250 字 | 每日推播（08:30） | 自動 / `node smart-integrator.js push --level minimal` |
| **Standard** | 600-1000 字 | 手動查詢 | `/today` |
| **Full** | 3000+ 字 | 深度查閱 | `/today full` |

### Telegram 指令
```
/today          → 標準版（800 字）
/today full     → 完整版（原始早報全文）
```

### 檔案
- `smart-integrator.js` - 分級生成邏輯
- `TIERED_OUTPUT.md` - 完整說明

---

## ✅ 2. 快速檢索（Query Tool）

### 功能
搜尋歷史早報內容，支援關鍵字、個股、類別查詢。

### 使用方式

```bash
# 關鍵字搜尋
node query.js --keyword "沃什" --days 7

# 個股搜尋
node query.js --stock "2330" --days 30

# 類別搜尋
node query.js --category "台股" --days 14

# 統計模式
node query.js --keyword "聯發科" --days 7 --count
```

### Telegram 指令
```
/query 沃什              → 搜尋「沃什」最近 7 天
/query 聯發科 --days 30   → 搜尋「聯發科」最近 30 天
/query 台股 --count      → 統計「台股」出現次數
```

### 檔案
- `query.js` - 搜尋工具
- `QUERY_TOOL.md` - 完整說明

---

## ✅ 3. 關鍵數據提醒前置（Reminder）

### 功能
從早報中自動提取重要事件，並在前一天推播提醒。

### 流程

1. **提取提醒**（從早報）
   ```bash
   node reminder-extractor.js extract --date 2026-02-02
   ```
   - 自動識別日期格式（如「2/3 (週二)：聯發科法說會」）
   - 分類優先級（高/中/低）
   - 儲存到 `data/reminders/*.json`

2. **檢查明日提醒**（每天 20:00 自動執行）
   ```bash
   node reminder-checker.js
   ```
   - 查找明天的提醒
   - 生成提醒通知（含影響說明、相關個股）
   - 推播到 Telegram

### 提醒範例

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

### Cron 設定
```bash
# 每天 20:00（台北時間）檢查明日提醒
0 12 * * * cd ~/clawd/agents/market-digest && node reminder-checker.js
```

### 檔案
- `reminder-extractor.js` - 提醒提取器
- `reminder-checker.js` - 提醒檢查器
- `data/reminders/*.json` - 提醒資料

---

## ✅ 4. 個股追蹤清單（Watchlist）

### 功能
追蹤關注的個股，自動從早報中提取相關新聞。

### 使用方式

```bash
# 新增股票到追蹤清單
node watchlist.js add 2330 2454 2408

# 列出追蹤清單
node watchlist.js list

# 生成今日摘要（從早報搜尋）
node watchlist.js summary

# 查詢個股歷史（最近 N 天）
node watchlist.js history 2454 --days 14

# 移除股票
node watchlist.js remove 2330

# 清空追蹤清單
node watchlist.js clear
```

### 整合到報告

在標準版報告中，自動加入「我的關注股」區塊：

```
📌 我的關注股（2 檔有消息）
━━━━━━━━━━━━━━━━━━

⭐ 2454 聯發科 (2 次提及)
  • 黃仁勳證實與聯發科合作開發新一代 N1 處理器

🔥 2408 南亞科 (3 次提及)
  • 列入台股強勢股，記憶體族群軋空行情延續
```

### 支援股票（內建）

常見台股：台積電(2330)、聯發科(2454)、鴻海(2317)、南亞科(2408)、中華電(2412)、國泰金(2882) 等 20 檔。

### 檔案
- `watchlist.js` - 追蹤清單管理
- `data/watchlist.json` - 追蹤清單資料

---

## ✅ 5. 週報自動匯總（Weekly Summary）

### 功能
每週五自動生成本週財經回顧，彙整重大事件、漲幅亮點、關注股表現。

### 使用方式

```bash
# 生成本週週報
node weekly-summary.js generate

# 生成指定週的週報
node weekly-summary.js generate --week 2026-W06

# 生成並推播
node weekly-summary.js push
```

### 週報內容

```
📅 本週財經回顧（02/02 - 02/08）
🗓️  2026 第 6 週
━━━━━━━━━━━━━━━━━━

🔥 本週重大事件

1️⃣ 聯準會主席沃什確認出任，降息預期維持兩次
   分類：貨幣政策

2️⃣ 台股元月漲 10.7%，創史上最強元月行情
   分類：市場動態

...

📈 本週漲幅亮點

1. 美光：+45.36%
2. 海力士：+34.3%
3. ASML：+32.73%
...

⭐ 我的關注股本週表現

📈 2454 聯發科：+8.5%（最佳）
📈 2408 南亞科：+6.2%
📉 2330 台積電：-0.8%

📊 本週統計

• 早報收集天數：5 天
• 重大事件：15 則
• 高優先事件：5 則

━━━━━━━━━━━━━━━━━━
```

### Cron 設定
```bash
# 每週五 20:00（台北時間）推播週報
0 12 * * 5 cd ~/clawd/agents/market-digest && node weekly-summary.js push
```

### 檔案
- `weekly-summary.js` - 週報生成器
- `data/runtime/weekly-summary.txt` - 最新週報
- `logs/weekly-summary.log` - 推播記錄

---

## 📊 功能對照表

| 功能 | 檔案 | 使用頻率 | 自動化 |
|------|------|---------|--------|
| 分級輸出 | `smart-integrator.js` | 每日 | ✅ 08:30 推播 minimal |
| 快速檢索 | `query.js` | 隨時 | ❌ 手動查詢 |
| 關鍵提醒 | `reminder-*.js` | 每日 | ✅ 20:00 檢查明日 |
| Watchlist | `watchlist.js` | 每日 | ✅ 整合到報告 |
| 週報匯總 | `weekly-summary.js` | 每週五 | ✅ 20:00 推播 |

---

## 🔧 Cron 設定總覽

```bash
crontab -e

# 每天 08:30（台北時間 = UTC 00:30）推播早報（minimal）
30 0 * * * cd ~/clawd/agents/market-digest && node smart-integrator.js push --level minimal

# 每天 20:00（台北時間 = UTC 12:00）檢查明日提醒
0 12 * * * cd ~/clawd/agents/market-digest && node reminder-checker.js

# 每週五 20:00（台北時間 = UTC 12:00）推播週報
0 12 * * 5 cd ~/clawd/agents/market-digest && node weekly-summary.js push
```

---

## 📱 Telegram 指令總覽

### 查看報告
```
/today          → 標準版（800 字）
/today full     → 完整版（原始早報全文）
```

### 搜尋歷史
```
/query <關鍵字>             → 搜尋最近 7 天
/query <關鍵字> --days <N>  → 搜尋最近 N 天
/query <關鍵字> --count     → 統計出現次數
```

### Watchlist（未來整合）
```
/watchlist add 2330 2454    → 新增股票
/watchlist list             → 列出追蹤清單
/watchlist summary          → 今日摘要
/watchlist history 2454     → 查詢個股歷史
```

---

## 🎯 使用建議

### 日常工作流

1. **早上 08:30** - 收到 minimal 版早報推播
   - 快速瀏覽市場狀態與焦點
   - 如需詳細資訊，輸入 `/today`

2. **白天** - 隨時查詢
   - 想起某個關鍵字 → `/query 沃什`
   - 想看完整早報 → `/today full`

3. **晚上 20:00** - 收到明日提醒（如有）
   - 提前規劃交易策略
   - 關注法說會、經濟數據

4. **週五 20:00** - 收到週報
   - 回顧本週重大事件
   - 檢視關注股表現

### 進階使用

- **建立 Watchlist** - 追蹤常關注的個股
- **定期查詢** - 用 `/query` 追蹤特定主題（如「Fed」「降息」）
- **回顧歷史** - 用 `node watchlist.js history 2454 --days 30` 深入研究

---

## 🚀 未來改進（可選）

1. **智慧提醒**
   - 自動識別法說會日期
   - 整合財報公告時間
   - 除息日提醒

2. **Watchlist 進階**
   - 設定價格提醒（跌破 / 突破某價位）
   - 技術指標提醒（RSI、MACD）
   - 新聞情緒分析

3. **週報優化**
   - AI 摘要（用 LLM 總結重點）
   - 圖表生成（市場走勢圖）
   - 下週展望（整合提醒功能）

4. **Telegram 指令整合**
   - `/watchlist` 系列指令
   - `/reminder list` 列出近期提醒
   - `/weekly` 隨時查看本週進度

---

## 📂 檔案結構

```
market-digest/
├── smart-integrator.js         # 分級輸出（主要）
├── query.js                    # 快速檢索
├── reminder-extractor.js       # 提醒提取器
├── reminder-checker.js         # 提醒檢查器
├── watchlist.js                # 個股追蹤清單
├── weekly-summary.js           # 週報生成器
├── data/
│   ├── morning-collect/        # 每日早報原始資料
│   ├── reminders/              # 提醒資料
│   ├── watchlist.json          # 追蹤清單
│   ├── runtime/
│   │   ├── morning-report.txt  # 最新早報
│   │   └── weekly-summary.txt  # 最新週報
│   └── timeseries/             # 時間序列報告
└── logs/
    ├── morning-report.log      # 早報推播記錄
    ├── reminder.log            # 提醒推播記錄
    └── weekly-summary.log      # 週報推播記錄
```

---

## ✅ 驗收總結

| 功能 | 狀態 | 測試結果 |
|------|------|---------|
| 1. 分級輸出 | ✅ 完成 | minimal/standard/full 三種級別正常 |
| 2. 快速檢索 | ✅ 完成 | 關鍵字/個股/類別搜尋正常 |
| 3. 關鍵提醒 | ✅ 完成 | 提取與推播功能正常 |
| 4. Watchlist | ✅ 完成 | 追蹤清單與摘要生成正常 |
| 5. 週報匯總 | ✅ 完成 | 重大事件/漲幅亮點提取正常 |

**總實作時間：** 約 6-7 小時（含測試與文件）

**立即可用：** 所有功能都已實作完成，可以直接使用。
