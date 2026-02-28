# review-loop-upgrade — L0 Pre-flight Suite + L3-B Timing Profiler

> 基於 review_plan_loop v3.0（multi-plan + per-plan reviews + human confirm）
> 本 PLAN 覆蓋 v4.0 升級路線圖中的前兩個優先項目

## 目標

在 `review_plan_loop.py` 中新增以下功能，達到可量化目標：

1. **L0 Pre-flight Suite**：在 OpenAI call 之前，在本地攔截 6 類問題（結構缺失、模糊動詞、複雜度暴增、依賴未核准、計劃過期、測試覆蓋不足），其中結構缺失和依賴未核准直接 block，零 API 成本
2. **L3-B Timing Profiler**：每輪審稿時間精度 0.01 秒，存入 `state.json` 的 `last_timing` 欄位，並即時輸出到 stderr

## 非目標

- 不修改 OpenAI 審稿 prompt 邏輯（L1 Smarter Review 的範疇）
- 不新增 CLI 觸發模式（L2-C 的範疇）
- 不修改 CHECKLIST 或 snapshot 功能

## 里程碑

- M1：Pre-flight Suite 實作完成（6 個子函式 + `run_preflight()`）
- M2：Timing Profiler 整合到 `main()`，`state.json` 包含 `last_timing` 欄位
- M3：整合測試通過（語法驗證 + Pre-flight block 行為確認）

## 風險

- **0-B 語言 Linter 誤報**（概率：低）：已加入量化條件判斷（同句含數字/% 則不觸發）；緩解：警告性而非阻擋性，不影響正常流程
- **0-F 測試覆蓋 hint 誤報**（概率：中）：`src/test/` 不存在或無 `.test.js` 時直接跳過；緩解：APPROVED 時才觸發，僅提示
- **0-C 複雜度指數計算不準確**（概率：低）：啟發式公式，第一輪無比較基準直接跳過；緩解：警告性，不阻擋

## 驗收標準

1. 缺少 `## 目標`、`## 驗收標準` 或 `## Decision Log` 章節的 PLAN → Pre-flight `decision: block`，stderr 顯示 `✗ 缺少必要章節`，不消耗 OpenAI API
2. 含有 `depends_on:` 但依賴 slug 未 APPROVED → Pre-flight block，提示依賴狀態
3. 目標章節含模糊動詞且同句無量化條件 → 警告附加在 decision reason 中（不阻擋 API call）
4. 每輪審稿後 `state.json` 包含 `last_timing: {diff, review, summary, total}`（浮點，精度 0.01s）
5. stderr 輸出格式：`timing: diff=Xs  review=Xs  summary=Xs  total=Xs`
6. Pre-flight 有錯誤時：`state["round"]` 不遞增（不計入正式輪次）

## Decision Log

- **2026-02-28**：決定合併實作 L0 Pre-flight Suite + L3-B Timing（計劃 v4.0 優先表最高兩項），合計約 140 行，零 API 成本，立即有感
- **0-D 解析方式**：用 `re` 解析 YAML frontmatter，不引入 PyYAML 依賴（避免新增第三方庫）
- **阻擋/警告分類**：阻擋（0-A 結構、0-D 依賴）直接 block；警告（0-B 語言、0-C 複雜度、0-E 過期、0-F 測試）附加在 decision reason 中
- **Pre-flight 不計輪次**：Pre-flight block 時 `state["round"] -= 1`，維持 round 計數準確性
