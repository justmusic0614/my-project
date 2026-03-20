# Dogfood Report — YYYY-MM-DD

## 摘要

| 欄位 | 值 |
| --- | --- |
| **日期** | YYYY-MM-DD |
| **環境** | local / VPS |
| **Node.js** | vXX.XX.X |
| **測試範圍** | CLI + N 個 agents |
| **重點發現** | {一句話 ≤20 字，e.g., "5 個 agents 缺 agent.js；exit code 問題"} |

| 嚴重度 | 數量 |
| --- | --- |
| P0-Critical | 0 |
| P1-High | 0 |
| P2-Medium | 0 |
| P3-Low | 0 |
| **合計** | **0** |

## Issues

<!-- 每個 issue 複製以下區塊。發現即填入，不要延後。 -->

### ISSUE-001: {簡短標題}

| 欄位 | 值 |
| --- | --- |
| **分類** | CLI / CFG / STR / ERR / SRE / DX / SEC |
| **嚴重度** | P0 / P1 / P2 / P3 |
| **受影響** | {agent 名稱或 CLI} |
| **環境** | local / VPS / cron |

**描述**

{什麼壞了、預期什麼、實際發生什麼。}

**重現步驟**

```bash
# 1. 進入目錄
cd src/agents/xxx

# 2. 執行指令
node agent.js help

# 3. 觀察結果
# 預期：顯示使用說明
# 實際：{貼上 stdout/stderr}
# Exit code: X
```

**根因分析**

{簡要說明為什麼發生。}

**建議修復**

{一句話建議。}

---

## 附錄：Checklist 完成狀態

| 區塊 | 完成 | 總數 | 備註 |
| --- | --- | --- | --- |
| A. CLI 主進入點 | X | Y | |
| B. Agent 結構合規 | X | Y | |
| C. Agent 指令測試 | X | Y | |
| D. Config 驗證 | X | Y | |
| E. SRE 設施 | X | Y | |
| F. 錯誤處理 | X | Y | |
| G. 跨 Agent 一致性 | X | Y | |

---

## 備忘：trend 更新（Step 4）

**trend.md** append 格式：

| YYYY-MM-DD | env | scope | P0 | P1 | P2 | P3 | total | score | 趨勢 | 重點發現 |

**trend.jsonl** append 格式（v1 schema，一次性寫入完整一行）：

```json
{"v":1,"date":"YYYY-MM-DD","env":"local","scope":"...","P0":0,"P1":0,"P2":0,"P3":0,"total":0,"score":0,"score_delta":null,"trend_marker":"—","highlight_short":"...","highlight_tags":["ERR","CFG"],"highlight_type":"error"}
```

> trend 更新失敗時，告知使用者但不影響報告和 Step 5。
