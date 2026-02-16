# Market Digest Technical Debt Analysis

**生成時間：** 2026-02-03 03:31 UTC  
**整體健康度：** 🟡 **B+ (82/100)**  
**Production Readiness：** 🟢 **A+ (100%)**

---

## 📊 整體評估

| 維度 | 評分 | 狀態 | 說明 |
|------|------|------|------|
| **Production Readiness** | 100/100 | 🟢 優秀 | SRE 系統完善 |
| **資料源架構** | 70/100 | 🟡 需改進 | 存在冗餘與未使用資源 |
| **依賴管理** | 90/100 | 🟢 良好 | 版本穩定，但有改進空間 |
| **代碼品質** | 85/100 | 🟢 良好 | 測試覆蓋完整，但有重複代碼 |
| **文件完整性** | 95/100 | 🟢 優秀 | 文件齊全 |

**綜合評分：82/100 (B+)**

---

## 🔴 Critical Issues (優先修復)

### 1. 資料源冗餘與未使用代碼

**問題描述：**
- 當前主要依賴 **LINE 群組早報**，但仍保留舊的 RSS/Yahoo Finance 資料源架構
- `config.json` 中 3 個資料源 `enabled: false`（MoneyDJ、鉅亨網、Reuters）
- Plugin 架構（`backend/sources/plugins/`）已建立但未充分利用

**影響範圍：**
- 維護成本增加（需維護不使用的代碼）
- 新人難以理解系統實際資料流
- 潛在的安全風險（未維護的依賴）

**建議修復：**

#### 選項 A：保留多資料源（推薦）
保留架構以備未來擴充，但清理未使用代碼。

```bash
# 1. 移除 disabled 資料源的配置
# 修改 config.json，移除：
#   - MoneyDJ (enabled: false)
#   - 鉅亨網 (enabled: false)
#   - Reuters (enabled: false)

# 2. 標記舊 RSS 架構為「備用」
mkdir -p backend/sources/legacy
mv backend/sources/rss.js backend/sources/legacy/
mv backend/sources/yahoo.js backend/sources/legacy/

# 3. 更新文件說明當前資料流
# 在 README 中明確說明：
#   - 主要資料源：LINE 群組早報（manual input）
#   - 次要資料源：Yahoo Finance（市場數據）
#   - 備用資料源：RSS feeds（legacy/）
```

**優點：**
- 保留未來擴充彈性
- 清理當前維護負擔
- 資料流清晰

**缺點：**
- 仍需維護 Yahoo Finance plugin

---

#### 選項 B：精簡為單一資料源
徹底移除舊架構，專注於 LINE 早報 + 基本市場數據。

```bash
# 1. 移除舊資料源架構
rm -rf backend/sources/plugins/bloomberg
rm -rf backend/sources/plugins/custom-api
rm backend/sources/rss.js

# 2. 保留最小化的 Yahoo Finance（僅市場數據）
# 簡化 config.json：
{
  "data_sources": {
    "manual_input": {
      "type": "line_group",
      "enabled": true
    },
    "market_data": {
      "provider": "yahoo",
      "enabled": true
    }
  }
}

# 3. 移除 RSS parser 依賴
npm uninstall rss-parser
```

**優點：**
- 最簡化的架構
- 維護成本最低
- 符合當前使用情境

**缺點：**
- 喪失未來擴充彈性
- 若需新增資料源需重建架構

---

### 2. 依賴版本過時

**問題描述：**
- `node-fetch@2.7.0` - 最新版本為 v3.x（ESM），但 v2 在 CommonJS 專案中仍合理
- `rss-parser@3.13.0` - 目前實際未使用（LINE 早報不需要）

**風險評估：**
- 🟡 **Medium** - node-fetch v2 有安全更新，但不緊急
- 🟢 **Low** - rss-parser 未使用，可移除

**建議修復：**

```bash
# 1. 保持 node-fetch v2（除非遷移到 ESM）
# v2 仍受維護，CommonJS 專案不建議升級 v3

# 2. 移除 rss-parser（如採用選項 B）
npm uninstall rss-parser

# 3. 定期檢查安全更新
npm audit
npm audit fix
```

---

## 🟡 Medium Issues (建議改進)

### 3. 測試檔案過多

**問題描述：**
根目錄有 9 個測試檔案（`test-*.js`），混雜在主要程式中。

```
test-crash-resistance.js
test-error-handler.js
test-full-integration.js
test-market-digest-patch.js
test-news-sources.js
test-research-signal-patch.js
test-semantic-patch.js
test-upgrades.js
```

**影響：**
- 根目錄檔案數量過多（26 個 .js 檔案）
- 難以區分生產代碼與測試代碼

**建議修復：**

```bash
# 1. 建立測試目錄
mkdir -p tests

# 2. 移動測試檔案
mv test-*.js tests/

# 3. 更新測試指令（如有）
# package.json:
{
  "scripts": {
    "test": "node tests/test-full-integration.js"
  }
}
```

---

### 4. 重複的整合器

**問題描述：**
存在兩個整合器：
- `smart-integrator.js` - 智慧整合（目前使用）
- `morning-integrator.js` - 原樣保留整合器（已棄用）

**風險：**
- 維護混淆
- 新人可能使用錯誤的檔案

**建議修復：**

```bash
# 選項 1：移除棄用檔案
rm morning-integrator.js

# 選項 2：移到 legacy/
mkdir -p legacy
mv morning-integrator.js legacy/
echo "已棄用，請使用 smart-integrator.js" > legacy/README.md
```

---

### 5. Patch 檔案管理

**問題描述：**
根目錄有 4 個 patch 檔案：
- `patch-minimal-upgrade-v1.js`
- `research-boundary-enforcement-patch.js`
- `research-signal-semantic-patch.js`
- `research-signal-upgrade-patch.js`

**建議改進：**

```bash
# 整理到專用目錄
mkdir -p patches
mv *patch*.js patches/
```

---

## 🟢 Low Issues (可選改進)

### 6. 未使用的 Renderer

**問題：**
- `renderer.js` - 基本渲染器
- `institutional-renderer.js` - 機構版渲染器

**現況：**
當前使用 `smart-integrator.js` 內建的渲染邏輯，獨立 renderer 未使用。

**建議：**
保留作為備用，或移到 `legacy/`。

---

### 7. 實驗追蹤器未啟用

**問題：**
`experiment-tracker.js` 已實作但未啟用（在建議 4 中提到的 Feature Flags）。

**建議：**
未來若需 A/B 測試再啟用，目前可保留。

---

## 📈 改進建議優先級

### P0 (本週完成)

1. **清理資料源配置**
   - 選擇選項 A 或 B
   - 更新 config.json
   - 更新文件說明資料流

2. **移除 rss-parser 依賴**（如採用選項 B）
   ```bash
   npm uninstall rss-parser
   ```

### P1 (本月完成)

3. **整理測試檔案**
   ```bash
   mkdir tests
   mv test-*.js tests/
   ```

4. **移除棄用的 morning-integrator.js**
   ```bash
   rm morning-integrator.js
   ```

5. **整理 patch 檔案**
   ```bash
   mkdir patches
   mv *patch*.js patches/
   ```

### P2 (可選)

6. **定期安全更新**
   ```bash
   npm audit
   npm update
   ```

7. **文件更新**
   - 在 README 中說明資料流
   - 標記 legacy 代碼

---

## 🎯 推薦執行方案

### 階段 1：立即執行（本週）

**選擇選項 A（保留多資料源架構）**

```bash
cd ~/clawd/agents/market-digest

# 1. 清理 config.json
# 手動編輯，移除 enabled: false 的資料源

# 2. 移動舊架構到 legacy
mkdir -p backend/sources/legacy
mv backend/sources/rss.js backend/sources/legacy/

# 3. 更新 README
echo "## 資料流說明
主要資料源：LINE 群組早報（手動輸入）
市場數據：Yahoo Finance API
備用架構：backend/sources/legacy/
" >> DATA_SOURCES.md

# 4. 驗收
node sre/production-readiness-report.js
```

**預期成果：**
- 清晰的資料流文件
- 移除未使用配置
- 保留未來擴充彈性

---

### 階段 2：整理結構（本月）

```bash
# 1. 整理測試
mkdir tests
mv test-*.js tests/

# 2. 整理 patches
mkdir patches
mv *patch*.js patches/

# 3. 移除棄用檔案
rm morning-integrator.js

# 4. Git commit
git add .
git commit -m "refactor: 整理目錄結構，移除棄用代碼"
```

---

## 📊 整理後的目錄結構

```
market-digest/
├── smart-integrator.js          # 主要整合器
├── morning-collector.js         # 早報收集
├── query.js                     # 快速檢索
├── watchlist.js                 # 追蹤清單
├── weekly-summary.js            # 週報
├── reminder-extractor.js        # 提醒提取
├── reminder-checker.js          # 提醒檢查
├── agent.js                     # (如有)
├── renderer.js                  # 基本渲染器
├── vision-extractor.js          # 圖片提取
├── global-error-handler.js      # 錯誤處理
├── experiment-tracker.js        # 實驗追蹤
├── show-report.js               # 顯示報告
├── backend/
│   ├── fetcher.js
│   ├── runtime-gen.js
│   ├── translator.js
│   ├── timeseries-storage.js
│   ├── section-router.js
│   └── sources/
│       ├── adapter.js
│       ├── plugin-manager.js
│       ├── registry.json
│       ├── plugins/
│       │   └── yahoo-finance/
│       └── legacy/              # 🆕 備用代碼
│           └── rss.js
├── sre/                         # SRE 工具
├── tests/                       # 🆕 測試檔案
│   ├── test-full-integration.js
│   ├── test-error-handler.js
│   └── ...
├── patches/                     # 🆕 Patch 檔案
│   ├── research-signal-upgrade-patch.js
│   └── ...
├── data/
├── logs/
└── docs/
    ├── FEATURES_SUMMARY.md
    ├── TIERED_OUTPUT.md
    ├── QUERY_TOOL.md
    ├── QUICKSTART.md
    └── DATA_SOURCES.md          # 🆕 資料流說明
```

---

## ✅ 驗收標準

### 階段 1 完成後

```bash
# 1. Production Readiness 仍為 100%
node sre/production-readiness-report.js | grep "得分"
# 預期：得分: 105/105 (100.0%)

# 2. 無 disabled 資料源
cat config.json | grep "enabled.*false" | wc -l
# 預期：0

# 3. 有資料流文件
test -f DATA_SOURCES.md && echo "✅ 資料流文件存在"

# 4. Legacy 代碼已移動
test -d backend/sources/legacy && echo "✅ Legacy 目錄已建立"
```

### 階段 2 完成後

```bash
# 1. 測試檔案已整理
test -d tests && ls tests/test-*.js | wc -l
# 預期：8-9 個測試檔案

# 2. Patch 檔案已整理
test -d patches && ls patches/*patch*.js | wc -l
# 預期：4 個 patch 檔案

# 3. 根目錄檔案數量減少
ls *.js | wc -l
# 預期：< 15 個檔案
```

---

## 🎯 預期改進效果

| 維度 | 改進前 | 改進後 | 提升 |
|------|--------|--------|------|
| 資料源架構 | 70/100 | 85/100 | +15 |
| 代碼品質 | 85/100 | 92/100 | +7 |
| 維護成本 | 🟡 中 | 🟢 低 | ⬇️ 30% |
| 新人理解度 | 🟡 需文件 | 🟢 自解釋 | ⬆️ 40% |

**整體評分預期：82 → 89 (B+ → A-)**

---

## 📝 總結

Market Digest 的 **Production Readiness 已達 100%**，但存在以下技術債：

1. ✅ **SRE 系統完善** - 錯誤處理、健康檢查、監控完整
2. 🟡 **資料源架構冗餘** - 需清理未使用配置與代碼
3. 🟡 **目錄結構混亂** - 測試與 patch 檔案散落根目錄
4. 🟢 **依賴管理良好** - 版本穩定，無嚴重安全問題
5. 🟢 **文件完整** - 功能說明齊全

**建議優先執行階段 1**（資料源清理），預計 2-3 小時完成，可立即提升系統清晰度與維護性。
