# review-loop-l2c — CLI 直接觸發模式

> 基於 review_plan_loop v3.2（L0 Pre-flight + L3-B Timing + L1-A Context）
> v4.0 升級路線圖第四優先項目（L2-C）

## 目標

在 `review_plan_loop.py` 中加入 CLI 直接觸發模式，達到以下可量化目標：

1. `python3 .claude/hooks/review_plan_loop.py --run <slug>` 可直接執行完整審稿（計入輪次）
2. `--dry-run` 旗標：執行 Pre-flight + OpenAI review，但不更新 state.json / CHECKLIST / snapshot
3. 現有 hook 模式（從 stdin 讀取）完全不受影響（向後相容）

## 非目標

- 不實作完整 argparse CLI（argv 簡單解析即可）
- 不加入 `--list-plans` 等查詢命令（L4-C Overview Dashboard 的範疇）
- 不改變 review/diff/summary 文件的輸出格式

## 里程碑

- M1：抽取 `run_review(plan_slug, dry_run=False)` 函式，包含現有完整審稿邏輯
- M2：`main()` 加入 argv 路由，`--run` 指向 `run_review()`
- M3：驗證向後相容：hook 模式行為與 v3.2 完全一致

## 風險

- **重組引入迴歸**（概率：低）：run_review() 是直接移動現有邏輯，不改變行為；語法驗證 + 無 API key 冒煙測試可覆蓋
- **dry_run 洩漏狀態**（概率：低）：dry_run 時 `state["round"] -= 1` 且不呼叫 `save_state()`，確保不影響正式輪次計數

## 驗收標準

1. `python3 .claude/hooks/review_plan_loop.py --run gate-0-review-system` 在有 API key 時執行完整審稿
2. `--dry-run` 旗標：不更新 state.json（輪次不遞增）、不更新 CHECKLIST、不寫 snapshot
3. 無 `--run` 參數時：從 stdin 讀取 hook input，行為與 v3.2 完全相同
4. `--run` 缺少 slug 參數時：stderr 輸出用法說明，exit code 1
5. 語法驗證通過：`python3 -c "import ast; ast.parse(...)"`

## Decision Log

- **2026-02-28**：不使用 argparse（避免引入新依賴），直接 `sys.argv` 解析足夠
- **dry_run 仍寫 review 文件**：乾跑的主要用途是「測試 prompt 效果」，所以需要看到 review 輸出；不寫 CHECKLIST/snapshot 是為了不污染正式狀態
- **main() 縮短到 ~30 行**：核心邏輯移入 run_review()，main() 只做路由
