# Market Digest 功能總覽

**版本：** Phase 2 Complete  
**更新日期：** 2026-02-04  
**完成度：** 100%（6/6 核心項目）

━━━━━━━━━━━━━━━━━━

## 📊 核心功能

### 1. 財報數據整合（E2）
**完成時間：** 2026-02-04 07:34 UTC

#### 功能
- 股票基本資料（產業分類）
- 月營收數據（當月、累計、年增率）
- 季度財報（EPS、淨利率）

#### 資料來源
- 台灣證券交易所 OpenAPI
- `BWIBBU_ALL` - 月營收
- `t187ap03_L` - 股票基本資料

#### 使用方式
整合在 `/financial` 指令中

#### 檔案
- `financial-data-fetcher.js`
- `E2_IMPLEMENTATION_REPORT.md`

---

### 2. 籌碼面數據整合（E3）
**完成時間：** 2026-02-04 08:07 UTC

#### Phase 1：基礎交易資料
- 收盤價、成交量、成交值
- 開盤/最高/最低價
- 成交筆數

#### Phase 2：融資融券
- 融資/融券餘額（前日/今日）
- 融資使用率計算
- 變化量標示
- 資券互抵

#### Phase 3：三大法人買賣超
- 外資買賣超
- 投信買賣超
- 自營商買賣超
- 三大法人合計

#### 資料來源
- `STOCK_DAY_ALL` - 每日交易
- `MI_MARGN` - 融資融券
- `T86` - 三大法人

#### 使用方式
整合在 `/financial`、`/analyze`、`/weekly` 指令中

#### 檔案
- `chip-data-fetcher.js`
- `E3_PHASE3_COMPLETE.md`

---

### 3. 智慧分析系統（F）
**完成時間：** 2026-02-04 08:13 UTC

#### 功能

**綜合評分系統（0-100）：**
- 基準分 50（中性）
- 融資使用率加減分
- 三大法人情緒加減分
- ≥65：🟢 偏多 | 35-64：➖ 中性 | ≤34：🔴 偏空

**融資使用率分析：**
- < 5%：✅ 健康
- 5-15%：⚠️ 正常
- 15-30%：🟡 偏高
- \> 30%：🔴 危險

**三大法人情緒分析：**
- 合計 > 3000 張：🟢 看多
- 合計 < -3000 張：🔴 看空
- 其他：➖ 觀望

**異常提醒：**
- 融資單日大增/減（> 5%）
- 外資強勢買賣超（> 5000 張）
- 投信大幅買賣超（> 1000 張）
- 融券大幅回補（> 10%）

#### 使用方式
- `/financial` - 整合在日報中
- `/analyze 2330` - 單檔深度分析

#### 檔案
- `chip-analyzer.js`
- `F_ANALYSIS_COMPLETE.md`

---

### 4. 週報統計（C）
**完成時間：** 2026-02-04 08:53 UTC

#### 功能

**週度法人統計：**
- 累計買賣超（外資/投信/自營商）
- 日均買賣超
- 連續買超/賣超天數

**整體概況：**
- 平均評分
- 籌碼分布統計（🟢偏多/🔴偏空/➖中性）

**重點提醒：**
- 連續買超/賣超（≥ 3 日）
- 週度大幅買賣超（> 10000 張）

**個股排名：**
- 依籌碼評分排序
- 週度法人動向
- 異常提醒整合

#### 使用方式
```
/weekly          # 近 5 個交易日
/weekly 7        # 近 7 個交易日
/weekly 10       # 近 10 個交易日
```

#### 檔案
- `weekly-reporter.js`
- `C_WEEKLY_COMPLETE.md`

---

### 5. Telegram 指令整合（D）
**完成時間：** 2026-02-04 09:14 UTC

#### 功能

**統一指令入口：**
- `telegram-wrapper.sh` - 包裝腳本
- 過濾 debug 訊息
- 優化輸出格式

**整合指令：**
- `/watchlist list/add/remove` - 清單管理
- `/financial` - 完整日報
- `/weekly [days]` - 週報
- `/analyze <代號>` - 單檔分析
- `/query <關鍵字>` - 搜尋早報

**AGENTS.md 整合：**
- 清晰的指令定義
- Clawdbot 自動處理
- 使用說明與範例

#### 使用方式
直接在 Telegram 輸入指令

#### 檔案
- `telegram-wrapper.sh`
- `D_TELEGRAM_COMPLETE.md`
- 更新 `~/clawd/AGENTS.md`

---

### 6. 智慧提醒系統（A）
**完成時間：** 2026-02-04 09:21 UTC

#### 功能

**異常檢測規則（8 種）：**

**🔴 高優先級：**
1. 融資使用率 > 30%（投機氣氛濃厚）
2. 外資買賣超 > 10000 張（機構大動作）
3. 籌碼評分 < 30（極度不健康）

**🟡 中優先級：**
4. 融資使用率 > 20%（偏高）
5. 融資單日大增 > 10%（投機買盤）
6. 投信買超 > 2000 張（中型機構看好）
7. 融券回補 > 15%（空頭回補，利多）

**冷卻機制：**
- 24 小時內同股票同類型不重複通知
- 避免過度干擾
- 提醒歷史記錄保留 30 天

**自動推播：**
- 每日 16:00 Taipei (08:00 UTC)
- 檢測 Watchlist 異常
- 發現高優先級異常時推播

#### 使用方式
```
/alerts          # 手動檢查異常
```

自動推播：每日 16:00 自動執行

#### 檔案
- `alert-monitor.js`
- `alert-push.sh`
- `A_ALERT_COMPLETE.md`

━━━━━━━━━━━━━━━━━━

## 📋 指令總覽

### Watchlist 管理
```
/watchlist list              # 列出追蹤清單
/watchlist add 2330 2454     # 新增股票
/watchlist remove 2330       # 移除股票
```

### 報告查詢
```
/financial                   # 日報（財報+籌碼+分析）
/weekly                      # 週報（近 5 日）
/weekly 7                    # 週報（近 7 日）
/analyze 2330                # 單檔深度分析
```

### 智慧提醒
```
/alerts                      # 檢查異常提醒
```

### 早報搜尋
```
/query 聯發科                # 搜尋早報（近 7 天）
/query 台積電 --days 30      # 搜尋早報（近 30 天）
```

━━━━━━━━━━━━━━━━━━

## 🤖 自動化任務

### 已設定自動任務

**每日 08:00-08:10 Taipei：**
- 自動收集早報（文字與圖片）
- Clawdbot 自動處理

**每日 08:30 Taipei：**
- 生成早報整合報告
- 自動推播（minimal level）

**每日 16:00 Taipei (08:00 UTC)：**
- 自動異常檢測
- 發現高優先級異常時推播
- 使用 `alert-push.sh`

### 建議新增定時任務

**每日 09:00 Taipei：**
```bash
cd ~/clawd/agents/market-digest && bash telegram-wrapper.sh financial
```
自動推播完整日報

**每週日 20:00 Taipei：**
```bash
cd ~/clawd/agents/market-digest && bash telegram-wrapper.sh weekly
```
自動推播週報

**設定方式：**
透過 Clawdbot cron 功能（需手動配置）

━━━━━━━━━━━━━━━━━━

## 📊 資料來源

### 台灣證券交易所 OpenAPI

**已整合 API：**
1. `STOCK_DAY_ALL` - 每日交易資料
2. `MI_MARGN` - 融資融券資料
3. `T86` - 三大法人買賣超
4. `BWIBBU_ALL` - 月營收資料
5. `t187ap03_L` - 股票基本資料

**更新頻率：**
- 交易日當天更新
- 通常 15:00-16:00 提供

**快取機制：**
- TTL: 1 小時
- 自動更新
- 減少 API 請求

━━━━━━━━━━━━━━━━━━

## 📁 檔案結構

```
agents/market-digest/
├── README.md                      # 專案說明
├── USER_MANUAL.md                 # 使用手冊
├── FEATURES_SUMMARY.md            # 功能總覽（本檔案）
├── DEPLOYMENT_COMPLETE.md         # 部署完成報告
│
├── chip-data-fetcher.js           # 籌碼面數據（E3）
├── financial-data-fetcher.js      # 財報數據（E2）
├── chip-analyzer.js               # 智慧分析（F）
├── weekly-reporter.js             # 週報生成（C）
├── alert-monitor.js               # 異常監控（A）
├── watchlist.js                   # Watchlist 管理
├── telegram-wrapper.sh            # Telegram 包裝（D）
├── alert-push.sh                  # 異常推播（A）
│
├── morning-collector.js           # 早報收集（Phase 1）
├── integrate-daily-brief.js       # 早報整合（Phase 1）
├── query.js                       # 早報搜尋（Phase 1）
│
├── E2_IMPLEMENTATION_REPORT.md    # E2 實作報告
├── E3_PHASE3_COMPLETE.md          # E3 完成報告
├── F_ANALYSIS_COMPLETE.md         # F 完成報告
├── C_WEEKLY_COMPLETE.md           # C 完成報告
├── D_TELEGRAM_COMPLETE.md         # D 完成報告
├── A_ALERT_COMPLETE.md            # A 完成報告
│
└── data/
    ├── watchlist.json             # 追蹤清單
    ├── alert-history.json         # 提醒歷史
    ├── chip-cache/                # 籌碼面快取
    ├── financial-cache/           # 財報快取
    ├── morning-collect/           # 早報收集
    └── runtime/
        └── morning-report.txt     # 早報整合輸出
```

━━━━━━━━━━━━━━━━━━

## ✅ 完成項目清單

### Phase 1（已完成）
- ✅ 早報收集自動化
- ✅ 早報整合與摘要
- ✅ 分級輸出（Minimal/Standard/Full）
- ✅ Telegram 推播
- ✅ 早報搜尋功能

### Phase 2（已完成）
- ✅ E2：財報數據整合
- ✅ E3：籌碼面數據整合
- ✅ F：智慧分析系統
- ✅ C：週報統計
- ✅ D：Telegram 指令整合
- ✅ A：智慧提醒系統

### 待補充（選項）
- ⏳ B：Watchlist 進階（標籤分類、自訂排序）
- ⏳ 價格走勢圖表
- ⏳ 技術指標整合
- ⏳ 自動選股功能

━━━━━━━━━━━━━━━━━━

## 📊 完成度統計

### Phase 1
**完成度：** 100%（5/5）
- 早報收集 ✅
- 早報整合 ✅
- 分級輸出 ✅
- Telegram 推播 ✅
- 早報搜尋 ✅

### Phase 2
**完成度：** 100%（6/6 核心項目）
- E2：財報數據 ✅
- E3：籌碼面數據 ✅
- F：智慧分析 ✅
- C：週報統計 ✅
- D：Telegram 整合 ✅
- A：智慧提醒 ✅

### 總體完成度
**核心功能：** 100%（11/11）  
**進階功能：** 0%（0/3，選項）

━━━━━━━━━━━━━━━━━━

## 🎯 使用情境

### 情境 1：每日追蹤
**時間：** 早上 09:00

**流程：**
1. 查看日報：`/financial`
2. 檢查異常：`/alerts`
3. 單檔分析：`/analyze 2330`（選擇性）

**輸出：**
- 籌碼概況統計
- 重點提醒
- 個股詳細報告（評分、融資、法人、營收）

---

### 情境 2：週末回顧
**時間：** 週日晚上

**流程：**
1. 查看週報：`/weekly`
2. 關注連續買超/賣超
3. 調整追蹤清單

**輸出：**
- 整體概況
- 週度法人動向
- 連續買超/賣超提醒
- 個股週報

---

### 情境 3：研究單檔
**時間：** 隨時

**流程：**
1. 深度分析：`/analyze 2454`
2. 搜尋早報：`/query 聯發科 --days 30`
3. 查看歷史：`/watchlist history 2454 --days 14`

**輸出：**
- 籌碼綜合評分
- 異常提醒
- 融資與法人分析
- 早報相關內容
- 歷史提及次數

---

### 情境 4：異常監控
**時間：** 每日 16:00（自動）

**流程：**
1. 系統自動檢測
2. 發現異常時推播
3. Chris 查看通知

**輸出：**
- 高優先級異常（融資危險、外資大動作、評分極低）
- 中優先級異常（融資偏高、投機買盤、融券回補）

━━━━━━━━━━━━━━━━━━

## 💡 使用技巧

### 技巧 1：日報與週報搭配
- 平日看日報（`/financial`）掌握當日狀況
- 週末看週報（`/weekly`）回顧趨勢

### 技巧 2：評分與異常並重
- 評分看整體健康度
- 異常看短期風險與機會

### 技巧 3：法人動向追蹤
- 連續買超 ≥ 3 日：法人持續看好
- 週度大幅買超 > 10000 張：重大動向

### 技巧 4：融資使用率警示
- < 5%：籌碼健康，可關注
- 20-30%：偏高，控制倉位
- \> 30%：危險，避免追高

### 技巧 5：定期清理 Watchlist
- 定期檢視追蹤清單
- 移除不再關注的股票
- 保持清單精簡（建議 3-10 檔）

━━━━━━━━━━━━━━━━━━

## 🔧 進階使用

### CLI 直接使用

**日報：**
```bash
cd ~/clawd/agents/market-digest
node watchlist.js financial
```

**週報：**
```bash
node watchlist.js weekly --days 7
```

**單檔分析：**
```bash
node chip-analyzer.js analyze 2330
```

**異常監控：**
```bash
node alert-monitor.js monitor
```

**清除快取：**
```bash
node chip-data-fetcher.js clear-cache
```

---

### 查看提醒歷史

```bash
node alert-monitor.js history 7   # 最近 7 天
node alert-monitor.js history 30  # 最近 30 天
```

---

### 手動推播測試

```bash
cd ~/clawd/agents/market-digest
bash alert-push.sh
```

━━━━━━━━━━━━━━━━━━

## 📚 相關文件

### 使用文件
- **USER_MANUAL.md** - 完整使用手冊
- **FEATURES_SUMMARY.md** - 功能總覽（本檔案）
- **DEPLOYMENT_COMPLETE.md** - 部署完成報告

### 技術文件
- **E2_IMPLEMENTATION_REPORT.md** - 財報數據實作
- **E3_PHASE3_COMPLETE.md** - 籌碼面數據實作
- **F_ANALYSIS_COMPLETE.md** - 智慧分析實作
- **C_WEEKLY_COMPLETE.md** - 週報功能實作
- **D_TELEGRAM_COMPLETE.md** - Telegram 整合
- **A_ALERT_COMPLETE.md** - 智慧提醒實作

### 系統整合
- **~/clawd/AGENTS.md** - Clawdbot 指令規則

━━━━━━━━━━━━━━━━━━

## 🎉 總結

Market Digest Phase 2 已完整實作並部署完成，提供：

**✅ 完整的財報與籌碼面數據**
**✅ 智慧分析與評分系統**
**✅ 週報統計與趨勢追蹤**
**✅ 異常監控與自動提醒**
**✅ Telegram 統一指令介面**

**所有核心功能已就緒，可立即使用。**

**下一步：**
- 實戰測試與反饋收集
- 視需求微調優化
- 規劃 Phase 3 新功能
