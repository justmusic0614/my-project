---
name: bug-fix
description: |
  Bug 修復工作流程。當使用者報告 bug 或要求修復問題時使用。
  強制根因分析，避免 debug 迴圈。
tools: Read, Grep, Glob, Edit, Write, Bash
---

## Bug 修復流程（4 步）

1. **分析根因** — 不要盲目加 debug log
2. **追蹤資料流** — 從輸入 → 處理 → 輸出，找出哪裡斷了
3. **確認修復** — 在所有相關環境驗證，清除 debug log 再 commit
   - [ ] local 執行正常
   - [ ] VPS 手動執行正常（若涉及 VPS）
   - [ ] VPS cron 執行正常（若涉及 cron）
4. **一次修好** — 不要分成 debug commit + fix commit

> ⚠️ **嚴禁提交 `debug:` 前綴的 commits**
> debug 代碼只在 working directory 中存在，分析完立即刪除。
> 若你已提交 debug commits，說明你跳過了根因分析步驟，請回到 Step 1。

## Bug 報告資訊收集

修復前確認用戶提供：

- **症狀** — 具體錯誤訊息或異常行為
- **環境** — local / VPS / cron
- **頻率** — 每次 / 偶爾 / 特定條件
- **重現步驟** — 1, 2, 3...
- **已嘗試** — 排除了什麼可能
- **錯誤日誌** — 完整 error output

若缺少關鍵資訊，主動向用戶詢問。

## 反模式警示

### industryThemes 案例（5 commits → 本可 1）

```
❌ 錯誤流程：
  第 1 輪：加 debug log → 沒找到
  第 2 輪：換 console.log → 還是沒找到
  第 3 輪：加更多 logging → 終於找到
  第 4 輪：修復
  第 5 輪：清除 debug log

✅ 正確流程：
  分析：Phase 2 有資料，Phase 3 沒有 → 問題在 Phase 2→3 之間
  追蹤：ai-analyzer.js analyze() → Stage 2 fallback 路徑
  修復：一次修好，無殘留 log
```

### FRED + industryThemes 重演案例（2026-02-20，7 commits → 本可 1）

```
❌ 實際發生：
  debug: 加入 FRED API 請求詳細 logging
  debug: 加入 Phase3 aiResult logging
  debug: 改用 console.log 查看 industryThemes
  debug: 加入 Stage 2 industryThemes 原始值 logging
  fix(fred): 改用 curl 執行 API 請求
  fix(ai-analyzer): Stage 2 fallback 補上 industryThemes 欄位
  chore: 移除 debug logging（產業熱點已修復）

✅ 正確流程：
  分析：FRED 請求 → 確認是 HTTP 超時問題（非格式問題）
  分析：industryThemes 缺失 → 確認 analyze() 返回值遺漏欄位（非 Stage 2 問題）
  修復：一次修好兩個獨立問題，無 debug commits，無 chore 清除
```

### 根因分析思路

1. 確認資料在哪一層消失（收集→轉發→處理→驗證→渲染→推播）
2. 檢查該層的所有分支路徑（特別是 fallback / error handling）
3. 確認 schema 是否對齊（上游改了欄位名，下游沒跟上）
