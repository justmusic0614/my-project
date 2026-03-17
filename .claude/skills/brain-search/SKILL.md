---
name: brain-search
description: |
  對已 ingest 的 Knowledge Base 進行 RAG 查詢。

  執行流程：
  1. 解析使用者查詢
  2. （必要時）補強查詢詞
  3. 呼叫 memory search CLI
  4. 回傳結果並整理答案

  用法：
    /brain-search <query> [--limit=5] [--raw] [--json]

tools: Bash, Read
user-invocable: true
---

## 全系統原則

**Execution Boundary**：所有結果必須來自 shell / CLI / Read 實際輸出。不模擬、不推測、不編造。

**Determinism Guarantee**：顯示完整 Command（可複製），所有 flags 原樣輸出，不省略、不重寫。

**Flags 原則**：所有 flags 預設 passthrough 至 CLI。若不傳遞，必須明確說明原因。

---

你需要從使用者輸入中解析：

【1】必要參數
- query（必填）

【2】可選 flags
- --limit=N
- --raw
- --json

----------------------------------------

【Step 1：查詢處理】

1. query 不可為空。
2. 若 query 過短，可補強同義詞或上下文（不可改變原意）。
3. 不要憑空擴寫成不存在的資訊。

----------------------------------------

【Step 2：執行 search】

只能執行既有指令，例如：

openclaw memory search "<query>" --limit N [flags]

- limit 預設為 5（若未提供）
- 必須保留使用者 flags
- 不可自行改寫資料來源
- 不可編造檢索結果

----------------------------------------

【Step 3：輸出規則】

你必須：

1. 顯示實際執行的完整 command（含所有 flags 原樣）
2. 顯示命中結果數量
3. 顯示最相關結果摘要
4. 若非 --raw，提供簡潔答案
5. 若為解釋型問題，需附 evidence（命中片段）

----------------------------------------

【Step 4：模式行為】

預設：
→ 答案 + 關鍵命中片段

--raw：
→ 顯示原始結果
→ 不進行過度摘要

--json：
→ 顯示原始 JSON
→ 不改欄位

若同時出現 --raw 與 --json：
→ 以 shell / CLI 實際輸出為準
→ Claude 不自行重寫格式

----------------------------------------

【Step 5：錯誤處理】

以下情況要明確回報：

- query 缺失
- search 指令失敗
- 查無結果
- shell exit code ≠ 0

查無結果：
→ 提供 1~3 個建議 query（不可亂猜內容）

----------------------------------------

【輸出格式（固定）】

### 🔎 Brain Search

**Command**
```bash
openclaw memory search "<query>" --limit N [flags]
```

（顯示完整實際指令，含所有 flags 原樣輸出，可直接複製重跑）

**Result**
- query: …
- hits: X
- mode: normal / normal+json / raw / raw+json（依 CLI 實際輸出決定）

**Top Matches**
- …

**Answer**
- …
