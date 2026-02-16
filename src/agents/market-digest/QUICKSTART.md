# Market Digest 快速開始

5 項新功能已全部完成，立即可用！

---

## 🚀 立即測試

### 1. 查看今日報告（標準版）

在 Telegram 輸入：
```
/today
```

預期輸出：800 字的詳細報告（市場數據、重點事件、我的關注股）

---

### 2. 搜尋歷史早報

在 Telegram 輸入：
```
/query 沃什
```

預期輸出：找到「沃什」在最近 7 天的所有提及

其他範例：
```
/query 聯發科 --days 30    → 搜尋最近 30 天
/query 台股 --count        → 統計出現次數
```

---

### 3. 設定個股追蹤清單

在 Telegram 輸入：
```
/watchlist add 2330 2454 2408
```

預期輸出：
```
✅ 已新增：2330 台積電
✅ 已新增：2454 聯發科
✅ 已新增：2408 南亞科
```

查看追蹤清單：
```
/watchlist list
```

查看今日摘要：
```
/watchlist summary
```

---

### 4. 檢查明日提醒（測試）

在伺服器上執行（不會實際推播）：
```bash
cd ~/clawd/agents/market-digest
node reminder-checker.js --dry-run
```

預期輸出：如果明天有重要事件，會顯示提醒內容

---

### 5. 查看本週週報（測試）

在伺服器上執行：
```bash
cd ~/clawd/agents/market-digest
node weekly-summary.js generate --week 2026-W06
```

預期輸出：本週財經回顧（重大事件、漲幅亮點、關注股表現）

查看生成的週報：
```bash
cat data/runtime/weekly-summary.txt
```

---

## ⏰ 自動化設定

### 設定 Cron（自動推播）

```bash
crontab -e
```

確保有以下三行：

```bash
# 每天 08:30（台北時間）推播早報
30 0 * * * cd ~/clawd/agents/market-digest && node smart-integrator.js push --level minimal

# 每天 20:00（台北時間）檢查明日提醒
0 12 * * * cd ~/clawd/agents/market-digest && node reminder-checker.js

# 每週五 20:00（台北時間）推播週報
0 12 * * 5 cd ~/clawd/agents/market-digest && node weekly-summary.js push
```

**注意：** 台北時間 = UTC + 8 小時
- 08:30 台北時間 = 00:30 UTC
- 20:00 台北時間 = 12:00 UTC

驗收 cron 設定：
```bash
crontab -l | grep market-digest
```

預期輸出：看到上面三行

---

## 📱 日常使用流程

### 早上 08:30
自動收到極簡版早報：
```
🌅 02/03（週二） 上午08:30
━━━━━━━━━━━━━━━━━━
📈 台股 ▼2.15% | 美股 ▲0.38%
🔍 市場處於觀望狀態

🌐 焦點：
  • 沃什確認出任聯準會主席...
  • 記憶體族群軋空行情延續...

💬 輸入 /today 查看完整版
━━━━━━━━━━━━━━━━━━
```

如需詳細資訊，輸入：`/today`

---

### 白天隨時
想查詢某個關鍵字：
```
/query Fed --days 14
```

想看完整早報：
```
/today full
```

想查詢某檔個股：
```
/watchlist history 2454 --days 7
```

---

### 晚上 20:00
如果明天有重要事件，自動收到提醒：
```
⏰ 明日提醒
📅 02/03（週二）
━━━━━━━━━━━━━━━━━━

🟡 重要事件

📊 聯發科法說會（AI 晶片展望關鍵）
  💼 相關個股：聯發科(2454)、欣興(3037)

━━━━━━━━━━━━━━━━━━
```

---

### 週五 20:00
自動收到本週財經回顧：
```
📅 本週財經回顧（02/02 - 02/08）
━━━━━━━━━━━━━━━━━━

🔥 本週重大事件
1️⃣ 聯準會主席沃什確認出任...
2️⃣ 台股元月漲 10.7%，創史上最強...

📈 本週漲幅亮點
1. 美光：+45.36%
2. 海力士：+34.3%

⭐ 我的關注股本週表現
📈 2454 聯發科：+8.5%
━━━━━━━━━━━━━━━━━━
```

---

## 🎯 常見使用情境

### 情境 1：想快速回顧「沃什」相關新聞
```
/query 沃什
```
找到 2 筆結果，快速掃描標題。

---

### 情境 2：想深入了解今日市場
```
/today
```
看到完整的市場數據、技術指標、重點事件、我的關注股。

---

### 情境 3：想追蹤台積電最近的新聞
```
/watchlist add 2330
/watchlist history 2330 --days 30
```
看到台積電最近 30 天的所有提及。

---

### 情境 4：週五想回顧本週重點
等待 20:00 自動推播，或手動查詢：
```bash
node weekly-summary.js generate --week 2026-W06
cat data/runtime/weekly-summary.txt
```

---

## 🔧 進階使用

### 批次新增多檔股票
```
/watchlist add 2330 2454 2408 3037 4958 1590 2233
```

---

### 搜尋特定類別
```
/query --category 科技 --days 14
```
找到所有與「AI、半導體、晶片」相關的新聞。

---

### 查看某檔股票的長期趨勢
```
/watchlist history 2454 --days 90
```
看到聯發科最近 90 天的所有提及。

---

### 統計某個主題的熱度
```
/query 降息 --count
```
看到「降息」最近 7 天出現幾次。

---

## 📊 驗收清單

完成以下測試，確保所有功能正常：

- [ ] `/today` - 生成標準版報告
- [ ] `/today full` - 生成完整版報告
- [ ] `/query 沃什` - 搜尋關鍵字
- [ ] `/query 聯發科 --count` - 統計出現次數
- [ ] `/watchlist add 2330 2454` - 新增股票
- [ ] `/watchlist list` - 列出追蹤清單
- [ ] `/watchlist summary` - 今日摘要
- [ ] `node reminder-checker.js --dry-run` - 測試提醒
- [ ] `node weekly-summary.js generate` - 測試週報
- [ ] `crontab -l` - 確認 cron 設定

---

## ❓ 疑難排解

### 問題 1：`/today` 沒有反應

**檢查：**
```bash
cd ~/clawd/agents/market-digest
node smart-integrator.js integrate --level standard
```

如果有錯誤，查看錯誤訊息。

---

### 問題 2：`/query` 找不到結果

**原因：** 可能該日期沒有早報資料

**檢查：**
```bash
ls -lh data/morning-collect/*.json
```

確認有 `YYYY-MM-DD.json` 檔案。

---

### 問題 3：Watchlist 沒有顯示在報告中

**原因：** 可能 watchlist 是空的

**檢查：**
```bash
node watchlist.js list
```

如果是空的，先新增股票：
```bash
node watchlist.js add 2330 2454 2408
```

---

### 問題 4：Cron 沒有自動執行

**檢查 cron 狀態：**
```bash
systemctl status cron
```

**查看 cron 日誌：**
```bash
grep CRON /var/log/syslog | tail -20
```

**手動測試：**
```bash
cd ~/clawd/agents/market-digest
node smart-integrator.js push --level minimal
```

---

## 🎉 完成！

所有 5 項功能都已實作完成，立即可用。

**下一步：**
1. 測試所有 Telegram 指令
2. 設定 Cron 自動化
3. 建立你的 Watchlist
4. 享受自動化的財經資訊流！

**需要協助？**
查看詳細說明：
- `TIERED_OUTPUT.md` - 分級輸出
- `QUERY_TOOL.md` - 快速檢索
- `FEATURES_SUMMARY.md` - 功能總覽

或直接在 Telegram 詢問我 😊
