# Market Digest Pipeline Configuration

## Finalized Settings

### ① Taiwan Core 範圍（嚴格版）
**保留條件：**
- (台積電/聯電/鴻海) + (財報/投資/擴廠/產能/技術/供應鏈)
- 或 (央行/財政部/金管會) + 台灣政策

**排除：**
- 個股分析師建議
- 政治人物評論（非正式政策）
- 非 mega cap 個股

### ② Clickbait 判斷（看內容不看標題）
**策略：**
- 保留重要資訊，即使標題聳動
- 改寫標題為中性語氣
- 移除：驚嘆號、情緒動詞、clickbait 用詞

**改寫範例：**
- 「比特幣暴跌！」→「比特幣下跌」
- 「專家曝光藏寶圖」→ (移除 clickbait 詞)

### ③ Confidence Level 判斷（週末寬容）
**HIGH confidence:**
- 所有數據都是 A 或 B 級

**MEDIUM confidence:**
- 存在 C 級（延遲）但無 D 級
- **週末時延遲數據視為正常** ✅

**LOW confidence:**
- 存在 D 級（缺失）
- 或平日時全是 C/D（異常延遲）

**報告呈現差異：**
| Confidence | 新聞數量 | Risk Radar | 警示 |
|-----------|---------|-----------|------|
| HIGH | 12 則 | ✅ | 無 |
| MEDIUM | 12 則 | ✅ | 無（週末） |
| LOW | 3-5 則 | ❌ | ⚠️ Data limited |

## Event Deduplication
每個事件只出現一次，不跨 section 重複。

## Max Events
總計 ≤ 12 則新聞

## Market Regime
ONE sentence summary + Key Data

## 最後更新
2026-02-01
