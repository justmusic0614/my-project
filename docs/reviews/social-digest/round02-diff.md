# Diff — Round 02 vs Round 01

> 生成時間：2026-03-01 23:00:28

## 統計

- 新增：+18 行
- 刪除：-1 行
- 總 diff 行數：38


## Unified Diff

```diff
--- PLAN.md (前一輪快照)+++ PLAN.md (本輪)@@ -1,10 +1,17 @@ # OpenClaw 晨報系統（social-digest agent）
 
-<!-- 2026-03-01 定稿 v6 -->
+<!-- 2026-03-01 定稿 v8 -->
 
 ## 目標
 
 每天自動收集 Facebook 群組新貼文 → AI 分類摘要排序 → 07:00 寄出 Email 晨報。使用者只需閱讀 Email，點連結回 FB 看全文，**零封號風險**。
+
+**量化成功指標：**
+- `email_parse_ok_rate` ≥ 90%（每日至少 9 成 FB 通知信可解析出貼文 URL）
+- `post_extract_ok_rate` ≥ 80%（解析出的貼文具備 url + snippet）
+- `must_include_in_digest_rate` = 100%（必看群組永遠出現在 digest）
+- 每日 digest 寄出成功（SMTP 無錯誤，latest.html 產出）
+- VPS cron 每日 07:00 台灣時間自動執行（UTC 23:00）
 
 ## Context
 
@@ -700,6 +707,16 @@ - [ ] 在 `src/agents/social-digest/data/runtime/latest.json` 包含水位線三件套，驗收：`node -e "const j=require('./src/agents/social-digest/data/runtime/latest.json'); console.log(['imap_last_uid','imap_last_internal_date','imap_last_message_id'].every(k=>k in j))"` 輸出 `true`（需先跑一次 dry-run）
 - [ ] 在 `src/agents/social-digest/src/publishers/email-publisher.js` 確保排序 deterministic（importance→score→first_seen→id），驗收：`grep -n "first_seen_at\|ORDER BY\|sort" src/agents/social-digest/src/publishers/email-publisher.js | wc -l` 輸出 >= 2
 - [ ] 在 `src/agents/social-digest/agent.js` 實作故障告警（IMAP 0 封、parse_ok 低、SMTP 失敗），驗收：`grep -n "alert\|warn\|IMAP_NO_MAIL\|SMTP_FAIL" src/agents/social-digest/agent.js | wc -l` 輸出 >= 3
+
+## 風險
+
+| 風險 | 概率 | 影響 | 緩解措施 | 驗證方式 |
+|------|------|------|---------|---------|
+| Facebook 改變通知 email 格式 | 中 | 高 | template_fp 指紋監控，high_conf_rate 下降時告警 | `high_conf_rate` 告警閾值 < 70% 觸發 |
+| Gmail IMAP 連線不穩 | 低 | 高 | lookback_minutes=120 保險、Message-ID 去重防重抓 | `imap_last_uid` 每次 run 更新確認 |
+| SMTP 寄信失敗 | 低 | 中 | retry 1 次、stderr log 告警 | `grep SMTP_FAIL logs/` 輸出 0 |
+| AI API 費用超支 | 中 | 低 | daily cap MAX_POSTS=200、超過仍產出 digest（規則排序） | `runs.post_count` <= 200 |
+| VPS 記憶體不足（2GB） | 低 | 中 | 批次處理、SQLite 輕量、不用 embedding model | `ps aux` 確認 node 常駐 < 200MB |
 
 ## Decision Log
 

```
