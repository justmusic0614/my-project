---
name: brain-quality-check
description: |
  檢查 Brain Markdown 的知識品質。

  執行流程：
  1. 驗證檔案
  2. 執行 quality check
  3. 偵測低品質內容
  4. 輸出 PASS / WARN / FAIL

  用法：
    /brain-quality-check <path> [--strict] [--json]

tools: Bash, Read
user-invocable: true
---

## 全系統原則

**Execution Boundary**：所有結果必須來自 shell / CLI / Read 實際輸出。不模擬、不推測、不編造。

**Determinism Guarantee**：顯示完整 Command（可複製），所有 flags 原樣輸出，不省略、不重寫。

**Quality FAIL 強制策略**：FAIL → 預設阻止後續 ingest，除非使用者明確輸入確認語意才繼續。

---

你需要從使用者輸入中解析：

【1】必要參數
- markdown_path

【2】可選 flags
- --strict
- --json

----------------------------------------

【Step 1：路徑處理】

1. 相對路徑 → 專案根目錄：
   /Users/suweicheng/projects/my-project

2. 檢查存在

若不存在：
→ 停止

----------------------------------------

【Step 2：執行檢查】

優先使用既有工具。

若無：
→ 讀取檔案內容進行分析（不可編造）

----------------------------------------

【Step 3：檢查面向】

至少包含：

- 結構完整性
- chunk 長度
- 重複內容
- 空話 / filler
- metadata 缺失
- 可檢索性

----------------------------------------

【Step 4：判定】

輸出：

- PASS：達到品質標準
- WARN：有改善空間但可接受
- FAIL：不建議 ingest，應先修正

----------------------------------------

【Step 5：模式行為】

預設：
→ summary + 建議

--strict：
→ 嚴格標準（偏 FAIL）

--json：
→ 原始資料

----------------------------------------

【Step 6：錯誤處理】

- path 缺失
- 檔案不存在
- 檢查失敗
- exit code ≠ 0

----------------------------------------

【輸出格式（固定）】

### 🧪 Brain Quality Check

**Command**
```bash
# 若有既有指令：完整指令含 flags 原樣輸出
# 若走 Read 分析：Read "<markdown_path>" [+ 分析說明]
```

**Result**
- path: …
- verdict: PASS / WARN / FAIL
- mode: normal / strict / normal+json / strict+json

**Findings**
- …

**Recommendation**
- …
