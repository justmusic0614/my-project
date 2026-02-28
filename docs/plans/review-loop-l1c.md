# review-loop-l1c — IMP Resolution Verification（問題解決有 evidence）

> 基於 review_plan_loop v3.3（L0 Pre-flight + L3-B Timing + L1-A Context + L2-C CLI）
> v4.0 升級路線圖 L1-C

## 目標

在 `review_plan_loop.py` 中讓每個已解決的 IMP 都有可追溯的 evidence，達到以下可量化目標：

1. CHECKLIST 中 `✅` 的 IMP 條目，Evidence 欄位填入 AI 提供的一句話解決說明（非 `-`）
2. review prompt 新增格式要求：已解決 IMP 用 `✅ [IMP-NNN] RESOLVED: <evidence>` 列出
3. 新增函式 `parse_imp_resolutions()` 約 10 行，其餘改動 < 10 行

## 非目標

- 不強制要求每個 APPROVED 輪都有 resolution evidence（AI 不提供則 evidence 維持 `-`）
- 不修改 `[IMP-NNN]` ID 格式或 CHECKLIST 表格欄位結構
- 不增加 API call 次數

## 里程碑

- M1：修改 `call_openai_review()` prompt，加入 `✅ [IMP-NNN] RESOLVED:` 格式要求
- M2：新增 `parse_imp_resolutions(review_content) -> dict`
- M3：修改 `update_checklist()` 加入 `imp_resolutions` 參數，APPROVED 時寫入 evidence
- M4：`run_review()` 串接：`parse_imp_resolutions()` + 傳入 `update_checklist()`

## 風險

- **AI 不遵守 RESOLVED 格式**（概率：低）：`parse_imp_resolutions()` 找不到符合格式的行時返回空 dict，evidence 維持 `-`，不中斷流程
- **evidence 過長**（概率：低）：截短為 80 字元，避免 CHECKLIST 表格過寬

## 驗收標準

1. `parse_imp_resolutions('✅ [IMP-001] RESOLVED: 新增驗收標準章節')` 返回 `{'IMP-001': '新增驗收標準章節'}`
2. review prompt 包含 `✅ [IMP-NNN] RESOLVED:` 格式說明
3. APPROVED 且 AI 提供 resolution evidence 時，CHECKLIST Evidence 欄位非 `-`
4. AI 未提供 resolution evidence 時，evidence 維持 `-`，不拋出 Exception
5. 語法驗證通過：`python3 -c "import ast; ast.parse(...)"`

## Decision Log

- **2026-02-28**：evidence 截短 80 字元而非 60 字元（現有 desc 截短 60，evidence 較長允許更多空間）
- **不強制 AI 提供 evidence**：AI 有時確實無法判斷 diff 對應哪個 IMP，強制則增加 hallucination 風險
- **RESOLVED 格式與 ⚠️ 格式並存**：同一問題清單區塊，讓 AI 可同時列出待解決與已解決項
