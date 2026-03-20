# Dogfood Trend

> 每次 dogfood 掃描後自動更新（Step 4 結束前）。

## Score 公式

```text
score = P0×10 + P1×5 + P2×2 + P3×1
```

## 趨勢箭頭

- 與前一行 score 比較：↑ 增加 / ↓ 減少 / → 持平
- `*` = scope 不同，趨勢僅供參考（e.g., `↓*`）
- 首行：`—`

## Scope 規範

scope 應描述掃描範圍，必要時加入模式（full / quick / agents-only），避免不同深度掃描被誤視為可比。

## 統計趨勢

| 日期 | 環境 | 範圍 | P0 | P1 | P2 | P3 | 合計 | Score | 趨勢 | 重點發現 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-03-19 | local | market-digest | 1 | 1 | 2 | 2 | 6 | 21 | — | agent.js crash；config 不合規 |
| 2026-03-20 | local+VPS | market-digest（整合） | 1 | 1 | 3 | 3 | 8 | 24 | ↑ | Local/VPS drift；exit code |
| 2026-03-20 | local | full（7 agents+CLI） | 0 | 3 | 2 | 1 | 6 | 20 | ↓* | 4 agents 缺 agent.js |

## Observations

- **P0 趨勢**：2026-03-20 全面掃描歸零（institutional-renderer 問題已修復）
- **P1 趨勢**：全面掃描時 3 個，主要為 agent-template 合規性問題（多 agent 首次涵蓋）
- **常見類別**：STR（結構合規）和 CFG（config schema）反覆出現
- **檢查廣度**：3/19 → 1 agent，3/20 整合 → 1 agent（dual env），3/20 全面 → 8 targets

## 更新規則

1. 每次掃描後 append 一行，不改動前面的行
2. 趨勢箭頭與前一行的 score 比較；若 scope 不同則加 `*`
3. 若同一天有多次掃描（不同 scope），各自單獨一行
4. 重點發現控制在 20 字以內
