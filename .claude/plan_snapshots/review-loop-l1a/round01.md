# review-loop-l1a — Context-Aware Review（帶歷史記憶）

> 基於 review_plan_loop v3.1（L0 Pre-flight + L3-B Timing）
> v4.0 升級路線圖第三優先項目（L1-A）

## 目標

在 `review_plan_loop.py` 中讓 GPT-4o 具備跨輪歷史感知，達到以下可量化目標：

1. 每輪審稿 prompt 包含最多 3 輪歷史摘要（VERDICT + IMP IDs），引導 AI 聚焦尚未解決的問題
2. 不重複提已解決的 IMP：APPROVED 輪的 IMP 標記為「已解決」
3. 新增函式 `build_history_context()` 約 30 行，其餘改動 < 5 行

## 非目標

- 不修改 CHECKLIST 或 state.json 格式
- 不改變 VERDICT 解析邏輯
- 不增加 API call 次數

## 里程碑

- M1：`build_history_context(round_num, paths, n_rounds=3)` 函式完成
- M2：`call_openai_review()` 加入 `history_context` 參數，prompt 更新
- M3：`main()` 串接：計算 history_context 後傳入 review call

## 風險

- **history 文件讀取失敗**（概率：低）：try/except 包裝每個文件讀取，失敗則跳過該輪，不中斷審稿
- **IMP 格式不符 `[IMP-NNN]`**（概率：低）：re 解析，格式不符則跳過，返回空列表

## 驗收標準

1. `round_num == 1` 時，`build_history_context()` 返回空字串，prompt 不含歷史段落
2. `round_num == 3` 時，prompt 含「前輪審稿記要」段落，包含 Round 01、Round 02 的摘要
3. 某輪 VERDICT=APPROVED 時，歷史摘要標示「本輪已解決」而非列出 IMP 為待解決
4. history 文件不存在時，靜默跳過，不拋出 Exception
5. 語法驗證通過：`python3 -c "import ast; ast.parse(...)"`

## Decision Log

- **2026-02-28**：只讀取 review-*-roundNN.md 中的 VERDICT 和 IMP，不重新解析 PLAN（降低複雜度）
- **n_rounds=3**：預設回溯 3 輪，足以讓 AI 感知趨勢，又不超過 context 限制
- **history_context 為空時不修改 prompt**：用 `f"{history_context}\n\n" if history_context else ""` 條件式插入
