# Diff — Round 01 vs Round 00

> 生成時間：2026-03-01 22:40:22

## 統計

- 新增：+748 行
- 刪除：-0 行
- 總 diff 行數：751
- ⚠️ 已截斷至 200 行

## Unified Diff

```diff
--- PLAN.md (前一輪快照)+++ PLAN.md (本輪)@@ -0,0 +1,748 @@+# OpenClaw 晨報系統（social-digest agent）
+
+<!-- 2026-03-01 定稿 -->
+
+## 目標
+
+每天自動收集 Facebook 群組新貼文 → AI 分類摘要排序 → 07:00 寄出 Email 晨報。使用者只需閱讀 Email，點連結回 FB 看全文，**零封號風險**。
+
+## Context
+
+使用者每天加入的 Facebook 群組有大量新貼文，但沒有時間逐一瀏覽。需要一個自動化系統：每日收集群組新貼文 → AI 分類摘要 → Email 晨報。使用者只需閱讀 Email，點開有興趣的連結回 FB 看全文。
+
+**核心限制：**
+
+- Facebook Groups API 已於 2024/4 廢除，無官方 API 可用
+- 使用者要求**零封號風險**
+- VPS 2GB RAM，資源有限
+
+**核心設計哲學：AI 是排序器，不是篩選器**
+
+- 永遠收齊所有 L1 貼文（不漏）
+- AI 做：分類、摘要、排序、加理由
+- 篩選（是否出現在 email）由規則 + 上限控制（每天最多 60 則）
+- 使用者不會焦慮「AI 漏掉重要訊息」
+
+## 方案：IMAP + 無登入爬取（零封號風險）
+
+### 資料來源分兩層
+
+| 層級 | 來源 | 內容 | 風險 |
+|------|------|------|------|
+| L1 | IMAP 解析 FB email 通知 | 摘要片段 + 原文連結 | 零 |
+| L2 | HTTP GET 公開貼文頁面 | OG meta（僅公開群組/粉專） | 零 |
+
+- **私人群組**：只有 L1（email 摘要 + 連結），不做任何爬取
+- **公開群組/粉專**：L1 + L2（有摘要，也嘗試抓 OG meta）
+- L2 失敗時 graceful fallback 到 L1（不影響 digest 產出）
+
+### P0：收信來源穩定性
+
+IMAP 是整條 pipeline 的命脈，必須確保穩定：
+
+1. **Gmail Filter + Label（必做）**
+   - Filter：`from:(notification@facebookmail.com) subject:(in your group OR 在你的社團)`
+   - Action：Apply label、Skip Inbox
+   - Label 名稱為 config 參數（`IMAP_LABEL`），不硬寫
+   - Config 另設 `IMAP_MAILBOX_TYPE: "gmail_label"`（未來換 provider 可切）
+   - IMAP 只開該 label 信箱，不搜全信箱
+   - Collector 啟動時列出可用 mailbox/label，找不到目標 label → 直接告警
+
+2. **水位線三件套（取代 SINCE:yesterday）**
+   - `latest.json` 記錄：
+     - `imap_last_uid` — IMAP UID
+     - `imap_last_internal_date` — 最後一封的 internalDate
+     - `imap_last_message_id` — 最後一封的 Message-ID（最終去重保險）
+   - 抓取策略：
+     - 以 `internalDate` 視窗為主（`last_internal_date - lookback_minutes`）
+     - 以 UID 排序加速
+     - 以 Message-ID 作最終去重（同封被重抓也能跳過）
+   - `lookback_minutes: 120`（Gmail label 搬移/重新標籤邊界保險）
+   - **成功跑完才更新水位線**（避免中途失敗漏抓）
+
+3. **Gmail App Password + 2FA**（必備）
+
+### P0.5：Digest 回覆收信管道（feedback inbox）
+
+回覆回饋（GOOD/MUTE/PIN）靠 IMAP 讀取「digest 回覆信」，不是 FB 通知信。必須先確認技術可行：
+
+- **方案 A（推薦，最省事）**：同一個 Gmail，第二個 label `IMAP_FEEDBACK_LABEL`
+  - Gmail filter：`to:(你的寄件信箱) subject:(Re: [SocialDigest])`
+  - 或只抓最近 48 小時、含 `GOOD|MUTE|PIN` 關鍵字的回覆信
+- **方案 B（更乾淨）**：用 Reply-To: `digest+feedback@yourdomain` alias，把回覆導到固定 label
+
+Phase 2 啟用回覆回饋前，必須完成 `feedback-collector.js`：IMAP 讀取 feedback label → 解析 GOOD/MUTE/PIN → 寫入 `feedback` 表。
+
+新增檔案：`src/agents/social-digest/src/collectors/feedback-collector.js`
+
+### 發送管道
+
+- **Email**（nodemailer + Gmail SMTP）
+- 同時送 `text` + `html` 版本（相容各種信箱）
+
+---
+
+## Phase 1：來源清單 + IMAP 基礎 + SQLite（第 1 週）
+
+### M1: Console Script 匯出群組清單
+
+- 在 `facebook.com/groups/joins/` 頁面執行的 browser console JS script
+- 自動 scroll 到底（多次）+ MutationObserver 等 DOM 更新
+- 擷取：群組名稱、URL、公開/私人標記（UI 不顯示時留空）
+- 匯出 JSON 格式：
+
+```json
+{
+  "type": "group",
+  "name": "...",
+  "url": "...",
+  "public": false,
+  "enabled": true,
+  "weight": 1.0,
+  "tags": ["理財"],
+  "must_include": false
+}
+```
+
+- `type`：Phase 1 = `"group"`，Phase 3 擴展 `"page"` / `"rss"` / `"x"`
+- `enabled`：快速停用吵雜群組不必刪資料
+- `must_include`：必看群組，importance 保底 60（Rule Filter 用）
+- 使用者貼回 `src/agents/social-digest/data/sources.json`
+- 產出：`tools/fb-groups-export.js`
+
+### M2: Agent 骨架（遵循 agent-template）
+
+```
+src/agents/social-digest/
+├── agent.js              # CLI: run, run --dry-run, run --backfill-hours N, status, help
+├── config.json           # IMAP/SMTP/AI 設定（label/mailbox-type 為參數）
+├── README.md
+├── src/
+│   ├── collectors/
+│   │   ├── imap-collector.js      # IMAP 水位線三件套（只抓 label）
+│   │   ├── feedback-collector.js  # IMAP 讀取 feedback label，解析 GOOD/MUTE/PIN（Phase 2）
+│   │   └── public-fetcher.js      # HTTP GET 公開貼文 OG meta（禮貌節流+中性 UA）
+│   ├── processors/
+│   │   ├── email-parser.js        # 三層解析 + confidence + template_fp
+│   │   ├── url-normalizer.js      # 去 tracking / 統一化 URL
+│   │   ├── deduplicator.js        # 跨通知去重（SQLite, sha256 主鍵）
+│   │   ├── rule-filter.js         # 規則優先 guardrail（必看/黑名單/關鍵字）
+│   │   ├── post-scorer.js         # 貼文評分 + novelty 降權
+│   │   └── ai-summarizer.js       # AI 批次排序+摘要（不篩選）
+│   ├── publishers/
+│   │   └── email-publisher.js     # nodemailer（text+html, Top Picks + Everything Else）
+│   └── shared/
+│       ├── source-manager.js      # 管理 sources.json
+│       └── db.js                  # SQLite 存取層
+├── data/
+│   ├── sources.json               # 群組清單（含 type/enabled/weight/tags/must_include）
+│   ├── rules.json                 # 規則定義（含 version，必看/黑名單/關鍵字/配額）
+│   ├── social-digest.db           # SQLite（posts + runs + ai_results + feedback）
+│   └── runtime/
+│       ├── latest.json            # 水位線三件套 + 執行狀態
+│       └── latest.html            # digest preview（debug 用）
+└── logs/
+```
+
+**CLI 參數：**
+
+- `node agent.js run` — 正常執行（水位線 + lookback）
+- `node agent.js run --dry-run` — 不寄信，產出 latest.html preview
+- `node agent.js run --backfill-hours 24` — 擴大 internalDate 視窗補漏（仍靠 SQLite 去重）
+- `node agent.js status` — 顯示上次 run 狀態
+- `node agent.js help`
+
+### M3: SQLite 資料層（Phase 1 就建）
+
+提前到 Phase 1（去重 + run 記錄 + 週報基礎 + AI 結果快取 + 回饋閉環）。
+
+```sql
+CREATE TABLE posts (
+  id TEXT PRIMARY KEY,              -- sha256(canonical_url)，唯一真相
+  url TEXT NOT NULL,
+  raw_url TEXT,
+  post_id TEXT,                     -- FB post ID（輔助，不作主鍵）
+  group_name TEXT,
+  group_url TEXT,
+  author TEXT,
+  snippet TEXT,
+  snippet_hash TEXT,
+  source TEXT DEFAULT 'l1_imap',
+  confidence TEXT DEFAULT 'MED',
+  template_fp TEXT,
+  raw_email_message_id TEXT,
+  first_seen_at TEXT NOT NULL,
+  created_at TEXT,
+  l2_fetched_at TEXT,               -- L2 fetch 時間（7天快取 TTL）
+  sent_at TEXT
+);
+
+CREATE TABLE ai_results (
+  post_id TEXT PRIMARY KEY REFERENCES posts(id),
+  category TEXT,
+  summary TEXT,
+  tags_json TEXT,                   -- JSON array
+  importance_score INTEGER,         -- 0-100
+  ai_confidence TEXT,               -- HIGH/MED/LOW（模型自信度）
+  reasons_json TEXT,                -- JSON array, 最多 3 點, 每點 ≤60 字
+  matched_rules_json TEXT,          -- JSON array of rule ids
+  model TEXT,
+  prompt_version TEXT,
+  created_at TEXT
+);
+
+CREATE TABLE feedback (
+  id INTEGER PRIMARY KEY AUTOINCREMENT,
+  run_id TEXT,
+  post_id TEXT REFERENCES posts(id),

... [TRUNCATED: 超過 200 行，省略餘下內容] ...
```
