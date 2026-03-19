---
name: dogfood
description: |
  系統性自用測試（Dogfooding）。以使用者角度操作 CLI 命令和 Agent，
  發現真實問題並產出結構化 issue 報告。強調證據驅動、增量記錄、品質優於數量。
  使用時機：「dogfood」、「QA」、「自測」、「smoke test」、「健康檢查」。
tools: Read, Grep, Glob, Bash
user-invocable: true
---

## 目標與原則

- **證據驅動** — 每個 issue 必須附上實際指令、stdout/stderr 輸出、exit code
- **增量記錄** — 發現即記錄到報告，不要累積到最後（防 session 中斷遺失）
- **品質優於數量** — 5-10 個深入 issue > 20 個淺層 issue
- **不修復只記錄** — dogfood 過程中不修改程式碼，只產出報告
- **涵蓋面** — 預設測試 CLI 主進入點 + 所有 active agents

## 觸發方式

- `/dogfood` — 全面掃描（CLI + 所有 agents）
- `/dogfood market-digest` — 只測指定 agent
- `/dogfood --vps` — 透過 vps-operator subagent 在 VPS 上執行

## 工作流程（4 步）

### Step 1 — 環境探查（2 分鐘）

確認執行環境和基本資訊：

```bash
node --version
ls src/agents/
cat package.json | grep -E '"name"|"version"'
```

- 確認環境：local 或 VPS
- 列出所有 agents 和 CLI 命令
- 初始化報告檔案：複製 `references/report-template.md` 到 `docs/dogfood-reports/YYYY-MM-DD.md`

### Step 2 — 系統性探索（主體）

按 [references/checklist.md](references/checklist.md) 逐項測試：

1. 先測 CLI 主進入點（checklist A 區塊）
2. 逐一測試每個 agent（checklist B-E 區塊）
3. 測試錯誤處理（checklist F 區塊）
4. 檢查跨 agent 一致性（checklist G 區塊）

**每個測試記錄**：
- 執行的指令
- 預期結果
- 實際結果（stdout/stderr 完整擷取）
- exit code（`echo $?`）

**發現問題時**：立即按 [references/issue-taxonomy.md](references/issue-taxonomy.md) 分類，填入報告。

### Step 3 — 深入調查

對 Step 2 發現的問題追蹤根因：

- 檢查相關 config.json、環境變數、依賴模組
- 嘗試邊界條件（無效輸入、缺少 config、空資料）
- 確認問題是否跨 agent（可能是共用模組的問題）

### Step 4 — 產出報告

- 更新報告摘要的嚴重度統計
- 確認每個 ISSUE-NNN 都反映在統計中
- 附錄填入 checklist 完成狀態
- 告知使用者報告位置和重點發現

## VPS Dogfood

透過 vps-operator subagent 在 VPS 上執行。額外檢查項目：

- PM2 process list 和 status
- systemd service 狀態（openclaw-gateway）
- crontab 內容和最近執行記錄
- 磁碟和記憶體使用量
- Agent 的 runtime 目錄和日誌

> ⚠️ VPS dogfood 必須經使用者明確授權才能執行。
> SSH 類操作用 1 個 vps-operator subagent 依序執行多步，不要並行（OOM 風險）。

## 執行邊界

**可以做**：
- `node agent.js help` / `node agent.js status`
- `node src/main/js/index.js hello`
- 讀取檔案、檢查結構、驗證 config
- 檢查 exit code、stdout/stderr

**不可以做**：
- `node agent.js run`（會觸發真實 API 呼叫和推播）
- 修改任何檔案（報告除外）
- 未經授權 SSH 到 VPS

**例外**：使用者明確要求 `--dry-run` 測試時可執行 run。

## 反模式

```
❌ 只跑 `node agent.js help` 就報告「一切正常」
✅ 逐項檢查 config.json 完整性、必要檔案存在、help 輸出格式、status 行為

❌ 發現 20 個「config 缺少可選欄位」的同質 issue
✅ 合併為 1 個 issue，附上所有受影響 agent 列表

❌ 只看 market-digest 這一個大 agent
✅ 覆蓋所有 active agents + CLI 主進入點

❌ 探索完才開始寫報告
✅ 發現一個 issue 就立即寫入報告（增量記錄）

❌ 發現問題就開始修 code
✅ 只記錄，不修復。修復是另一個 session 的事
```

## 參考文件

| 文件 | 用途 |
| --- | --- |
| [references/issue-taxonomy.md](references/issue-taxonomy.md) | Issue 分類法（7 類 + 4 級嚴重度） |
| [references/checklist.md](references/checklist.md) | 完整探索 checklist（A-G 區塊） |
| [references/report-template.md](references/report-template.md) | 報告模板（複製到 docs/dogfood-reports/ 使用） |
