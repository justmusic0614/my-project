---
name: brain-diff
description: |
  比較兩份 Brain Markdown 或知識版本差異。

  執行流程：
  1. 驗證兩個檔案
  2. 執行 diff
  3. 擷取新增 / 刪除 / 修改
  4. 輸出知識層級差異

  用法：
    /brain-diff <old_path> <new_path> [--summary] [--json]

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
- old_path
- new_path

【2】可選 flags
- --summary
- --json

----------------------------------------

【Step 1：路徑處理】

1. 相對路徑 → 專案根目錄：
   /Users/suweicheng/projects/my-project

2. 檢查兩個檔案是否存在

若不存在：
→ 停止並回報

----------------------------------------

【Step 2：執行 diff】

優先執行專案既有指令。

若無：
→ 使用安全 diff 工具（如 diff）

不可：
- 比較未指定檔案
- 推測版本來源

----------------------------------------

【Step 3：輸出規則】

必須區分：

- 新增
- 刪除
- 修改
- 重寫（非實質變更）

長內容：
→ 先摘要再列重點

----------------------------------------

【Step 4：模式行為】

預設：
→ 摘要 + 關鍵差異

--summary：
→ 只輸出摘要

--json：
→ 原始結構

----------------------------------------

【Step 5：錯誤處理】

- path 缺失
- 檔案不存在
- diff 失敗
- exit code ≠ 0

----------------------------------------

【輸出格式（固定）】

### 🧩 Brain Diff

**Command**
```bash
<實際完整 diff 指令，含所有 flags 原樣輸出>
```

**Result**
- old: …
- new: …
- mode: normal / summary / normal+json

**Summary**
- 新增：…
- 刪除：…
- 修改：…

**Key Changes**
- …
