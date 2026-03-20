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

## 工作流程（5 步）

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
- 在報告摘要的「重點發現」欄填入一句話（≤20 字），供 trend 使用
- **更新 trend.md**：append 一行到 `docs/dogfood-reports/trend.md`
  - 若不存在，先建立完整結構（見下方「首次建立 trend.md 最少內容」），再 append
  - 若存在，只 append 一行，不修改前面內容
  - 趨勢箭頭：與前一行 score 比較；若 scope 不同則加 `*` 標記
- **更新 trend.jsonl**：append 一個 JSON 物件到 `docs/dogfood-reports/trend.jsonl`
  - 寫入安全：先組成完整字串（含 `\n`），再一次性 append
  - v1 schema 欄位：`v`, `date`, `env`, `scope`, `P0`, `P1`, `P2`, `P3`, `total`, `score`, `score_delta`, `trend_marker`, `highlight_short`, `highlight_tags`, `highlight_type`
  - `score` = P0×10 + P1×5 + P2×2 + P3×1
  - `score_delta`：本次 score 減前一行 score（首行為 `null`）
  - `trend_marker`：落盤箭頭結果（e.g., `"↓*"`、`"↑"`、`"—"`）
  - `highlight_tags`：取 severity score 加權後前 1-2 個主導分類，依主導程度高到低排列，使用 taxonomy code（大寫：`["ERR","CFG"]`），映射自 [references/issue-taxonomy.md](references/issue-taxonomy.md)
  - `highlight_type`：本次最高加權分類，使用 mapped label（小寫：`"error"`）。Tie-breaker：severity-weighted score → 較高嚴重度 issue 數 → issue 總數 → taxonomy 順序（CLI > CFG > STR > ERR > SRE > DX > SEC）
- **失敗處理**：trend 更新失敗時，告知使用者但不回滾報告、不阻斷 Step 5
- 告知使用者報告位置和重點發現

**首次建立 trend.md 最少內容**：標題、Score 公式、趨勢箭頭規則（含 `*` 標記）、Scope 規範、表頭、觀察區塊、更新規則。

### Step 5 — 自我改進（Self-improving Loop）

在報告完成後執行，目的是讓 checklist 自我進化。

**5a. 回顧本次 issues**

逐一檢視每個 issue，問：
> 如果 checklist 有哪個項目，這個 issue 在 Step 2 就能被發現？

**5b. 識別 checklist 盲點，起草具體建議**

每條建議**必須**使用以下強制模板，缺任何一個欄位則該建議無效、不展示：

```text
[BLOCK]: {A-G 區塊代號}
[KEY]: {語意 key}
[CMD]: {完整可執行指令}
[EXPECT]: {正常時的具體輸出}
[FAIL]: {異常時的具體輸出}
[SOURCE]: ISSUE-{NNN}
```

**格式約束**（防止 drift）：

- `[CMD]` 必須是可直接貼進 terminal 的指令，不允許自然語言描述
- `[CMD]` 必須能直接檢查該 issue 的失敗模式，不得使用 echo、placeholder 替代
- `[EXPECT]` 和 `[FAIL]` 必須描述可觀察的輸出，不允許「正常」「異常」等模糊詞
- `[KEY]` 是語意描述，不是從指令字串自動推導

**[KEY] 命名規範**：

- 一律 kebab-case
- 以「檢查目標 + 驗證條件」命名（e.g., `require-agent-no-missing-module`）
- 不得用泛稱（e.g., `agent-check`、`module-fix`）
- 若新建議與既有建議檢查目標相同，優先沿用既有 KEY
- 沿用時在展示中明示：`沿用既有 KEY: xxx`

**5c. 去重檢查**

起草建議後，查閱 `references/checklist-meta.json`：

- 若 `key` 已存在 → 跳過，不展示
- 若語意相同但字面不同 → 沿用既有 key，不建立新 key
- 若 `key` 不存在 → 加入待建議清單

**5d. 展示建議給使用者**

```text
=== Checklist 改進建議（本次共 N 項）===

[建議 1]
[BLOCK]: B
[KEY]: require-agent-no-missing-module
[CMD]: node -e "require('./agent.js')" 2>&1 | head -3
[EXPECT]: 無輸出，exit code 0
[FAIL]: Cannot find module './xxx'
[SOURCE]: ISSUE-001

轉換為 checklist 項目：
- [ ] `node -e "require('./agent.js')" 2>&1 | head -3` — 無 Cannot find module 錯誤

是否將以上建議加入 references/checklist.md？（yes / no / 逐一決定）
```

**5e. 根據使用者回應行動**

- `yes`：
  1. 將建議轉換為 `- [ ]` 格式，**append 到 `checklist.md` 對應區塊的尾端**（保留原有順序，不重排既有項目）
  2. 將每條建議的 metadata 追加到 `checklist-meta.json` 的 `items` 陣列（key 在 items 中不可重複）
  3. 告知修改位置
- `no`：跳過，兩個檔案都不修改
- `逐一決定`：對每條建議分別詢問
- 若本次 0 個盲點（或全部被去重過濾）：告知「本次 checklist 覆蓋完整，無新建議」，直接結束

> **原則**：Step 5 只在使用者明確同意後才修改 checklist.md 和 checklist-meta.json。

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
| [references/issue-taxonomy.md](references/issue-taxonomy.md) | Issue 分類法（7 類 + 4 級嚴重度）— highlight_tags/type 的唯一映射來源 |
| [references/checklist.md](references/checklist.md) | 完整探索 checklist（A-G 區塊） |
| [references/checklist-meta.json](references/checklist-meta.json) | Step 5 去重紀錄（已加入 checklist 的建議 metadata） |
| [references/report-template.md](references/report-template.md) | 報告模板（複製到 docs/dogfood-reports/ 使用） |
