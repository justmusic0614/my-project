# Diff — Round 07 vs Round 06

> 生成時間：2026-02-27 23:49:28

## 統計

- 新增：+16 行
- 刪除：-0 行
- 總 diff 行數：22


## Unified Diff

```diff
--- PLAN.md (前一輪快照)+++ PLAN.md (本輪)@@ -151,3 +151,19 @@ **Hook 回傳**：使用 JSON `{"decision": "block"/"continue", ...}` 而非單純 feedback 文字
 
 **狀態**：Gate-0 建立中（2026-02-27）
+
+### 2026-02-27 — M4 Review Watch Dashboard
+
+**決策**：新增 `tools/review_watch_dashboard.py` 即時監控面板 + `.vscode/tasks.json` VS Code Task
+
+**原因**：審稿閉環運作時，開發者需反覆翻閱 `docs/reviews/` 確認進度和 verdict，效率低且容易漏看。需要一個即時面板一眼掌握 6 步驟進度。
+
+**方案選擇**：
+- ~~方案 A：VS Code Extension~~（開發成本過高，不合比例）
+- ~~方案 B：Web Dashboard~~（需要 http server，過度工程）
+- ✅ **方案 C：純 Python 終端面板 + VS Code Task**（零依賴、0.8 秒輪詢、一鍵啟動）
+
+**技術決策**：
+- 加 `from __future__ import annotations` 確保 Python 3.9+ 相容
+- 使用 ANSI escape codes 清屏，不依賴 curses
+- 優先從 `.claude/review_state.json` 推斷 round，fallback 從檔名 glob

```
