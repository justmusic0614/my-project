# 與 Claude Code 高效溝通指南（歸檔）

> 原始來源：`~/.claude/projects/.../memory/effective-prompts.md`
> 歸檔日期：2026-02-24
> 說明：Layer 1-3 已遷移至 `.claude/skills/task-planning/`，以下為 Layer 4-6 教育內容歸檔

---

## 第四層：真實 Before/After 案例

### 案例 1：FRED 資料整合（7 commits → 本可 1-2）

**時間線：**

```
f70b8ef fix(phase1): result 加入 marketData 欄位        ← 收集層遺漏
e9d6463 fix(fred): 加入 10 秒 HTTP 請求超時設定          ← 環境限制未說明
f6a87a5 debug: 加入 FRED API 請求詳細 logging            ← debug 迴圈開始
19cf1b5 fix(fred): 改用 curl 執行 API 請求               ← 試錯
2ecfa8a fix(phase3): collectedData 加入 FRED 資料         ← 處理層遺漏
65c8073 fix(validator): 加入 FRED 資料處理                ← 驗證層遺漏
2bfcecf fix(phase2): phase1Ref 加入 FRED 資料             ← 轉發層遺漏
```

**根因：** 只說了「整合 FRED API」，沒有列出 pipeline 每層的影響。

**預防方式：** 使用任務模板 C（整合新資料源），逐層列出影響。

---

### 案例 2：cron 環境問題（4 commits → 本可 1）

**時間線：**

```
b921f6c fix(sre): 修復 execSync 阻塞事件循環導致 health check ETIMEDOUT
686bb7f fix(sre): security-patrol execSync timeout + 排程衝突修復
8620993 fix(security-patrol): 改善進程監控 — systemd is-active + 重啟迴圈偵測
608b801 fix(security-patrol): 修復 cron 環境 systemctl --user 失敗 — 加入 XDG_RUNTIME_DIR
```

**根因：** 沒有說明是在 cron 環境執行。cron 沒有 interactive shell 的環境變數。

**預防方式：** Checklist 第 1 項「目標環境」+ 查閱 environments.md。

---

### 案例 3：industryThemes debug 迴圈（5 commits → 本可 1）

**時間線：**

```
41a9d1c debug: 加入 Stage 2 industryThemes 原始值 logging   ← 第 1 輪 debug
a59a25c debug: 改用 console.log 查看 industryThemes         ← 第 2 輪 debug
25613ba debug: 加入 Phase3 aiResult logging                  ← 第 3 輪 debug
0f61a58 fix(ai-analyzer): Stage 2 fallback 補上 industryThemes 欄位  ← 找到了
8f255ec fix(ai-analyzer): analyze() 加入 industryThemes 到返回值     ← 修復
```

**根因：** 沒有描述具體症狀和已知的資料流，盲目加 log 而非分析根因。

**預防方式：** 使用任務模板 B（Bug 修復），提供完整症狀 + 懷疑的程式碼路徑。

---

## 第五層：Anthropic 官方技巧精華

### 8 大 Prompt Engineering 技巧（按效果排序）

1. **清楚直接** — 把 Claude 當聰明但有失憶症的新員工。提供：任務目的、目標受眾、成功標準。用編號步驟給指示。
2. **使用範例** — 3-5 個多樣化範例是最有效的單一工具。用 `<example>` 標籤包裝。
3. **讓 Claude 思考** — 複雜任務加「Think step-by-step」或用 `<thinking>` 標籤。沒有輸出思考過程就不會有真正的思考。
4. **使用 XML 標籤** — 分離 prompt 的不同部分：`<instructions>`、`<context>`、`<data>`。提高準確性和可維護性。
5. **系統提示/角色** — 設定 Claude 的角色可增強準確度、定制語調、改善聚焦。
6. **鏈接複雜提示** — 大任務分解為子任務鏈：生成 → 審查 → 精煉 → 再審查。
7. **長上下文技巧** — 長文件放最上方，查詢和指示放下方。要求先引用再回答。
8. **Prompt 初稿生成** — 複雜任務先說「幫我草擬這個任務的 prompt 框架」，讓 Claude 生成結構後你再填入細節。

### 範例實戰：何時 + 如何用 `<example>`

**什麼時候值得花時間寫範例？**

```
✅ 值得加 <example> 的情境：
  1. 輸出格式有特定要求（JSON 欄位名稱、順序）
  2. 文字語氣/風格需要一致（日報敘述口吻）
  3. 邊界案例需要明確處理（API 失敗時的 fallback）
  4. 複雜的輸入→輸出映射（多 API 欄位標準化）

❌ 不需要加：任務直觀（Claude 通常做對），或範例比指示更難寫
```

**原則：範例要「多樣化」— 不要 3 個相似的，要覆蓋正常/邊界/錯誤三種情境。**

---

**Type A：輸出格式**（告訴 Claude 你要的 JSON 結構）

```
<example>
輸入：FMP API 回傳 AAPL 資料
輸出：
{
  "symbol": "AAPL",
  "price": 180.5,
  "changePercentage": 1.2,
  "timestamp": "2026-02-22T09:30:00Z"
}
</example>
```

→ 解決欄位名稱不一致（過去踩過 `changesPercentage` vs `changePercentage`）

---

**Type B：文字語氣**（兩個範例覆蓋漲/跌，強迫多樣化）

```
<example>
資料：S&P 500 -1.2%，VIX 18.5
日報：標普 500 今日收跌 1.2%，收於 4,850 點。VIX 18.5，市場情緒偏謹慎。
</example>

<example>
資料：S&P 500 +0.8%，VIX 14.2
日報：標普 500 今日小幅上揚 0.8%，VIX 14.2 處於低位，風險偏好回升。
</example>
```

→ 解決 Claude 輸出語氣每次不一致的問題

---

**Type C：邊界案例**（API 失敗時的 fallback 期望行為）

```
<example>
情境：FRED API 請求超時（10 秒無回應）
期望行為：
- marketData.fred 設為 null
- 日報顯示「FRED 數據暫不可用」
- 不拋出例外，繼續處理其他資料源
</example>
```

→ 解決邊界案例不明確，Claude 亂猜 fallback 行為

---

**Type D：Bug 描述格式**（給 Claude 一個你要的問題描述結構）

```
<example>
症狀：日報 industryThemes 區塊空白
發生時機：每次執行，非偶發
已確認：Phase 2 RSS 有資料（日誌可見）
懷疑位置：ai-analyzer.js analyze() Stage 2 fallback 路徑
驗收：node agent.js 後 /today 日報有產業熱點
</example>
```

→ 解決 Bug 描述太模糊，進入 3 輪 debug 迴圈

---

**Type E：多來源欄位標準化**（3 個範例覆蓋不同 API，避免猜測映射邏輯）

```
<example>
來源：FMP    原欄位：changePercentage: 1.2       → 標準化：change: 1.2
</example>

<example>
來源：Yahoo  原欄位：regularMarketChangePercent: -0.5  → 標準化：change: -0.5
</example>

<example>
來源：FRED   原欄位：value: "5.25"（字串）      → 標準化：fedRate: 5.25（數字）
</example>
```

→ 解決多 API 整合時欄位映射邏輯不清楚

---

### Claude 4.6 專屬注意事項

- **不要反偷懶提示：** 移除「be thorough」「think carefully」「do not be lazy」— 4.6 已經足夠主動，這些反而造成過度思考。
- **行動語氣：** 說「改這個函式提升效能」而非「你可以建議怎麼改嗎」。
- **範例決定一切：** 4.6 會非常仔細模仿範例中的每個細節，確保範例正確。
- **CLAUDE.md 長度：** 太長會被忽略。無情剪裁，關鍵規則轉為 hook。
- **並行工具呼叫：** 4.6 擅長同時執行多個獨立工具，不需要串行。

### Claude Code 最高槓桿率策略

1. **給驗證方式（最重要）：** 寫完程式碼後要求「run tests」「take a screenshot and compare」。讓 Claude 能自己驗證工作品質。
2. **先探索再規劃再編碼：** 複雜任務用 Plan Mode 探索 → 規劃 → 實作 → 提交。
3. **提供具體上下文：** 限定範圍、指向來源、參考現有模式。
4. **管理 Session：** 不相關任務之間 `/clear`。兩次修正失敗後 `/clear` 重寫。

### 驗收條件實戰：怎麼寫才讓 Claude 能自我驗證

**壞 vs 好（一眼看懂差異）：**

```
❌ 壞的驗收條件（Claude 無法自我驗證）：
  - 「確認它能正常運作」
  - 「測試 FRED 功能」
  - 「沒有 bug」

✅ 好的驗收條件（Claude 可以自己跑指令驗證）：
  - 「執行 node agent.js，phase1-output.json 包含 marketData.fred，值為數字」
  - 「pm2 logs market-digest 無 Error 字樣，連續 3 次正常」
  - 「git diff config.json：systemLoadThreshold 從 0.9 → 1.5，無其他變更」
```

**5 種驗收條件類型（對應不同任務）：**

**Type 1：指令型**（新功能、API 整合）

```
驗收：node agent.js --dry-run
預期：輸出包含 { marketData: { fred: { fedRate: 5.25 } } }
```

**Type 2：日誌型**（cron 任務、背景服務）

```
驗收：cron 執行後，tail -50 logs/phase1.log
預期：包含 "FRED: OK"，無 "ERROR"
```

**Type 3：比對型**（配置修改、重構）

```
驗收：git diff config.json
預期：systemLoadThreshold 0.9 → 1.5，無其他非預期變更
```

**Type 4：服務型**（部署、重啟）

```
驗收：pm2 status + systemctl --user is-active ollama
預期：market-digest 為 online，ollama 為 active
```

**Type 5：端對端型**（跨模組修改、完整 pipeline）

```
驗收：手動觸發 Phase 1→2→3
預期：/today 日報包含 FRED 數據區塊，格式正確
```

**容易遺漏的驗收（從歷史 fix commits 學到）：**

```
⚠️ 別忘了：
  - 邊界驗收：「FRED 超時時，日報仍正常產出（只少了 FRED 區塊）」
  - 清理驗收：「git diff 確認無殘留 console.log」
  - 跨環境驗收：「local 測過，VPS 上也要跑一次確認」
```

**原則：好的驗收條件 = 一個指令 + 一個預期輸出。Claude 能自己跑、自己對比，不需要你確認。**

### Ten-Element Prompt Structure（來自官方課程 Ch9）

這是 Anthropic 官方教學的「畢業結構」，適合複雜任務：

```
1. 角色（永遠以 user 訊息開始）
2. 任務背景（角色 + 目標，放在前面）
3. 語氣（溝通風格）
4. 詳細任務規則（職責 + 例外處理）
5. 範例（最有效的工具，用 <example> 包裝）
6. 輸入資料（用 XML 標籤標記）
7. 具體任務描述（放在靠近結尾）
8. 預思考（「在回答之前先…」— 逐步推理）
9. 輸出格式（放在靠近結尾）
10. 預填（以預設文字開始回應）
```

日常使用不需要 10 項全用，但複雜任務時可以對照檢查。

#### 真實案例：FRED 整合（套用 Ten-Element Structure）

**使用元素：** ② 角色 + ① 背景 + ④ 規則 + ⑤ 範例×2 + ⑥ 輸入 + ⑦ 任務 + ⑧ 預思考 + ⑨ 格式

```
② 你是負責 market-digest agent 的工程師，熟悉 Node.js pipeline 架構。

① 背景：market-digest 需要整合 FRED API 作為新宏觀指標資料源，
  補充 Fed Rate 和 HY Spread 到每日市場日報。
  這個資料來源需要貫穿整個 pipeline（Phase 1 → 2 → 3 → validator）。

④ 規則：
  - 繼承 BaseCollector 模式（參考 yahoo-collector.js）
  - 不修改現有 Phase 2/3 的其他欄位
  - HTTP 請求超時 10 秒（VPS 網路不穩定）
  - FRED API 失敗時：marketData.fred = null，不拋出例外

⑤ 範例 — 期望的 Phase 1 輸出格式：
<example>
{
  "marketData": {
    "sp500": { "price": 4850, "change": -1.2 },
    "fred": { "fedRate": 5.25, "hySpread": 3.8 }
  }
}
</example>

⑤ 範例 — FRED API 失敗時的 fallback：
<example>
情境：FRED API 請求超時（10 秒無回應）
期望：marketData.fred = null，日報顯示「FRED 數據暫不可用」
      Phase 3 繼續執行，不中斷
</example>

⑥ FRED API 端點與格式：
<data>
端點：/fred/series/observations?series_id=FEDFUNDS
回應：{ "observations": [{ "date": "2026-02-21", "value": "5.25" }] }
API Key 變數：process.env.FRED_API_KEY
</data>

⑦ 任務：在 market-digest pipeline 的每一層整合 FRED 資料：
  1. Phase 1：新建 FredCollector（繼承 BaseCollector）
  2. Phase 2：phase1Ref 加入 fred 欄位傳遞
  3. Phase 3：collectedData 使用 fred 資料
  4. Validator：加入 FED_RATE 驗證規則
  5. config.json：加入 fedRateMin/fedRateMax 閾值

⑧ 開始之前，先列出所有受影響的檔案清單，確認每層修改計畫，再開始實作。

⑨ 按 Pipeline 層次順序修改（Phase 1 → 2 → 3 → validator → config），
   每層完成後簡短說明修改內容。

驗收：node phase1.js，輸出包含 marketData.fred.fedRate（數字）。
      FRED 超時模擬：將超時設為 0ms，確認 phase1 正常完成（fred 為 null）。
```

**使用 8/10 項，略過：** ③ 語氣（工程任務不需要）、⑩ 預填（Claude 自由開始即可）

---

## 第六層：進階技巧

### 減少 Claude 來回確認的 5 個方法

1. **一次給足上下文** — 不要擠牙膏式提供資訊。用 Checklist（第一層）確認該說的都說了。
2. **指向具體檔案** — 說「參考 src/agents/market-digest/src/collectors/yahoo-collector.js 的模式」而非「參考類似的 collector」。
3. **提供驗收條件** — 說「驗收：執行 node agent.js，輸出包含 fred 欄位」而非「確認它能正常運作」。
4. **說出你的猜測** — 「我懷疑是 ai-analyzer.js 的 fallback 路徑沒有回傳 industryThemes」比「產業熱點不見了」有用得多。
5. **標記風險** — 「注意：VPS 只有 1.1GB RAM，不要用記憶體密集的方案」比事後 OOM 再修好。

### 大任務分解策略

**Anthropic 官方 Feature-dev 7 階段流程：**

```
1. Discovery     — 理解需求，定義範圍
2. Exploration   — 搜尋現有程式碼和模式
3. Questions     — 列出不確定的問題，向你確認
4. Architecture  — 設計架構，列出要修改的檔案
5. Implementation — 逐檔實作
6. Review        — 自我審查，確認品質
7. Summary       — 總結變更，提供驗證步驟
```

**我們的最佳實踐：**

- Phase 1-3 用 Plan Mode（只讀，不修改）
- Phase 4 需要你確認後才開始
- Phase 5-6 每完成一個子任務就 commit
- Phase 7 推送到 GitHub 備份

---

## 官方學習資源

- [Prompt Engineering 概覽](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview)
- [Claude 4.6 最佳實踐](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices)
- [Claude Code 最佳實踐](https://code.claude.com/docs/en/best-practices)
- [互動式教學 9 章（GitHub）](https://github.com/anthropics/prompt-eng-interactive-tutorial)
- [Claude Code 官方 plugins/commands](https://github.com/anthropics/claude-code/tree/main/.claude)
- [Anthropic Cookbooks](https://github.com/anthropics/claude-cookbooks)
- [Anthropic Academy 13 門課](https://anthropic.skilljar.com/)
