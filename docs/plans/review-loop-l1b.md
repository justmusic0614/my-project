# review-loop-l1b — Reviewer Personas（多角色審稿）

> 基於 review_plan_loop v3.4（L0 + L3-B + L1-A + L2-C + L1-C）
> v4.0 升級路線圖 L1-B

## 目標

在 `review_plan_loop.py` 中支援多角色審稿，達到以下可量化目標：

1. PLAN frontmatter 可指定 reviewer 組合（`reviewers: [engineer, security, devops]`），無 frontmatter 時預設 `engineer` 向後相容
2. 各 persona 以 ThreadPoolExecutor 平行呼叫 OpenAI，總耗時 ≈ 單次（非 N 倍）
3. 取最嚴格 VERDICT：任一 persona NEEDS_REVISION → 合併結果 NEEDS_REVISION
4. 新增函式 `parse_reviewers()` 約 15 行，新增 `REVIEWER_PERSONAS` 字典約 8 行，其餘改動 < 25 行

## 非目標

- 不新增 persona 以外的 review 維度調整（L1-A/L1-C 的範疇）
- 不修改 CHECKLIST 或 state.json 格式
- 不支援自訂 persona prompt（固定 4 個內建 persona）

## 里程碑

- M1：新增 `REVIEWER_PERSONAS` 字典（4 個 persona：engineer / security / devops / pm）
- M2：新增 `parse_reviewers(plan_content) -> list` 解析 frontmatter `reviewers:` 欄位
- M3：修改 `call_openai_review()` 加入 `persona: str = "engineer"` 參數
- M4：修改 `run_review()` — ThreadPoolExecutor 平行呼叫 + 合併 VERDICT + 合併 review_content

## 風險

- **ThreadPoolExecutor 異常**（概率：低）：`f.result()` 若拋出異常，視為 `"NEEDS_REVISION"` review，不中斷流程
- **API rate limit**（概率：低）：3–4 個 persona 同時呼叫可能觸發 OpenAI rate limit；緩解：`max_workers=min(len(reviewers), 4)` 上限 4
- **合併 review_content IMP 編號衝突**（概率：低）：各 persona 各自編排 IMP-NNN，合併後可能有重複 ID；緩解：IMP 解析從合併文本執行，重複 ID 取最後一個（無資料遺失）

## 驗收標準

1. `parse_reviewers("---\nreviewers: [engineer, security]\n---\n## 目標")` 返回 `["engineer", "security"]`
2. 無 frontmatter 的 PLAN → 返回 `["engineer"]`，hook 行為與 v3.4 完全相同
3. `reviewers: [engineer, security, devops]` → review 文件含 3 個 `## [... PERSONA]` 區塊
4. 任一 persona VERDICT=NEEDS_REVISION → 合併 VERDICT=NEEDS_REVISION（即使 engineer APPROVED）
5. 語法驗證通過：`python3 -c "import ast; ast.parse(...)"`

## Decision Log

- **2026-02-28**：選擇 ThreadPoolExecutor（stdlib）而非 asyncio，與現有同步程式碼架構一致，無需重構
- **REVIEWER_PERSONAS 固定 4 個**：可擴展但不先做，避免 over-engineering
- **合併 review_content 格式**：各 persona 以 `## [PERSONA PERSONA]` 分隔，parse_imp_ids/parse_imp_resolutions 在合併文本執行，一次解析覆蓋所有 persona 問題
- **verdict 取最嚴格**：`min(verdicts, key=lambda v: VERDICT_PRIORITY.get(v, 1))`，BLOCKED=0 < NEEDS_REVISION=1 < APPROVED=2
