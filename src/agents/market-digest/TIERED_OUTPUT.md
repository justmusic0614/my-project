# 分級輸出功能

Market Digest 支援三種級別的報告輸出，適應不同使用情境。

## 三種級別

### 📱 Minimal（極簡版）- 預設
**用途：** 每日推播到 Telegram  
**長度：** 150-250 字  
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
🔍 市場處於觀望狀態，等待關鍵數據與政策訊號

🌐 焦點：
  • 沃什確認出任聯準會主席，降息預期維...
  • 記憶體族群軋空行情延續，南亞科領漲
  • 聯發科法說會今日登場，關注 AI 晶片...

💬 輸入 /today 查看完整版
━━━━━━━━━━━━━━━━━━
```

---

### 📄 Standard（標準版）
**用途：** 手動查詢（/today）  
**長度：** 600-1000 字  
**內容：**
- 完整市場數據（台股、美股、匯率、技術指標）
- 市場狀態
- 重點事件（前 8 條，完整標題）
- 補充訊號（前 3 條）
- 台灣焦點
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
• 台幣：31.58 (貶1.5%)

🔍 市場狀態

• 市場處於觀望狀態，等待關鍵數據與政策訊號

🌐 重點事件

• 沃什確認出任聯準會主席，市場解讀其立場偏鷹
• 記憶體族群軋空行情延續，南亞科、美光大漲
• 聯發科法說會今日登場，關注 AI 晶片展望
...
━━━━━━━━━━━━━━━━━━
⚠️ 免責聲明：本報告僅供資訊參考，不構成投資建議
💬 輸入 /today full 查看原始早報全文
```

---

### 📚 Full（完整版）
**用途：** 深度查閱（/today full）  
**長度：** 原始早報全文（3000+ 字）  
**內容：**
- 原始 LINE 群組早報內容（完整保留）
- 所有細節、分析、數據

**範例：**
```
📰 原始早報全文
📅 2026/02/03（週二） 上午08:30
━━━━━━━━━━━━━━━━━━

🌳2026 🐴AI 🤖Cathay Good Morning! 2026/02/02
⏰迎接沃什、迎接低通膨與低利率👏🎉📈

1、沃什非黑天鵝，縮表換降息空間、中期政策偏多
2、全球股市分化擴大、半導體與新興市場續扮主軸
...
（原始早報完整內容）
━━━━━━━━━━━━━━━━━━
⚠️ 免責聲明：本報告僅供資訊參考，不構成投資建議
```

---

## 使用方式

### 命令列

```bash
cd ~/clawd/agents/market-digest

# 生成極簡版（預設）
node smart-integrator.js integrate --level minimal

# 生成標準版
node smart-integrator.js integrate --level standard

# 生成完整版
node smart-integrator.js integrate --level full

# 推播（預設極簡版）
node smart-integrator.js push --level minimal
```

### Telegram 指令（需整合到 AGENTS.md）

- **自動推播（每天 08:30）：** 極簡版
- **/today：** 生成並推播標準版
- **/today full：** 生成並推播完整版

---

## Cron 設定

更新 cron 使用極簡版推播：

```bash
# 編輯 crontab
crontab -e

# 確保使用 --level minimal
30 0 * * * cd ~/clawd/agents/market-digest && node smart-integrator.js push --level minimal
```

---

## 驗收標準

### ① 生成測試

```bash
# 測試三種級別
node smart-integrator.js integrate --level minimal
node smart-integrator.js integrate --level standard
node smart-integrator.js integrate --level full

# 檢查長度
cat data/runtime/morning-report.txt | wc -c
# 預期：
# minimal: 150-300 字元
# standard: 600-1200 字元
# full: 3000+ 字元
```

### ② 內容驗證

```bash
# minimal 應包含
grep -q "💬 輸入 /today 查看完整版" data/runtime/morning-report.txt && echo "✅ 極簡版正確"

# standard 應包含
grep -q "💬 輸入 /today full" data/runtime/morning-report.txt && echo "✅ 標準版正確"

# full 應包含
grep -q "📰 原始早報全文" data/runtime/morning-report.txt && echo "✅ 完整版正確"
```

### ③ 推播測試

```bash
# 測試推播（實際推送到 Telegram）
node smart-integrator.js push --level minimal
# 預期：收到簡短的報告（約 200 字）
```

---

## 回滾

```bash
cd ~/clawd/agents/market-digest

# 恢復備份
cp smart-integrator.js.bak-YYYYMMDD-HHMMSS smart-integrator.js

# 或使用 git
git checkout smart-integrator.js
```

---

## 設計考量

1. **極簡版優先推播：** 避免 Telegram 訊息過長，影響閱讀體驗
2. **漸進式揭露：** 使用者可以按需查看更詳細的內容
3. **保留原始資料：** 完整版保留所有細節，供深度研究使用
4. **統一格式：** 三種級別都遵循相同的結構，只是詳細度不同

---

## 未來改進

- [ ] 個人化設定（使用者可選擇預設級別）
- [ ] 智慧推薦級別（根據當日新聞重要性自動選擇）
- [ ] PDF 輸出（完整版匯出為 PDF，方便存檔）
- [ ] 週報級別（週五推播週報時使用 standard 級別）
