# Morning Integration - LINE 群組早報整合

整合 LINE 群組早報到 Market Digest，每天 08:30 自動推播。

## 功能

- **收集時段**：08:00-08:10（台北時間）
- **推播時間**：08:30（台北時間）
- **整合方式**：方案 B（智慧整合）

## 報告結構（方案 B：智慧整合）

```
🌅 每日財經匯總
📅 2026/01/30 (週四) 08:30
━━━━━━━━━━━━━━━━━━

📈 市場概況
• 台股加權指數：32,536 ▼267 (-0.82%)
  技術指標：MA5 32357 | MA20 31317 | RSI 67.5
• S&P 500：6,969
• Nasdaq：23,685
• 台幣：31.327
• 美元指數：96.17
• 黃金：$5,399/oz
• 原油：$65.43/barrel
• VIX 恐慌指數：16.88

🌐 重點新聞
• Fed 維持利率 3.5%-3.75% 不變
• 微軟財報後暴跌 10%
• Meta 財報亮眼，股價大漲 10.4%
• 金管會：台股不再是淺碟市場
• 台積電 ADR 跌 0.8%

🇹🇼 台灣焦點
• （Market Digest 自動摘要的台股重點）

📊 補充資訊
• （Market Digest 自動抓取，LINE 早報沒提到的新聞）

━━━━━━━━━━━━━━━━━━
⚠️ 免責聲明：本報告僅供資訊參考，不構成投資建議
📡 數據來源：LINE 群組 + TWSE + Yahoo Finance + Bloomberg
```

**智慧整合流程：**
1. 提取 LINE 早報的市場數據 + 新聞標題
2. 與 Market Digest 去重、合併
3. 統一格式、精簡呈現

## 使用方式

### 方式一：AI 自動收集（推薦）

**在 08:00-08:10 之間：**
1. 你直接在 Telegram 貼上 LINE 群組早報
2. 我會自動調用 `morning-collector.js add-text` 收集
3. 貼圖片時，我會調用 `morning-collector.js add-image` 收集

**08:30 自動執行：**
- Cron job 自動整合並推播

### 方式二：手動模式

**收集階段（08:00-08:10）：**
```bash
# 新增文字訊息
cd ~/clawd/agents/market-digest
node morning-collector.js add-text "早報內容..."

# 新增圖片訊息
node morning-collector.js add-image /path/to/image.jpg

# 查看狀態
node morning-collector.js status
```

**整合推播（08:30）：**
```bash
# 生成報告（不推播）- 方案 B（智慧整合）
node smart-integrator.js integrate

# 生成並推播
node smart-integrator.js push
```

## 安裝 Cron

```bash
cd ~/clawd/agents/market-digest
bash setup-morning-cron.sh
```

這會設定：
- **每天 08:30** (UTC 00:30) 自動整合並推播

## 測試

### 測試收集功能

```bash
# 新增測試文字
node morning-collector.js add-text "測試早報內容"

# 新增測試圖片（用實際路徑）
node morning-collector.js add-image /path/to/test.jpg

# 查看收集狀態
node morning-collector.js status
node morning-collector.js show
```

### 測試整合功能

```bash
# 生成報告（儲存到 data/runtime/morning-report.txt）
node smart-integrator.js integrate

# 查看報告
cat data/runtime/morning-report.txt

# 測試推播（實際推送）
node smart-integrator.js push
```

### 清空今日收集

```bash
node morning-collector.js clear
```

## 檔案結構

```
market-digest/
├── morning-collector.js       # 收集器（儲存訊息）
├── smart-integrator.js        # 智慧整合器（方案 B）
├── morning-integrator.js      # 原樣保留整合器（方案 A，已棄用）
├── setup-morning-cron.sh      # Cron 安裝腳本
├── MORNING_INTEGRATION.md     # 說明文件
├── data/
│   ├── morning-collect/
│   │   └── YYYY-MM-DD.json    # 每日收集的訊息
│   └── runtime/
│       └── morning-report.txt # 最新生成的報告
└── logs/
    └── morning-report.log     # 推播記錄
```

## AI 行為規則（整合到 AGENTS.md）

**當 Chris 在 08:00-08:10 發送訊息時：**

1. **判斷是否為早報內容**
   - 包含財經關鍵字（台股、美股、Fed、黃金、油價等）
   - 或明確提到「早報」「晨訊」

2. **自動收集**
   ```javascript
   // 文字訊息
   exec('node ~/clawd/agents/market-digest/morning-collector.js add-text "內容"');
   
   // 圖片訊息
   exec('node ~/clawd/agents/market-digest/morning-collector.js add-image /path/to/image.jpg');
   ```

3. **確認回覆**
   ```
   ✅ 已收集早報（第 N 則）
   ```

## 圖片處理（TODO）

目前圖片處理為佔位符，需要整合：
1. Clawdbot 的 `image` tool
2. 或使用 OCR（tesseract）提取文字
3. 或使用 vision API 提取標題和摘要

## 疑難排解

### Cron 未執行

```bash
# 檢查 crontab
crontab -l | grep morning-integrator

# 檢查執行記錄
tail -f ~/clawd/agents/market-digest/logs/morning-report.log
```

### 報告生成失敗

```bash
# 手動執行檢查錯誤
cd ~/clawd/agents/market-digest
node morning-integrator.js integrate
```

### 推播失敗

```bash
# 檢查 clawdbot message 指令
clawdbot message send --channel telegram --target REDACTED_CHAT_ID --message "測試"
```

## 未來改進

- [ ] 整合 vision API 自動提取圖片內容
- [ ] 新聞去重（LINE 早報 vs Market Digest）
- [ ] 智慧識別早報內容（不需手動判斷）
- [ ] 支援多種早報格式（自動適配）
