# Diff — Round 04 vs Round 03

> 生成時間：2026-03-01 23:02:40

## 統計

- 新增：+49 行
- 刪除：-0 行
- 總 diff 行數：58


## Unified Diff

```diff
--- PLAN.md (前一輪快照)+++ PLAN.md (本輪)@@ -12,6 +12,55 @@ - `must_include_in_digest_rate` = 100%（必看群組永遠出現在 digest）
 - 每日 digest 寄出成功（SMTP 無錯誤，latest.html 產出）
 - VPS cron 每日 07:00 台灣時間自動執行（UTC 23:00）
+
+## 範圍與非目標
+
+**範圍（In Scope）：**
+- Facebook 群組通知 email → IMAP 收信 → 解析 → AI 摘要 → Email digest
+- 公開群組/粉專的 L2 OG meta 抓取（零風險 HTTP GET）
+- 回饋閉環（GOOD/MUTE/PIN 回覆 + click 追蹤）
+- Phase 1（本輪）：M1~M12，不含 AI 摘要
+
+**非目標（Out of Scope）：**
+- 不使用任何需登入 Facebook 的方式（Playwright/Selenium/headless browser）
+- 不使用 Facebook Graph API（已廢除）
+- 不做 FB 貼文回覆或互動
+- 不做即時通知（只做每日批次）
+- Phase 2（AI/回饋）和 Phase 3（A/B）不在本輪驗收範圍
+
+## 風險摘要
+
+| 風險 | 概率 | 影響 | 緩解措施 | 驗證方式 |
+|------|------|------|---------|---------|
+| Facebook 改變通知 email 格式 | 中 | 高 | template_fp 指紋監控，high_conf_rate 下降時告警 | `high_conf_rate` 告警閾值 < 70% 觸發 |
+| Gmail IMAP 連線不穩 | 低 | 高 | lookback_minutes=120 保險、Message-ID 去重防重抓 | `imap_last_uid` 每次 run 更新確認 |
+| SMTP 寄信失敗 | 低 | 中 | retry 1 次、stderr log 告警 | `grep SMTP_FAIL logs/` 輸出 0 |
+| AI API 費用超支 | 中 | 低 | daily cap MAX_POSTS=200 | `runs.post_count` <= 200 |
+| VPS 記憶體不足（2GB） | 低 | 中 | 批次處理、SQLite 輕量 | `ps aux` 確認 node < 200MB |
+
+## 驗收標準摘要
+
+**功能驗收（Phase 1 / M1~M12）：**
+- [ ] `--dry-run` 產出 `latest.html` 含「Top Picks」字串
+- [ ] `run` 成功寄出 digest email（Top Picks + Everything Else 兩段）
+- [ ] `--backfill-hours 24` 補漏且不重複
+- [ ] VPS cron 每日 07:00 台灣時間自動執行
+- [ ] 水位線三件套（imap_last_uid / imap_last_internal_date / imap_last_message_id）成功後才更新
+- [ ] must_include 群組永遠出現在 Top Picks
+
+**品質門檻：**
+- `email_parse_ok_rate` ≥ 90%，`post_extract_ok_rate` ≥ 80%
+- 去重後無大量重複，L2 fetch 成功率 ≥ 30%
+- 排序 deterministic，告警正常觸發
+
+## Decision Log 摘要
+
+- **2026-03-01**：選擇 IMAP + 無登入 HTTP GET。理由：Facebook API 廢除，Playwright 封號風險高。
+- **2026-03-01**：水位線三件套（UID + internalDate + Message-ID）取代 SINCE:yesterday。理由：防邊界漏抓，成功才更新保安全。
+- **2026-03-01**：去重主鍵 `sha256(canonical_url)`。理由：FB post_id 不唯一，URL 正規化後最穩定。
+- **2026-03-01**：AI 是排序器不是篩選器。理由：防漏，使用者不焦慮。
+- **2026-03-01**：SQLite Phase 1 就建（posts/ai_results/feedback/runs）。理由：去重+週報基礎+AI快取一次到位。
+- **2026-03-01**：Digest 兩段式（Top Picks 完整 + Everything Else 縮短）。理由：使用者不怕漏又省時間。
 
 ## Context
 

```
