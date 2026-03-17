---
name: brain-ingest
description: |
  Brain Markdown → Knowledge-Digest 端對端 pipeline。

  執行流程：
  1. 驗證 markdown 路徑
  2. 呼叫 brain-parser
  3. 顯示 chunk 預覽
  4. 呼叫 digest ingest
  5. 寫入 Knowledge Base + reindex

  用法：
    /brain-ingest <path> [--dry-run] [--yes] [--tags=t1,t2]

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

**Flags 原則**：所有 flags 預設 passthrough 至 CLI。若不傳遞，必須明確說明原因。

---

你需要從使用者輸入中解析：

【1】必要參數
- markdown_path（必填）

【2】可選 flags
- --dry-run
- --yes
- --tags=t1,t2

----------------------------------------

【Step 1：路徑處理】

1. 若為相對路徑：
   以專案根目錄解析：
   /Users/suweicheng/projects/my-project

2. 檢查檔案是否存在：

若不存在：
→ 回覆錯誤並停止（不要執行 shell）

----------------------------------------

【Step 2：執行 pipeline】

只能執行既有指令：

./tools/brain-ingest.sh "<markdown_path>" [flags]

不要改用其他指令重組流程，
不要自行直接呼叫 brain-parser.py 或 digest.js，
除非 shell script 本身回報錯誤且使用者明確要求除錯。

----------------------------------------

【Step 3：輸出規則（很重要）】

你必須：

1. 顯示執行的 command（可複製）
2. 顯示 brain-parser 結果（chunk 數量）
3. 顯示 digest 預覽（若非 --yes）
4. 若成功：顯示 ingest 完成訊息 + tags（若有）

----------------------------------------

【Step 4：模式行為】

預設：
→ 預覽 → 詢問使用者確認

--dry-run：
→ 只顯示 preview，不寫入

--yes：
→ 直接 ingest（無確認）

若未帶 --yes，且 shell script 需要互動確認：
先顯示 preview，再等待使用者確認，不得自行替使用者確認。

若同時出現 --yes 與 --dry-run：
→ 以 shell script 實際行為為準
→ Claude 不自行推論或改寫行為

----------------------------------------

【Step 5：錯誤處理（必要）】

以下情況要明確回報：

- 檔案不存在
- brain-parser 失敗
- digest ingest 失敗
- shell exit code ≠ 0

----------------------------------------

【輸出格式（固定）】

### 🧠 Brain Ingest

**Command**
```bash
./tools/brain-ingest.sh "<markdown_path>" [flags]
```

**Result**
- path: ...
- chunks: X
- mode: preview / ingest / conflict
- flags: （原樣列出使用者傳入的 flags）
- tags: t1,t2（若有）

（必要時顯示 preview）

---

不要自行修改 pipeline 邏輯
不要推測結果
只負責解析 → 執行 → 呈現
