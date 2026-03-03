# Social-Digest 評估框架（EVALUATION）

> **版本**: 2026-03-04
> **對應程式碼**: `src/shared/kpi-calculator.js`、`src/shared/contracts.js`

---

## 1. 核心哲學

Social-Digest 的價值 = **使用者每天花在晨報上的時間值不值得**。

- 主要指標衡量「AI 是否把好東西排在前面」
- 次要指標衡量「使用者是否點擊 / 互動」
- AI 的作用是 **輔助排序**，不是取代規則
- 若 AI 排序劣於規則排序 → Kill Switch 自動停用

---

## 2. 可觀測性

### 2.1 資料流

```
feedback (IMAP/click) → feedback 表
  ↓
buildFeedbackMap() → { post_id: max_rel }
  ↓
calcCTR / calcNDCG / calcNorthStar → daily KPI
  ↓
kpi_snapshots 表 (snapshot_type: 'daily')
  ↓
calcWeeklyReport → weekly KPI → kpi_snapshots (type: 'weekly')
  ↓
checkKillSwitch → kill-switch.json → agent.js 讀取
```

### 2.2 觀測檔案

| 檔案 | 位置 | 用途 |
|------|------|------|
| `kpi_snapshots` | DB 表 | 每日/每週 KPI 快照 |
| `kill-switch.json` | `data/runtime/` | AI 開關 runtime flags |
| `kill-switch.log` | `data/runtime/` | 觸發/恢復 audit log (JSONL) |
| `runs` 表 | DB | `ai_flags` JSON 欄位 |

---

## 3. 指標主次

### 主指標（決策依據）

| 指標 | 定義 | 用途 |
|------|------|------|
| **NDCG@20** | Normalized Discounted Cumulative Gain (K=20) | 衡量 AI 排序品質 |
| **North Star (NS)** | Σ max_rel(top_picks) / top_picks_count | 衡量 Top Picks 整體品質 |

### 次要指標（觀測用）

| 指標 | 定義 | 用途 |
|------|------|------|
| CTR_top | unique clicked top picks / top_picks_count | 點擊率（Top Picks） |
| CTR_all | unique clicked posts / total sent | 整體點擊率 |
| must_include_rate | must_include 進 Top Picks 的比例 | 漏報防護 |

---

## 4. 訊號權重

### Feedback → rel 映射

```
contracts.FEEDBACK_WEIGHTS = { pin: 3, good: 2, click: 1, mute: 0 }
contracts.REL_AGGREGATION = 'max'
```

**同一 post 多筆 feedback → 取最大值（不累加）**

| 場景 | 計算 |
|------|------|
| 使用者 click + good 同一篇 | rel = max(1, 2) = 2 |
| 使用者 pin + click 同一篇 | rel = max(3, 1) = 3 |
| 使用者 mute | rel = 0（不影響正向指標） |

理由：累加會讓重複行為導致分數膨脹，取最大值更穩定。

### Source Weight 調整

```
good → +0.1
pin  → +0.2
mute → -0.2
每 source 每日最多調整一次
weight ∈ [0.2, 3.0]
```

**每日回歸（防堆積）**：
```
weight = 1.0 + (weight - 1.0) * 0.98
```
效果：30 天無 feedback → weight 自然回歸至接近 1.0。

---

## 5. 指標定義

### 5.1 CTR

```
CTR_top = |unique clicked top_picks posts| / top_picks_count
CTR_all = |unique clicked posts| / total_sent_count
```

- C8: 用去重後 unique click（同一 post 多次 click 只算一次）
- D5: CTR_top 分母 = email 實際輸出的 `top_picks_count`（非 config max）

### 5.2 NDCG@K

```
DCG@K  = Σ_{i=1}^{K} rel_i / log₂(i + 1)
IDCG@K = DCG@K of ideal ranking (rels sorted descending)
NDCG@K = DCG@K / IDCG@K
```

- K = 20（Top Picks 最多 20 篇）
- rel_i = `feedbackMap[post_id] || 0`
- 若所有 post 的 rel = 0（無 feedback）→ NDCG = 0

### 5.3 North Star

```
NS = Σ max_rel(top_picks_posts) / top_picks_count
```

- 取值範圍：[0, 3]（最大 = 全部 pin）
- 典型健康值：0.5 ~ 1.5

---

## 6. Baseline-0 Shadow Run

### 定義

**Baseline-0 = 無 AI，只用 Phase 1 規則 + scorer（含 6 個新訊號）的排序結果**

### 流程

1. 以 Step 2 dedup 完的 posts list 作為**固定輸入快照**（C9）
2. 同時固定同一份 `rules.json` + 當日 weights snapshot（D6）
3. 僅切換 `ai_enabled`：on vs off
4. 兩組排序都用同一份 feedback 計算 NS
5. `baseline_0_ns` = shadow run 的 NS（近 4 週 rolling average）

### 觸發方式

```bash
node agent.js kpi --shadow   # 手動觸發
```

每週自動執行一次（由 KPI 計算流程觸發）。

---

## 7. A/B 校驗（Phase 3 預留）

Phase 3 可擴展：
- 隔日交替 AI on/off
- 或同一 run 產出兩組 Top Picks，隨機選一組寄出
- 統計顯著性檢驗：Wilcoxon signed-rank test

Phase 2 暫不實作，先用 Baseline-0 shadow run。

---

## 8. 校正順序

```
AI raw score (importance_score)
  ↓
_capLowConfidence()    # LOW confidence 非 must_include → cap 70
  ↓
importance_score_capped
  ↓
calcCalibratedScore()  # P50/P80 線性拉伸（winsorize 5%/95%）
  - 門檻 < 30 → skip 校正
  - C3 fallback: calibrated_score = importance_score_capped
  ↓
calibrated_score       # 最終排序 key
```

DB 存 raw score（`ai_results.importance_score`），cap/校正在 scorer 端執行。

---

## 9. Kill Switch

### Runtime Flags

```json
// data/runtime/kill-switch.json
{
  "ai_enabled": true,
  "triggered_at": null,
  "reason": null,
  "kpi_at_trigger": null,
  "cooldown_until": null,
  "auto_reenable_after_cooldown": false,
  "recovery_condition": "手動設 ai_enabled=true 後觀察一週"
}
```

### 觸發條件

```
rules.kill_switch = {
  ns_consecutive_days: 7,     // NS < baseline-0 連續 7 天
  ndcg_min: 0.4,              // NDCG < 0.4
  ndcg_consecutive_weeks: 2   // 連續 2 週
}
```

任一條件滿足 → 自動寫入 `ai_enabled: false`。

### 恢復

- 預設需**手動恢復**：編輯 `kill-switch.json` → `ai_enabled: true`
- 若 `auto_reenable_after_cooldown: true`：cooldown 結束後自動恢復
- Audit log：`data/runtime/kill-switch.log`（JSONL，每次觸發/恢復寫入一行）

---

## 10. 最小驗收 Checklist

### Phase 2 上線前

- [ ] `node agent.js run --dry-run` 正常執行，AI step 嘗試 → fail-open
- [ ] feedback 表能寫入 click/good/pin/mute
- [ ] `kpi-calculator.js` 手算 NDCG 結果吻合（DCG/IDCG/NDCG）
- [ ] Kill Switch：手動設 `ai_enabled: false` → AI step 跳過
- [ ] `calibrated_score` 永不為 null

### 持續驗證

- [ ] 每週檢查 weekly KPI report
- [ ] 每月比對 NS_AI vs baseline_0_ns
- [ ] Kill Switch audit log 有記錄
