# OpenClaw 專案精進計劃

> **日期**: 2026-03-20（計劃 1 已完成）
> **範圍**: 本地 + VPS OpenClaw 環境與 my-project agents 整合

---

## 現況摘要

| 項目 | 現況 |
|------|------|
| OpenClaw 版本 | v2026.3.8 |
| L1 記憶（MEMORY.md） | 正常（964 bytes） |
| L2 記憶（daily logs） | ✅ 計劃 1 已修復（`ae55994`） |
| Knowledge-Digest entries | 僅 3 筆 |
| Memory watch | disabled（只有 onSearch 觸發） |
| Agent tools | 未設定任何自訂工具 |
| Plugin | 僅 telegram |

---

## 計劃 1 — Daily Log 寫入機制修復 ✅ 已完成

- commit `ae55994`: `src/core/memory/daily-writer.js`
- commit `eb5fd83`: `phase4-assemble.js` 整合 try/finally
- 待部署到 VPS

---

## 計劃 2 — Knowledge-Digest 知識庫充實（迫切度：高）

### 問題

knowledge-digest 只有 3 筆 entries，RAG 幾乎無法發揮作用。整個 `extraPaths` 掛載到 OpenClaw 的知識來源形同空白。

### 解法

系統性批次導入現有知識：

1. `src/agents/market-digest/references/` 下的分析文件
2. optimization-advisor 歷史建議輸出
3. 本地未 ingest 的 brain markdown（用 `/brain-review` skill）

並在 optimization-advisor 每週掃描後，自動將本次建議追加至 knowledge-digest。

### 行動項目

1. 盤點 `src/agents/market-digest/references/` 可 ingest 的文件
2. 批次用 `/brain-ingest` 導入（目標 20+ entries）
3. 在 optimization-advisor scan 後加入寫入 knowledge-digest 步驟

### 關鍵檔案

- VPS：`~/clawd/agents/knowledge-digest/data/knowledge-store.jsonl`
- 本地：`src/agents/optimization-advisor/`

### 驗證

`openclaw memory search "台積電"` → 返回 knowledge-digest entries

---

## 計劃 3 — Memory Watch 啟用（迫切度：中）

### 問題

`memorySearch.sync.watch: false`，只在查詢時（onSearch）觸發索引重建。若 market-digest 在凌晨寫入新 daily log，直到下次對話才會被索引，有延遲。

### 解法

修改 `openclaw.json`：

```json
"sync": {
  "onSearch": true,
  "watch": true,
  "intervalMinutes": 30
}
```

每 30 分鐘背景重建一次索引，確保夜間寫入的 daily log 在早晨查詢前已索引。

### 行動項目

1. 修改 VPS `~/.openclaw/openclaw.json` 的 `agents.defaults.memorySearch.sync`
2. `openclaw gateway restart`
3. 24 小時後 `openclaw memory status` 確認正常

### 關鍵檔案

- VPS：`~/.openclaw/openclaw.json`（`agents.defaults.memorySearch.sync`）

### 驗證

寫入 MEMORY.md 等 30 分鐘後 `memory status` → Dirty 自動變 No

---

## 計劃 4 — Agent Tools 自訂整合（迫切度：中）

### 問題

`openclaw.json` 的 `tools` 完全空白。官方支援 agent-level tools，但目前 market-digest、security-patrol 等只靠 cron 驅動，OpenClaw 無法主動查詢其狀態。

### 解法

為主 agent 註冊以下工具，讓 Telegram 可直接觸發：

| 工具名稱 | 對應腳本 | 功能 |
|---------|---------|------|
| `get_market_summary` | `market-digest/agent.js status` | 查詢最新市場摘要 |
| `get_sre_status` | `security-patrol/agent.js status` | 查詢 VPS 健康狀態 |
| `run_optimization_scan` | `optimization-advisor/agent.js` | 觸發 SRE 掃描 |

### 行動項目

1. 確認各 agent 的 `status` 指令存在並有標準輸出
2. 在 `openclaw.json` 的 `agents.list[main].tools` 加入 JSON Schema 工具定義
3. Telegram 測試觸發

### 關鍵檔案

- VPS：`~/.openclaw/openclaw.json`（`agents.list.main.tools`）
- VPS：`~/clawd/agents/market-digest/agent.js`
- VPS：`~/clawd/agents/security-patrol/agent.js`

### 驗證

Telegram 輸入「市場摘要」→ agent 呼叫 `get_market_summary` 工具

---

## 計劃 5 — Memory Pipeline 健康自動診斷（迫切度：中）

### 問題（本次發現的教訓）

本次發現 daily log 斷了 5 週，是透過人工查詢才找到的。調查過程花了 3 輪 SSH 才確認根因（`~/.openclaw/MEMORY.md` vs `~/clawd/MEMORY.md` 是兩個不同的檔案、Phase 3 從未觸發等），效率很低。

若能有一個統一的「memory pipeline 健康報告」，每天自動產出並在 Telegram 通知，這類問題可在發生當天即被察覺。

### 解法

在 security-patrol 或 deploy-monitor 中新增一個 `memory-health` 檢查，每日（例如 08:00 UTC）輸出：

- `~/clawd/memory/` 最新 daily log 的日期（距今幾天）
- knowledge-digest entries 數量
- `openclaw memory status` 中各 store 的 Dirty 狀態
- `~/.openclaw/MEMORY.md` vs `~/clawd/MEMORY.md` 的 bytes（確認兩者都非空）

若 daily log 超過 2 天未更新 → Telegram 發出 WARNING。

### 行動項目

1. 在 `src/agents/security-patrol/` 或 `src/agents/deploy-monitor/` 新增 `checkMemoryHealth()` 函式
2. 加入 crontab（08:00 UTC）
3. 出現異常時透過現有 Telegram notifier 發出警報

### 關鍵檔案

- 本地：`src/agents/security-patrol/` 或 `src/agents/deploy-monitor/`
- 本地：`src/core/alert-system/`（複用現有 Telegram notifier）
- VPS：`~/clawd/memory/`

### 驗證

停止 daily log 寫入 2 天 → 08:00 UTC Telegram 收到 WARNING

---

## 計劃 6 — Firecrawl 網頁搜尋整合（迫切度：低，但高價值）

### 問題

官方 v2026 新增 Firecrawl 作為內建搜尋提供商，但目前未啟用。market-digest 靠 RSS + Perplexity 獲取資訊，流程複雜且成本高。

### 解法

在 `openclaw.json` 設定 Firecrawl：

```json
"search": {
  "provider": "firecrawl",
  "apiKey": "${FIRECRAWL_API_KEY}"
}
```

讓主 agent 可直接在 Telegram 對話中查詢即時財經資訊，不必等 cron 推播。

### 行動項目

1. `openclaw plugins list` 確認 v2026.3.8 已支援 Firecrawl
2. 申請 Firecrawl API key（有免費額度）
3. 設定並測試

### 關鍵檔案

- VPS：`~/.openclaw/openclaw.json`（`search` section）

### 驗證

Telegram 輸入「搜尋今日財經新聞」→ Firecrawl 返回結果

---

## 執行優先序

| 順序 | 計劃 | 工作量 | 效益 | 狀態 |
|------|------|--------|------|------|
| 1 | Daily Log 修復 | 1-2 小時 | L2 記憶恢復累積 | ✅ 已完成 |
| 2 | Knowledge-Digest 充實 | 2-4 小時 | RAG 開始有效 | 待執行 |
| 3 | Memory Watch 啟用 | 30 分鐘 | 索引即時性 | 待執行 |
| 4 | Agent Tools 整合 | 3-5 小時 | Telegram 互動質變 | 待執行 |
| 5 | Memory Pipeline 健康診斷 | 1-2 小時 | 問題早發現 | 待執行 |
| 6 | Firecrawl 整合 | 1-2 小時 | 降低 API 成本 | 待執行 |
