# Diff — Round 04 vs Round 03

> 生成時間：2026-02-27 20:42:47

## 統計

- 新增：+115 行
- 刪除：-5 行
- 總 diff 行數：131


## Unified Diff

```diff
--- PLAN.md (前一輪快照)+++ PLAN.md (本輪)@@ -1,13 +1,123 @@-# PLAN.md — M3 驗證用（刻意品質差版本）
+# PLAN.md — review_plan_loop 自動審稿閉環系統 v2.3.3
+
+> **版本**: 1.0.0-draft
+> **建立日期**: 2026-02-27
+> **負責人**: Claude Code
+
+---
 
 ## 目標
-優化系統，讓它更好。
+
+在現有 my-project repo 中建立一套「計劃文件品質守門」機制：
+每次 `docs/PLAN.md` 被 Write/Edit，自動觸發 OpenAI 審稿回圈，
+強制確保計劃達到「可實作」標準後才允許進入 feature 實作。
+
+**核心訴求**：
+- 防止倉促進入實作（沒有清楚目標/驗收標準就開始寫 code）
+- 建立跨輪可追溯的審稿歷史（review / diff / summary）
+- 用累積 Checklist（stable IDs）追蹤所有待修問題
+
+---
 
 ## 範圍
-做一些改進。
+
+**本系統涵蓋**：
+- `.claude/hooks/review_plan_loop.py`（核心腳本 v2.3.3）
+- `.claude/settings.json` PostToolUse hook 設定
+- `docs/reviews/`（審稿輸出目錄）
+- `.claude/plan_snapshots/`（快照目錄，逐輪保留）
+- `docs/reviews/CHECKLIST.md`（累積 Checklist）
+
+**適用範圍**：
+- 只監控 `docs/PLAN.md`，不監控其他文件
+- 本地開發環境（需要 OPENAI_API_KEY）
+
+---
+
+## 非目標
+
+- **不監控** src/ 下的程式碼文件
+- **不自動提交**（commit 仍由 Claude Code 手動觸發）
+- **不替代** 人工 Code Review（只審 PLAN.md 品質）
+- **不支援** 多個 PLAN 文件並行（單一 docs/PLAN.md）
+- **不修改** 現有 SessionStart hook 或 permissions
+
+---
 
 ## 里程碑
-- 做完就好
+
+### M1 — Gate-0 完成（本次目標）
+
+**產出物**：
+- [x] `docs/PLAN.md` 存在（本文件）
+- [x] `.claude/hooks/review_plan_loop.py` 存在且可執行
+- [x] `.claude/settings.json` 已加入 PostToolUse hook
+- [x] `docs/reviews/` 目錄存在
+- [x] `docs/reviews/CHECKLIST.md` 存在
+
+**驗收**：手動模擬 hook 呼叫後，生成 4 個預期文件 ✅（2026-02-27 完成）
+
+### M2 — 首次真實閉環
+
+**產出物**：
+- [x] 真實觸發 hook（Claude Code 寫 PLAN.md）
+- [x] `docs/reviews/review-20260227-203639-round01.md` 自動生成
+- [x] `docs/reviews/round01-diff.md` 自動生成
+- [x] `docs/reviews/round01-diff-summary.md` 自動生成
+- [x] GPT-4o VERDICT = APPROVED，`decision: continue` ✅（2026-02-27）
+
+### M3 — 多輪驗證
+
+**產出物**：
+- [x] Round 2+ 正常執行（Round 02 基於 Round 01 快照生成 diff）✅
+- [x] APPROVED 時輸出 `decision: continue` ✅
+- [x] BLOCKED 時輸出 `decision: block`，Claude Code 正確阻擋 ✅（Round 03，6 個 IMP）
+- [x] 修正後再次 APPROVED，守門閉環完整驗證 ✅（Round 04）
+
+---
+
+## 風險
+
+| 風險 | 概率 | 影響 | 緩解措施 |
+|------|------|------|----------|
+| OPENAI_API_KEY 未設定 | 中 | 低 | 腳本 graceful skip，不阻擋工作 |
+| openai 套件未安裝 | 中 | 低 | 同上，stderr 警告 |
+| Hook stdin JSON 格式與預期不符 | 低 | 中 | 腳本對 stdin 做防錯解析（try/except） |
+| OpenAI API 回傳格式異常 | 低 | 中 | VERDICT 解析失敗時預設 NEEDS_REVISION |
+| PLAN.md 超過 16000 字元 | 低 | 低 | 截斷後送 OpenAI，加 [TRUNCATED] 標記 |
+| MAX_ROUNDS 耗盡 | 低 | 低 | 超過後腳本 graceful exit，不阻擋 |
+
+---
+
+## 驗收標準
+
+1. **可測試觸發**：執行 `python3 -c "..."` 模擬 hook 呼叫後，
+   `docs/reviews/` 目錄下生成 3 個文件（review/diff/summary）
+
+2. **CHECKLIST 累積**：第一輪後 CHECKLIST.md 包含至少 1 個 `IMP-NNN` 條目
+
+3. **decision 格式正確**：stdout 輸出合法 JSON，包含 `"decision"` 欄位
+
+4. **過濾生效**：修改非 `docs/PLAN.md` 的文件時，hook 不觸發（exit 0，無輸出）
+
+5. **MAX_ROUNDS 生效**：state.round >= 8 時，hook 不執行審稿，直接 exit 0
+
+---
 
 ## Decision Log
-無。
+
+### 2026-02-27 — 初始建立
+
+**決策**：建立 review_plan_loop.py v2.3.3 作為 PostToolUse hook
+
+**原因**：現有 settings.json 只有 SessionStart hook，缺少計劃品質守門機制
+
+**方案選擇**：
+- ~~方案 A：建立 Skill~~（用戶手動觸發，不夠強制）
+- ✅ **方案 B：PostToolUse Hook + decision:block**（每次 PLAN.md 修改自動觸發，強制性最高）
+
+**快照方案**：A（round00.md, round01.md...），另存 latest.md 作為指標
+
+**Hook 回傳**：使用 JSON `{"decision": "block"/"continue", ...}` 而非單純 feedback 文字
+
+**狀態**：Gate-0 建立中（2026-02-27）

```
