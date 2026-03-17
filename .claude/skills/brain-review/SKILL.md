---
name: brain-review
description: |
  一鍵執行 Brain Markdown 的知識治理流程。

  執行流程：
  1. 驗證 markdown 路徑
  2. 執行 quality-check
  3. 執行 ingest preview（dry-run）
  4. 顯示 review summary
  5. 停在 confirm，等待使用者確認
  6. 使用者確認後執行 ingest
  7. 自動尋找上一版並執行 diff
  8. 輸出最終結果

  用法：
    /brain-review <path> [--strict] [--tags=t1,t2] [--yes]

tools: Bash, Read
user-invocable: true
---

## 前置條件

若輸入不是 BRAIN_MD（依 `/brain-classify-input` 規則判定），
先依 `/brain-classify-input` 分類並遵循其 next step。

不要在本 skill 內重寫另一套輸入分類規則。
不要因為工具失敗就改用另一個工具。

---

## 全系統原則

**Execution Boundary**：所有結果必須來自 shell / CLI / Read 實際輸出。不模擬、不推測、不編造。

**Determinism Guarantee**：顯示完整 Command（可複製），所有 flags 原樣輸出，不省略、不重寫。

**Safety Priority**（規則衝突時）：
1. Execution Boundary（不可違反）
2. CLI 實際行為
3. 使用者 flags
4. 預設行為

特例：--yes 遇到 quality FAIL → 仍須使用者明確確認，不可自動 ingest。

**Flags 原則**：所有 flags 預設 passthrough 至 CLI，除非明確只屬於某一步（如 --strict）。

**Confirm 判定規則**：只接受 yes / y / confirm / 確認 / 繼續 / 執行 ingest。其他語句（ok / sure / 好 / 嗯）→ 視為未確認。

**Quality FAIL 強制策略**：FAIL → 預設阻止 ingest，除非使用者明確輸入確認語意才繼續。

**Diff 安全界線**：找相似檔名時，若相似度不足（僅共享少量字詞）→ 不可使用 → 視為未找到上一版。

---

白話版：
`/brain-review notes/x.md` 的意思就是「先幫我做知識體檢，再給我看預覽；我點頭後才真的寫進去，最後再告訴我和上一版差在哪。」

---

你需要從使用者輸入中解析：

【1】必要參數
- markdown_path（必填）

【2】可選 flags
- --strict
- --tags=t1,t2
- --yes

----------------------------------------

【Step 1：路徑處理】

1. 若為相對路徑：
   以專案根目錄解析：
   /Users/suweicheng/projects/my-project

2. 檢查檔案是否存在。

若不存在：
→ 回覆錯誤並停止
→ 不要執行任何 shell command

----------------------------------------

【Step 2：State Machine（有限狀態機）】

brain-review 嚴格遵守以下狀態流：

INIT → QUALITY_DONE → PREVIEW_DONE → WAIT_CONFIRM → INGEST_DONE → DIFF_DONE → COMPLETE

規則：
- 未到 WAIT_CONFIRM，不得進入 INGEST
- 未收到確認語意，不得跳過 WAIT_CONFIRM
- 任一步失敗 → 立即停止，不可跳步
- --yes 可跳過 WAIT_CONFIRM，但 quality FAIL 時仍須使用者明確確認

----------------------------------------

【Step 3：quality-check 規則】

優先執行既有 quality-check 指令或 skill 對應流程。

若無專用指令，可讀取檔案內容做保守分析，但不可編造結果。

至少要檢查：

- 結構完整性
- chunk 長度是否異常
- 重複內容
- 空話 / filler
- metadata 缺失
- 可檢索性

輸出 verdict：

- PASS
- WARN
- FAIL

若為 FAIL：
→ 預設阻止 ingest
→ 必須明確警告「品質不合格，不建議 ingest」
→ 除非使用者明確輸入確認語意（yes）才繼續

----------------------------------------

【Step 4：ingest preview 規則】

只能執行既有 preview 指令：

./tools/brain-ingest.sh "<markdown_path>" --dry-run [--tags=t1,t2]

其中：
- 若有 --strict，只用於 quality-check，不傳給 brain-ingest.sh（除非 script 本身支援）
- 若有 --tags=t1,t2，應原樣傳給 brain-ingest.sh
- 不得自行改寫 pipeline
- 不得直接呼叫 brain-parser.py 或 digest.js
- 不得編造 preview 結果

----------------------------------------

【Step 5：confirm 設計】

若未帶 --yes：

1. 先完成 quality-check + ingest preview
2. 顯示固定格式的 review summary
3. 明確詢問使用者是否確認 ingest
4. 在使用者明確確認前，不得執行正式 ingest

只接受以下明確確認語意：
- yes / y / confirm / 確認 / 繼續 / 執行 ingest

其他任何語句（ok / sure / 好 / 嗯 等）→ 視為未確認

若使用者未確認、拒絕、或要求修改：
→ 停在 preview 階段
→ 不寫入任何資料

若帶 --yes：
→ 跳過人工 confirm，直接進入正式 ingest
→ 但 quality FAIL 時仍須使用者明確確認

----------------------------------------

【Step 6：正式 ingest 規則】

正式 ingest 只能執行既有指令：

./tools/brain-ingest.sh "<markdown_path>" --yes [--tags=t1,t2]

- 必須保留可傳遞的使用者 flags
- 不可自行改用其他指令
- 不可推測 ingest 成功
- 以 shell script 實際輸出為準

----------------------------------------

【Step 7：diff 自動找上一版策略】

正式 ingest 成功後，嘗試自動尋找上一版，策略如下：

1. 優先找同目錄中與目前檔案最接近的舊版本檔案
   例如：
   - brain_v1.md → brain_v2.md
   - private-credit-20260301.md → private-credit-20260315.md

2. 若檔名包含版本號（v1, v2, v3...）：
   → 優先尋找前一版版本號

3. 若檔名包含日期（YYYYMMDD 或 YYYY-MM-DD）：
   → 優先尋找同主題最近日期的較舊版本

4. 若以上都無法判定：
   → 可在同目錄尋找同主題最相近檔名
   → 但不可跨目錄亂猜
   → 若相似度不足（僅共享少量字詞）→ 不可使用

5. 若仍找不到可信的上一版：
   → 回報「未找到上一版，跳過 diff」
   → 不要編造比較對象

若找到上一版：
→ 執行既有 diff 指令或安全 diff 工具
→ 輸出新增 / 刪除 / 修改摘要

----------------------------------------

【Step 8：模式行為】

預設：
→ quality-check + preview + confirm → ingest → diff

--yes：
→ quality-check + preview + ingest + diff（跳過人工 confirm）

--strict：
→ 只影響 quality-check 標準，不傳給 ingest（除非 script 支援）

----------------------------------------

【Step 9：錯誤處理】

以下情況要明確回報並停止：

- markdown_path 缺失
- 檔案不存在
- quality-check 失敗
- ingest preview 失敗
- 正式 ingest 失敗
- diff 失敗
- shell exit code ≠ 0

注意：
- 若 diff 找不到上一版，不算失敗，應回報並略過

----------------------------------------

【輸出格式（Preview 階段固定）】

### 🧠 Brain Review

**Command**
```bash
# 1) quality-check
<實際完整 quality-check 指令或 Read "<markdown_path>">

# 2) ingest preview
./tools/brain-ingest.sh "<markdown_path>" --dry-run [flags]
```

**Review Summary**
- path: …
- quality verdict: PASS / WARN / FAIL
- chunks: X
- preview mode: dry-run
- flags: …（原樣列出）
- tags: …（若有）

**Quality Findings**
- …

**Preview**
- 顯示 digest preview / chunk 摘要

**Decision**
- status: waiting for confirm
- action required: 請明確回覆 yes / confirm / 確認 才會執行正式 ingest

----------------------------------------

【輸出格式（Final 階段固定）】

### 🧠 Brain Review

**Command**
```bash
# 1) quality-check
<實際完整 quality-check 指令>

# 2) ingest preview
./tools/brain-ingest.sh "<markdown_path>" --dry-run [flags]

# 3) ingest
./tools/brain-ingest.sh "<markdown_path>" --yes [flags]

# 4) diff
<實際完整 diff 指令；若無上一版則標示 skipped>
```

**Result**
- path: …
- quality verdict: PASS / WARN / FAIL
- ingest: success / skipped / failed
- diff: success / skipped / failed
- previous version: … / not found
- flags: …（原樣列出）
- tags: …（若有）

**Quality Findings**
- …

**Ingest Result**
- chunks: X
- mode: ingest
- summary: …

**Diff Summary**
- 新增：…
- 刪除：…
- 修改：…
- 或：未找到上一版，已跳過 diff

---

不要自行修改 pipeline 邏輯。
不要推測結果。
不要在未確認時執行正式 ingest。
只負責解析 → 檢查 → 預覽 → 等待確認 → 寫入 → 比較 → 呈現。
