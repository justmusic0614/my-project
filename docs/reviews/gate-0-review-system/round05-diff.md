# Diff — Round 05 vs Round 04

> 生成時間：2026-02-27 23:48:37

## 統計

- 新增：+27 行
- 刪除：-0 行
- 總 diff 行數：36


## Unified Diff

```diff
--- PLAN.md (前一輪快照)+++ PLAN.md (本輪)@@ -74,6 +74,33 @@ - [x] BLOCKED 時輸出 `decision: block`，Claude Code 正確阻擋 ✅（Round 03，6 個 IMP）
 - [x] 修正後再次 APPROVED，守門閉環完整驗證 ✅（Round 04）
 
+### M4 — Review Watch Dashboard（即時監控面板）
+
+**目標**：新增一個終端即時面板，讓開發者在 VS Code 中一眼看到審稿閉環的運作狀態，不需要手動翻 `docs/reviews/` 目錄。
+
+**產出物**：
+- [ ] `tools/review_watch_dashboard.py` — 純 Python（無第三方套件）即時面板
+- [ ] `.vscode/tasks.json` — VS Code Task 設定（Cmd+Shift+P → Run Task）
+
+**功能**：
+- 自動偵測 Current Round（優先讀 `.claude/review_state.json`，fallback 從檔名推斷）
+- 顯示 6 步驟進度條：`[✓]` 完成 / `[ ]` 等待 / `[!]` 過期或順序異常
+  1. PLAN 更新
+  2. OpenAI review 保存
+  3. Diff 保存
+  4. Summary 保存
+  5. Checklist 更新
+  6. Snapshot 保存
+- 顯示最後 verdict（APPROVED / NEEDS_REVISION / BLOCKED）
+- 顯示最新 summary 尾巴（18 行）
+- 卡住超過 20 秒警示（⚠️ STALLED）
+- 每 0.8 秒自動刷新
+
+**驗收標準**：
+1. `python3 tools/review_watch_dashboard.py` 在 project root 執行不報錯
+2. 面板顯示 Round 04、Verdict APPROVED
+3. VS Code Task 可正常啟動面板
+
 ---
 
 ## 風險

```
