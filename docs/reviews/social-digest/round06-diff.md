# Diff — Round 06 vs Round 05

> 生成時間：2026-03-01 23:04:02

## 統計

- 新增：+7 行
- 刪除：-7 行
- 總 diff 行數：23


## Unified Diff

```diff
--- PLAN.md (前一輪快照)+++ PLAN.md (本輪)@@ -51,13 +51,13 @@ 
 ## 風險摘要
 
-| 風險 | 概率 | 影響 | 緩解措施 | 驗證方式 |
-|------|------|------|---------|---------|
-| Facebook 改變通知 email 格式 | 中 | 高 | template_fp 指紋監控，high_conf_rate 下降時告警 | `high_conf_rate` 告警閾值 < 70% 觸發 |
-| Gmail IMAP 連線不穩 | 低 | 高 | lookback_minutes=120 保險、Message-ID 去重防重抓 | `imap_last_uid` 每次 run 更新確認 |
-| SMTP 寄信失敗 | 低 | 中 | retry 1 次、stderr log 告警 | `grep SMTP_FAIL logs/` 輸出 0 |
-| AI API 費用超支 | 中 | 低 | daily cap MAX_POSTS=200 | `runs.post_count` <= 200 |
-| VPS 記憶體不足（2GB） | 低 | 中 | 批次處理、SQLite 輕量 | `ps aux` 確認 node < 200MB |
+| 風險 | probability | impact | 緩解措施 | 驗證方式 |
+|------|-------------|--------|---------|---------|
+| Facebook 改變通知 email 格式 | 30% / 年 | 高（pipeline 中斷） | template_fp 指紋監控，high_conf_rate < 70% 告警 | `high_conf_rate` 告警閾值驗證 |
+| Gmail IMAP 連線不穩 | 10% / 月 | 高（當日漏抓） | lookback_minutes=120 保險、Message-ID 去重 | `imap_last_uid` 每次 run 更新 |
+| SMTP 寄信失敗 | 5% / 月 | 中（延誤晨報） | retry 1 次、stderr log 告警 | `grep SMTP_FAIL logs/` 輸出 0 |
+| AI API 費用超支 | 20% / 月 | 低（成本） | daily cap MAX_POSTS=200，超過仍產 digest | `runs.post_count` <= 200 |
+| VPS 記憶體不足（2GB） | 5% / 月 | 中（OOM crash） | 批次處理、SQLite 輕量、不用 embedding | `ps aux` node < 200MB |
 
 ## 驗收標準摘要
 

```
