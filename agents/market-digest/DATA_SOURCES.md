# Market Digest 資料源說明

**最後更新：** 2026-02-03

---

## 📊 當前資料流

### 主要資料源：LINE 群組早報

**來源：** 國泰證券早報（人工輸入）  
**時段：** 每日 08:00-08:10（台北時間）  
**收集工具：** `morning-collector.js`  
**存放位置：** `data/morning-collect/YYYY-MM-DD.json`  
**格式：** JSON（包含文字與圖片）

**範例：**
```json
{
  "date": "2026-02-03",
  "messages": [
    {
      "type": "text",
      "content": "🌳2026 🐴AI 🤖Cathay Good Morning! ...",
      "timestamp": "2026-02-03T00:21:00.000Z"
    }
  ],
  "images": []
}
```

**特點：**
- ✅ 內容豐富（3000+ 字）
- ✅ 涵蓋台股/美股/商品/債市/個股焦點
- ✅ 包含國泰證券的專業分析

---

### 市場數據：Yahoo Finance API

**來源：** Yahoo Finance API  
**用途：** 即時市場數據  
**Plugin：** `backend/sources/plugins/yahoo-finance/`

**提供資料：**
- **台股加權指數（^TWII）**
  - 收盤價、漲跌幅、成交量
  - 技術指標：MA5、MA20、RSI
  
- **美股指數**
  - S&P 500（^GSPC）
  - Nasdaq（^IXIC）
  - Dow Jones（^DJI）
  
- **台幣匯率（TWD=X）**
  - 即時匯率、漲跌幅

**更新頻率：** 每次報告生成時（約每日 08:30）

**API 端點：**
```
https://query1.finance.yahoo.com/v8/finance/chart/{symbol}
```

---

### 技術指標計算

**計算工具：** `backend/fetcher.js`

**指標說明：**
- **MA5 / MA20：** 5 日與 20 日移動平均線
- **RSI：** 相對強弱指標（14 期）
- **計算方式：** 基於 Yahoo Finance 提供的歷史資料

---

## 🗃️ 備用資料源（Legacy）

以下資料源已移至 `backend/sources/legacy/`，供未來參考：

| 資料源 | 類型 | 狀態 | 說明 |
|--------|------|------|------|
| RSS Adapter | RSS | 🔵 備用 | 舊版 RSS 抓取架構 |
| Yahoo 舊版 API | API | 🔵 備用 | 已被 plugin 取代 |
| Bloomberg Plugin | RSS | 🔵 備用 | 未啟用 |
| Custom API Plugin | API | 🔵 備用 | 未啟用 |

**若需重新啟用，請參考：** `backend/sources/legacy/README.md`

---

## 🔄 報告生成流程

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
```

---

## 📈 資料源健康度

| 資料源 | 狀態 | 最後更新 | 覆蓋率 | 驗收方式 |
|--------|------|---------|--------|----------|
| LINE 群組早報 | 🟢 正常 | 每日 | 100% | `ls data/morning-collect/` |
| Yahoo Finance API | 🟢 正常 | 即時 | 100% | `node sre/health-check.js` |
| RSS Feeds | 🔵 備用 | - | 0% | 已移至 legacy/ |

---

## 🔧 維護建議

### 每日檢查

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

---

### 每週檢查

```bash
# 健康度檢查
node sre/health-check.js

# Production Readiness
node sre/production-readiness-report.js

# 檢查 Yahoo Finance API
node backend/sources/plugins/yahoo-finance/plugin.js
```

---

### 故障排除

#### 問題 1：早報未收集

**檢查：**
```bash
ls -lh data/morning-collect/$(date +%Y-%m-%d).json
```

**修復：**
- 手動執行：`node morning-collector.js add-text "<內容>"`
- 檢查 Telegram 連線

---

#### 問題 2：市場數據抓取失敗

**檢查：**
```bash
node backend/sources/plugins/yahoo-finance/plugin.js
```

**可能原因：**
- Yahoo Finance API 暫時無法連線
- 網路問題

**修復：**
- 等待 API 恢復
- 或使用 circuit breaker 自動降級

---

## 🚀 擴充新資料源

若需新增資料源（如財報 API、新聞 API），請遵循以下步驟：

### 1. 建立 Plugin

```bash
mkdir -p backend/sources/plugins/my-source
```

建立 `plugin.js`：
```javascript
class MySourcePlugin {
  constructor(config) {
    this.config = config;
  }

  async fetch() {
    // 實作抓取邏輯
    return {
      data: [...],
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = MySourcePlugin;
```

---

### 2. 註冊 Plugin

更新 `backend/sources/registry.json`：
```json
{
  "plugins": {
    "my-source": {
      "name": "my-source",
      "version": "1.0.0",
      "type": "news",
      "enabled": true,
      "config": {
        "apiUrl": "https://...",
        "timeout": 5000
      }
    }
  }
}
```

---

### 3. 更新 Config

更新 `config.json`：
```json
{
  "data_sources": {
    "my_source": {
      "provider": "my-source",
      "enabled": true
    }
  }
}
```

---

### 4. 測試

```bash
node backend/sources/plugins/my-source/plugin.js
```

---

### 5. 整合到報告

更新 `backend/fetcher.js` 或 `smart-integrator.js`，整合新資料源。

---

## 📝 變更記錄

### 2026-02-03
- ✅ 移除未使用的 RSS 資料源（MoneyDJ、鉅亨網、Reuters）
- ✅ 將舊 RSS 架構移至 `backend/sources/legacy/`
- ✅ 簡化 `config.json`
- ✅ 清理過期 cache（`news-raw.json`）
- ✅ 建立本文件（`DATA_SOURCES.md`）

---

## 📞 聯絡資訊

**維護者：** Clawbot  
**文件位置：** `~/clawd/agents/market-digest/DATA_SOURCES.md`  
**相關文件：**
- `FEATURES_SUMMARY.md` - 功能總覽
- `TECHNICAL_DEBT_ANALYSIS.md` - 技術債分析
- `backend/sources/legacy/README.md` - Legacy 資料源說明
