# Diff — Round 05 vs Round 04

> 生成時間：2026-03-01 23:03:23

## 統計

- 新增：+22 行
- 刪除：-1 行
- 總 diff 行數：37


## Unified Diff

```diff
--- PLAN.md (前一輪快照)+++ PLAN.md (本輪)@@ -6,12 +6,33 @@ 
 每天自動收集 Facebook 群組新貼文 → AI 分類摘要排序 → 07:00 寄出 Email 晨報。使用者只需閱讀 Email，點連結回 FB 看全文，**零封號風險**。
 
-**量化成功指標：**
+**量化成功指標（Phase 1 基礎）：**
 - `email_parse_ok_rate` ≥ 90%（每日至少 9 成 FB 通知信可解析出貼文 URL）
 - `post_extract_ok_rate` ≥ 80%（解析出的貼文具備 url + snippet）
 - `must_include_in_digest_rate` = 100%（必看群組永遠出現在 digest）
 - 每日 digest 寄出成功（SMTP 無錯誤，latest.html 產出）
 - VPS cron 每日 07:00 台灣時間自動執行（UTC 23:00）
+
+**AI 排序量化指標（Phase 2 啟用後）：**
+- `NDCG@20` ≥ 0.6（兩週後，排序品質主指標；< 0.4 觸發 Kill Switch）
+- `NS`（North Star）= (pin×3 + good×2 + click×1) / top_picks_count，持續上升
+- `CTR_top / CTR_all` ≥ 1.5（AI Top Picks 點擊率至少 1.5x 整體均值）
+- `ai_confidence=HIGH` 比例 ≥ 60%（模型穩定度指標）
+
+**里程碑產出物摘要（M1~M12）：**
+- M1：`tools/fb-groups-export.js`（瀏覽器 console script，可匯出群組 JSON）
+- M2：`src/agents/social-digest/` 骨架（agent.js + config.json + 完整目錄結構）
+- M3：`social-digest.db`（SQLite，posts/ai_results/feedback/runs 四表建立完成）
+- M4：`imap-collector.js`（IMAP 水位線三件套，成功連線 Gmail label）
+- M5：`url-normalizer.js`（正規化 + 去 tracking params + sha256 主鍵）
+- M6：`email-parser.js`（三層解析，輸出 confidence + template_fp + 三段成功率）
+- M7：`deduplicator.js`（sha256(canonical_url) 主鍵去重，Message-ID 雙重確認）
+- M8：`rule-filter.js`（must_include 保底 60，黑名單降權）
+- M9：`email-publisher.js`（nodemailer text+html，Top Picks + Everything Else）
+- M9.5：`run-{run_id}.json`（決策快照，含每筆 post 完整分數拆解）
+- M10：`post-scorer.js`（關鍵字×權重 + novelty 兩層降權）
+- M11：告警邏輯（IMAP 0 封/parse_ok 低/SMTP 失敗 → stderr log）
+- M12：`tools/deploy.sh` 新增 social-digest + VPS cron `0 23 * * *`
 
 ## 範圍與非目標
 

```
