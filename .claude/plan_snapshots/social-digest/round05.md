# OpenClaw 晨報系統（social-digest agent）

<!-- 2026-03-01 定稿 v9 -->

## 目標

每天自動收集 Facebook 群組新貼文 → AI 分類摘要排序 → 07:00 寄出 Email 晨報。使用者只需閱讀 Email，點連結回 FB 看全文，**零封號風險**。

**量化成功指標（Phase 1 基礎）：**
- `email_parse_ok_rate` ≥ 90%（每日至少 9 成 FB 通知信可解析出貼文 URL）
- `post_extract_ok_rate` ≥ 80%（解析出的貼文具備 url + snippet）
- `must_include_in_digest_rate` = 100%（必看群組永遠出現在 digest）
- 每日 digest 寄出成功（SMTP 無錯誤，latest.html 產出）
- VPS cron 每日 07:00 台灣時間自動執行（UTC 23:00）

**AI 排序量化指標（Phase 2 啟用後）：**
- `NDCG@20` ≥ 0.6（兩週後，排序品質主指標；< 0.4 觸發 Kill Switch）
- `NS`（North Star）= (pin×3 + good×2 + click×1) / top_picks_count，持續上升
- `CTR_top / CTR_all` ≥ 1.5（AI Top Picks 點擊率至少 1.5x 整體均值）
- `ai_confidence=HIGH` 比例 ≥ 60%（模型穩定度指標）

**里程碑產出物摘要（M1~M12）：**
- M1：`tools/fb-groups-export.js`（瀏覽器 console script，可匯出群組 JSON）
- M2：`src/agents/social-digest/` 骨架（agent.js + config.json + 完整目錄結構）
- M3：`social-digest.db`（SQLite，posts/ai_results/feedback/runs 四表建立完成）
- M4：`imap-collector.js`（IMAP 水位線三件套，成功連線 Gmail label）
- M5：`url-normalizer.js`（正規化 + 去 tracking params + sha256 主鍵）
- M6：`email-parser.js`（三層解析，輸出 confidence + template_fp + 三段成功率）
- M7：`deduplicator.js`（sha256(canonical_url) 主鍵去重，Message-ID 雙重確認）
- M8：`rule-filter.js`（must_include 保底 60，黑名單降權）
- M9：`email-publisher.js`（nodemailer text+html，Top Picks + Everything Else）
- M9.5：`run-{run_id}.json`（決策快照，含每筆 post 完整分數拆解）
- M10：`post-scorer.js`（關鍵字×權重 + novelty 兩層降權）
- M11：告警邏輯（IMAP 0 封/parse_ok 低/SMTP 失敗 → stderr log）
- M12：`tools/deploy.sh` 新增 social-digest + VPS cron `0 23 * * *`

## 範圍與非目標

**範圍（In Scope）：**
- Facebook 群組通知 email → IMAP 收信 → 解析 → AI 摘要 → Email digest
- 公開群組/粉專的 L2 OG meta 抓取（零風險 HTTP GET）
- 回饋閉環（GOOD/MUTE/PIN 回覆 + click 追蹤）
- Phase 1（本輪）：M1~M12，不含 AI 摘要

**非目標（Out of Scope）：**
- 不使用任何需登入 Facebook 的方式（Playwright/Selenium/headless browser）
- 不使用 Facebook Graph API（已廢除）
- 不做 FB 貼文回覆或互動
- 不做即時通知（只做每日批次）
- Phase 2（AI/回饋）和 Phase 3（A/B）不在本輪驗收範圍

## 風險摘要

| 風險 | 概率 | 影響 | 緩解措施 | 驗證方式 |
|------|------|------|---------|---------|
| Facebook 改變通知 email 格式 | 中 | 高 | template_fp 指紋監控，high_conf_rate 下降時告警 | `high_conf_rate` 告警閾值 < 70% 觸發 |
| Gmail IMAP 連線不穩 | 低 | 高 | lookback_minutes=120 保險、Message-ID 去重防重抓 | `imap_last_uid` 每次 run 更新確認 |
| SMTP 寄信失敗 | 低 | 中 | retry 1 次、stderr log 告警 | `grep SMTP_FAIL logs/` 輸出 0 |
| AI API 費用超支 | 中 | 低 | daily cap MAX_POSTS=200 | `runs.post_count` <= 200 |
| VPS 記憶體不足（2GB） | 低 | 中 | 批次處理、SQLite 輕量 | `ps aux` 確認 node < 200MB |

## 驗收標準摘要

**功能驗收（Phase 1 / M1~M12）：**
- [ ] `--dry-run` 產出 `latest.html` 含「Top Picks」字串
- [ ] `run` 成功寄出 digest email（Top Picks + Everything Else 兩段）
- [ ] `--backfill-hours 24` 補漏且不重複
- [ ] VPS cron 每日 07:00 台灣時間自動執行
- [ ] 水位線三件套（imap_last_uid / imap_last_internal_date / imap_last_message_id）成功後才更新
- [ ] must_include 群組永遠出現在 Top Picks

**品質門檻：**
- `email_parse_ok_rate` ≥ 90%，`post_extract_ok_rate` ≥ 80%
- 去重後無大量重複，L2 fetch 成功率 ≥ 30%
- 排序 deterministic，告警正常觸發

## Decision Log 摘要

- **2026-03-01**：選擇 IMAP + 無登入 HTTP GET。理由：Facebook API 廢除，Playwright 封號風險高。
- **2026-03-01**：水位線三件套（UID + internalDate + Message-ID）取代 SINCE:yesterday。理由：防邊界漏抓，成功才更新保安全。
- **2026-03-01**：去重主鍵 `sha256(canonical_url)`。理由：FB post_id 不唯一，URL 正規化後最穩定。
- **2026-03-01**：AI 是排序器不是篩選器。理由：防漏，使用者不焦慮。
- **2026-03-01**：SQLite Phase 1 就建（posts/ai_results/feedback/runs）。理由：去重+週報基礎+AI快取一次到位。
- **2026-03-01**：Digest 兩段式（Top Picks 完整 + Everything Else 縮短）。理由：使用者不怕漏又省時間。

## Context

使用者每天加入的 Facebook 群組有大量新貼文，但沒有時間逐一瀏覽。需要一個自動化系統：每日收集群組新貼文 → AI 分類摘要 → Email 晨報。使用者只需閱讀 Email，點開有興趣的連結回 FB 看全文。

**核心限制：**

- Facebook Groups API 已於 2024/4 廢除，無官方 API 可用
- 使用者要求**零封號風險**
- VPS 2GB RAM，資源有限

**核心設計哲學：AI 是排序器，不是篩選器**

- 永遠收齊所有 L1 貼文（不漏）
- AI 做：分類、摘要、排序、加理由
- 篩選（是否出現在 email）由規則 + 上限控制（每天最多 60 則）
- 使用者不會焦慮「AI 漏掉重要訊息」

## 方案：IMAP + 無登入爬取（零封號風險）

### 資料來源分兩層

| 層級 | 來源 | 內容 | 風險 |
|------|------|------|------|
| L1 | IMAP 解析 FB email 通知 | 摘要片段 + 原文連結 | 零 |
| L2 | HTTP GET 公開貼文頁面 | OG meta（僅公開群組/粉專） | 零 |

- **私人群組**：只有 L1（email 摘要 + 連結），不做任何爬取
- **公開群組/粉專**：L1 + L2（有摘要，也嘗試抓 OG meta）
- L2 失敗時 graceful fallback 到 L1（不影響 digest 產出）

### P0：收信來源穩定性

IMAP 是整條 pipeline 的命脈，必須確保穩定：

1. **Gmail Filter + Label（必做）**
   - Filter：`from:(notification@facebookmail.com) subject:(in your group OR 在你的社團)`
   - Action：Apply label、Skip Inbox
   - Label 名稱為 config 參數（`IMAP_LABEL`），不硬寫
   - Config 另設 `IMAP_MAILBOX_TYPE: "gmail_label"`（未來換 provider 可切）
   - IMAP 只開該 label 信箱，不搜全信箱
   - Collector 啟動時列出可用 mailbox/label，找不到目標 label → 直接告警

2. **水位線三件套（取代 SINCE:yesterday）**
   - `latest.json` 記錄：
     - `imap_last_uid` — IMAP UID
     - `imap_last_internal_date` — 最後一封的 internalDate
     - `imap_last_message_id` — 最後一封的 Message-ID（最終去重保險）
   - 抓取策略：
     - 以 `internalDate` 視窗為主（`last_internal_date - lookback_minutes`）
     - 以 UID 排序加速
     - 以 Message-ID 作最終去重（同封被重抓也能跳過）
   - `lookback_minutes: 120`（Gmail label 搬移/重新標籤邊界保險）
   - **成功跑完才更新水位線**（避免中途失敗漏抓）

3. **Gmail App Password + 2FA**（必備）

### P0.5：Digest 回覆收信管道（feedback inbox）

回覆回饋（GOOD/MUTE/PIN）靠 IMAP 讀取「digest 回覆信」，不是 FB 通知信。必須先確認技術可行：

- **方案 A（推薦，最省事）**：同一個 Gmail，第二個 label `IMAP_FEEDBACK_LABEL`
  - Gmail filter：`to:(你的寄件信箱) subject:(Re: [SocialDigest])`
  - 或只抓最近 48 小時、含 `GOOD|MUTE|PIN` 關鍵字的回覆信
- **方案 B（更乾淨）**：用 Reply-To: `digest+feedback@yourdomain` alias，把回覆導到固定 label

Phase 2 啟用回覆回饋前，必須完成 `feedback-collector.js`：IMAP 讀取 feedback label → 解析 GOOD/MUTE/PIN → 寫入 `feedback` 表。

新增檔案：`src/agents/social-digest/src/collectors/feedback-collector.js`

### 發送管道

- **Email**（nodemailer + Gmail SMTP）
- 同時送 `text` + `html` 版本（相容各種信箱）

---

## Phase 1：來源清單 + IMAP 基礎 + SQLite（第 1 週）

### M1: Console Script 匯出群組清單

- 在 `facebook.com/groups/joins/` 頁面執行的 browser console JS script
- 自動 scroll 到底（多次）+ MutationObserver 等 DOM 更新
- 擷取：群組名稱、URL、公開/私人標記（UI 不顯示時留空）
- 匯出 JSON 格式：

```json
{
  "type": "group",
  "name": "...",
  "url": "...",
  "public": false,
  "enabled": true,
  "weight": 1.0,
  "tags": ["理財"],
  "must_include": false
}
```

- `type`：Phase 1 = `"group"`，Phase 3 擴展 `"page"` / `"rss"` / `"x"`
- `enabled`：快速停用吵雜群組不必刪資料
- `must_include`：必看群組，importance 保底 60（Rule Filter 用）
- 使用者貼回 `src/agents/social-digest/data/sources.json`
- 產出：`tools/fb-groups-export.js`

### M2: Agent 骨架（遵循 agent-template）

```
src/agents/social-digest/
├── agent.js              # CLI: run, run --dry-run, run --backfill-hours N, status, help
├── config.json           # IMAP/SMTP/AI 設定（label/mailbox-type 為參數）
├── README.md
├── src/
│   ├── collectors/
│   │   ├── imap-collector.js      # IMAP 水位線三件套（只抓 label）
│   │   ├── feedback-collector.js  # IMAP 讀取 feedback label，解析 GOOD/MUTE/PIN（Phase 2）
│   │   └── public-fetcher.js      # HTTP GET 公開貼文 OG meta（禮貌節流+中性 UA）
│   ├── processors/
│   │   ├── email-parser.js        # 三層解析 + confidence + template_fp
│   │   ├── url-normalizer.js      # 去 tracking / 統一化 URL
│   │   ├── deduplicator.js        # 跨通知去重（SQLite, sha256 主鍵）
│   │   ├── rule-filter.js         # 規則優先 guardrail（必看/黑名單/關鍵字）
│   │   ├── post-scorer.js         # 貼文評分 + novelty 降權
│   │   └── ai-summarizer.js       # AI 批次排序+摘要（不篩選）
│   ├── publishers/
│   │   └── email-publisher.js     # nodemailer（text+html, Top Picks + Everything Else）
│   └── shared/
│       ├── source-manager.js      # 管理 sources.json
│       └── db.js                  # SQLite 存取層
├── data/
│   ├── sources.json               # 群組清單（含 type/enabled/weight/tags/must_include）
│   ├── rules.json                 # 規則定義（含 version，必看/黑名單/關鍵字/配額）
│   ├── social-digest.db           # SQLite（posts + runs + ai_results + feedback）
│   └── runtime/
│       ├── latest.json            # 水位線三件套 + 執行狀態
│       └── latest.html            # digest preview（debug 用）
└── logs/
```

**CLI 參數：**

- `node agent.js run` — 正常執行（水位線 + lookback）
- `node agent.js run --dry-run` — 不寄信，產出 latest.html preview
- `node agent.js run --backfill-hours 24` — 擴大 internalDate 視窗補漏（仍靠 SQLite 去重）
- `node agent.js status` — 顯示上次 run 狀態
- `node agent.js help`

### M3: SQLite 資料層（Phase 1 就建）

提前到 Phase 1（去重 + run 記錄 + 週報基礎 + AI 結果快取 + 回饋閉環）。

```sql
CREATE TABLE posts (
  id TEXT PRIMARY KEY,              -- sha256(canonical_url)，唯一真相
  url TEXT NOT NULL,
  raw_url TEXT,
  post_id TEXT,                     -- FB post ID（輔助，不作主鍵）
  group_name TEXT,
  group_url TEXT,
  author TEXT,
  snippet TEXT,
  snippet_hash TEXT,
  source TEXT DEFAULT 'l1_imap',
  confidence TEXT DEFAULT 'MED',
  template_fp TEXT,
  raw_email_message_id TEXT,
  first_seen_at TEXT NOT NULL,
  created_at TEXT,
  l2_fetched_at TEXT,               -- L2 fetch 時間（7天快取 TTL）
  sent_at TEXT
);

CREATE TABLE ai_results (
  post_id TEXT PRIMARY KEY REFERENCES posts(id),
  category TEXT,
  summary TEXT,
  tags_json TEXT,                   -- JSON array
  importance_score INTEGER,         -- 0-100
  ai_confidence TEXT,               -- HIGH/MED/LOW（模型自信度）
  reasons_json TEXT,                -- JSON array, 最多 3 點, 每點 ≤60 字
  matched_rules_json TEXT,          -- JSON array of rule ids
  model TEXT,
  prompt_version TEXT,
  created_at TEXT
);

CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  post_id TEXT REFERENCES posts(id),
  action TEXT,                      -- 'good' | 'pin' | 'mute_group' | 'mute_topic' | 'click'
  rank INTEGER,                     -- 點擊/回饋時的 rank（1~N，越小越靠前）
  section TEXT,                     -- 'top_picks' | 'everything_else' | 'overflow'
  created_at TEXT
);

CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  started_at TEXT,
  ended_at TEXT,
  mail_count INTEGER,
  post_count INTEGER,
  new_post_count INTEGER,
  sent_count INTEGER,
  top_picks_count INTEGER,          -- Top Picks 區段筆數
  email_parse_ok_rate REAL,
  post_extract_ok_rate REAL,
  high_conf_rate REAL,
  l2_success_rate REAL,
  template_fp_stats TEXT,
  click_count INTEGER DEFAULT 0,    -- redirect 追蹤（Phase 2+）
  top_picks_click_count INTEGER DEFAULT 0,
  good_count INTEGER DEFAULT 0,
  pin_count INTEGER DEFAULT 0,
  mute_count INTEGER DEFAULT 0,
  first_click_rank INTEGER,          -- 第一次點擊是第幾則（越小越好）
  time_to_first_click_sec INTEGER,   -- 寄出到第一次點擊的秒數
  rules_version TEXT,                -- rules.json 的 version 欄位快照
  errors TEXT
);
```

**rules.json 版本化：**

- `rules.json` 頂層加 `"version": "2026-03-01.1"`
- 每次修改 rules 必須遞增 version（手動，格式 `YYYY-MM-DD.N`）
- `runs.rules_version` 記錄當次 run 使用的 rules 版本
- 搭配 `prompt_version`，KPI 變化時可回溯「是改了規則還是改了 prompt」

### M4: IMAP Collector（水位線三件套）

- 連線 Gmail IMAP（`imap.gmail.com:993`）
- 啟動時列出可用 mailbox/label，確認 `config.IMAP_LABEL` 存在，否則告警
- 抓取策略：
  - 以 `internalDate >= (last_internal_date - lookback_minutes)` 為主視窗
  - 以 UID 排序加速遍歷
  - 每封信 Message-ID 雙重去重（水位線 + SQLite）
- `--backfill-hours N`：擴大 internalDate 視窗，用於補漏
- **成功跑完才更新 `latest.json` 水位線三件套**
- 依賴：`imapflow`

### M5: URL Normalizer（共用模組）

- 去掉所有 tracking query params（`ref`、`__tn__`、`__cft__`、`fbclid` 等）
- 統一 scheme（`https`）、去尾端 `/`
- `m.facebook.com` → `www.facebook.com`
- `l.facebook.com/l.php?u=...` → decode 出真正 URL
- 保留必要 ID params（`story_fbid`、`id`）
- 產出 canonical URL → `sha256()` 作為 posts.id

### M6: Email Parser（三層 + 指紋 + 三段成功率）

不依賴 HTML 結構，優先用穩定訊號：

1. **Layer 1（最穩）**：抽所有 `<a>` 連結，挑出貼文連結
   - 匹配：`facebook.com/groups/.../permalink/...` 或 `story_fbid=`
   - 經 url-normalizer 正規化
2. **Layer 2（中穩）**：可見文字 / 純文字版
   - 找群組名、作者、摘要片段
3. **Layer 3（補強）**：CSS selector / DOM 結構

每封信產出：

- `confidence`：HIGH / MED / LOW
- `template_fp`：HTML 穩定 token 的 hash → 統計到 `runs.template_fp_stats`

**三段成功率定義（runs 表）：**

- `email_parse_ok_rate`：至少解析出 1 個貼文 URL 的郵件比例（< 90% → 真壞）
- `post_extract_ok_rate`：貼文具備 url + snippet 的比例
- `high_conf_rate`：confidence=HIGH 的比例（下降 → FB 模板變了但還能用）

### M7: 去重策略（跨多封通知）

去重 key 優先級（全部經 url-normalizer）：

1. **`sha256(canonical_url)`** — posts.id 主鍵，唯一真相
2. **Message-ID** — IMAP 層級去重
3. **Fallback**：`group_url + author + snippet_hash`

`post_id`（FB 數字）只存為輔助欄位，不參與主鍵。

### M8: Rule Filter（規則優先 guardrail，AI 之前跑）

AI 不得違反硬規則，Rule Filter 在 Post Scorer 之前執行：

- **必看群組**（`sources.json` 的 `must_include: true`）→ importance 保底 60，保證進 digest
- **必看關鍵字**（`rules.json` 的 `must_keywords`）→ 命中即保底 60
- **黑名單群組**（`enabled: false`）→ 直接不處理（Collector 層已過濾）
- **黑名單關鍵字**（`rules.json` 的 `mute_keywords`）→ 降權 -30 或不出現

**must_include 配額控制（防 Top Picks 被塞爆）：**

- `top_picks_max = 20`（rules.json 可調）
- `must_include_quota = min(8, top_picks_max / 2)`
- must_include 超過 quota 的仍保底進 digest，但落在 Everything Else（不漏）
- Top Picks 剩餘位置留給 AI/規則排序最高的

**must_include 排序底線（硬規則）：**

- must_include 的 post 在 `final_rank` 一定落在 `top_picks_max + 20` 以內
- 即使 AI 當天沒跑 / ai_confidence=LOW，must_include 不會被埋到最底下
- 心理安全感 = 「不只有出現在 email，而且不會被埋太深」

AI 只在這個框架內排序與摘要，不是唯一裁判。

### M9: Email Publisher（兩段式 + redirect 追蹤）

- nodemailer + Gmail SMTP（`smtp.gmail.com:587` + App Password）
- **同時送 `text` + `html`**

**兩段式版型（Top Picks + Everything Else）：**

- **Top Picks**（前 10-20 則，AI 或規則排序最高）：
  - 完整顯示：`[⭐85] 群組名 — 作者` + 2-4 行摘要 + reasons + `#tags` + 🔗原文
  - 使用者永遠知道 AI 只挑了前面這段
- **Everything Else**（其餘，上限 60 則）：
  - 縮短顯示：群組名 — 作者 — 片段首行 + 🔗原文
  - 使用者可掃完，不怕漏

**Overflow 策略（超過 60 則時）：**

- Everything Else 只顯示前 60 則（按排序取前 60）
- Footer 顯示：「本日共 N 篇，已列出 Top Picks X 篇 + Everything Else 60 篇，剩餘 Y 篇未列出」
- 完整清單永遠可在 `data/runtime/latest.html` 查看（含全部貼文）
- 決策快照 `run-{run_id}.json` 也記錄所有貼文（含 `section: "overflow"`）

**排序規則（deterministic）：**

1. `must_include` 保底 → 強制進 Top Picks
2. `importance_score` desc（有 AI 時）
3. 無 AI 時：`score` desc（關鍵字 × 權重）
4. `first_seen_at` desc（新優先）
5. `id` asc（保證 deterministic）

**連結追蹤（Phase 2 啟用）：**

- Email 中的原文連結走自己的 redirect：`/r?pid=<post_id>` → 302 到 FB
- 記錄 click log（post_id、時間）到 `feedback` 表
- 不碰 FB cookies、不登入，純記錄點擊

**回覆回饋（Phase 2 啟用）：**

- 使用者回覆 email 輸入 `GOOD 3,7,12` / `MUTE 1,4` / `PIN 3,9`（用序號或短碼）
- **Stable Token（防序號漂移）**：
  - 每則貼文附短碼 `[#A1B2]`（= `base32(sha256(post_id)).slice(0,4)`）
  - 回覆允許 `GOOD #A1B2`（短碼最準）或 `GOOD 3`（序號仍可用）
  - 決策快照 `run-{run_id}.json` 建立雙向映射：`index → post_id`、`shortcode → post_id`
  - 短碼跨天不變（因為綁 post_id），序號只在當天有效
- **容錯解析**：支援 `GOOD 3 7 12`、`GOOD: 3,7,12`、`GOOD #A1B2`、`好 3,7`、全形逗號、換行分隔
  - 序號只取 1~60 整數，短碼取 4 位英數，無效輸入靜默忽略（不報錯、不告警）
- 系統解析回覆 → 存入 `feedback` 表
- `good` → sources.json weight +0.1
- `pin` → sources.json weight +0.2，週報必收錄
- `mute_group` → sources.json weight -0.2（或 enabled=false）

**Weight 動態調整約束（防暴衝/打死）：**

- `weight ∈ [0.2, 3.0]`（硬上下限）
- 每個群組每日最多調整一次（cooldown 24h，以 `sources.json` 的 `last_weight_update` 欄位控制）
- 連續 GOOD 仍不會超過 3.0；單次 MUTE 不會低於 0.2
- `pin` 加成大於 `good`（+0.2 vs +0.1），但仍受上限

Footer：run_id、三段成功率、L2 成功率、「回信 GOOD/MUTE/PIN + 序號」說明

同時存 `data/runtime/latest.html`

### M9.5: 決策快照（每次 run 產出）

每次 run 產出 `data/runtime/run-{run_id}.json`，記錄 Top Picks 的完整排序過程：

```json
{
  "run_id": "...",
  "created_at": "...",
  "posts": [{
    "id": "...",
    "group": "...",
    "weight": 1.2,
    "rule_boost": 60,
    "novelty_penalty": -15,
    "ai_score": 85,
    "calibrated_score": 82,
    "final_rank": 1,
    "section": "top_picks",
    "quota_reason": "ai"
  }],
  "top_picks_ids": ["..."],
  "quota_breakdown": {
    "must_include": 3,
    "ai": 12,
    "rule": 5
  }
}
```

- 每筆 post 含完整分數拆解：weight / rule_boost / novelty_penalty / ai_score / calibrated_score / final_rank
- `section`：`top_picks` | `everything_else` | `overflow`
- `quota_reason`：`must_include` | `ai` | `rule`（為什麼進 Top Picks）
- 用途：調參時可回放任何一天的排序，像策略回測
- 保留 7 天（cron 清理舊檔）

### M10: Post Scorer（含 novelty 降權）

- 評分維度：
  - 關鍵字匹配 × 群組權重
  - Rule Filter 保底/降權
  - **Novelty 降權（兩層 signature）**：
    - `topic_signature`（tags/keyword hash）→ 24h 重複降 10-20 分
    - `source_signature`（同群組同作者）→ 7d 重複只降很小（保護連載型內容）
    - `rules.json` 可指定 `no_novelty_penalty_groups: [...]`（不降權的群組）
    - **Novelty 豁免**：若命中 `must_keywords`，topic_signature 降權減半（保護重大新聞連續多天報導）
    - `rules.json` 可設 `novelty_exempt_keywords: ["破產", "裁員", "地震", ...]`（完全不降權的關鍵字）
    - 讓晨報更「有用」而非更「長」

### M11: 故障告警

- IMAP label 不存在 → 告警
- IMAP 0 封 → 告警
- `email_parse_ok_rate` < 90% → 告警
- `high_conf_rate` 較前次下降 > 20% → 警告
- 新 template_fp 比例 > 50% → 警告
- SMTP 失敗 → stderr log + retry 1 次

### M12: VPS Cron 部署

- `tools/deploy.sh` 新增 `social-digest` agent
- Cron：每日 UTC 23:00（台灣 07:00）
- `cd ~/clawd/agents/social-digest && node agent.js run`

---

## Phase 2：AI 摘要 + L2 增強 + 回饋閉環（第 2-3 週）

### M13: AI Summarizer（批次 + 排序器 + 可解釋）

- 用 OpenAI API（gpt-4o-mini）
- **AI 是排序器**：不篩掉任何貼文，只加分類/摘要/排序/理由
- **只對 `sent_at IS NULL AND post_id NOT IN ai_results` 的貼文送 AI**
- **Daily cap**：`AI_MAX_POSTS_PER_DAY = 200`、`AI_MAX_BATCHES = 6`
  - 超過 cap → 告警 "AI budget reached"，但 digest 仍產出（用 L1 snippet + 規則排序）
- 批次 prompt：一次 20-50 則

模型輸出 JSON schema：

```json
{
  "posts": [{
    "id": "...",
    "category": "技術",
    "summary": "2-4 行摘要",
    "tags": ["#AI", "#Claude"],
    "importance_score": 85,
    "ai_confidence": "HIGH",
    "reasons": ["群組權重高且含 Claude 關鍵字", "今日首次出現此主題"]
  }]
}
```

- `reasons`：最多 3 點，每點 ≤60 字（解釋為什麼排前面，必須引用可驗證因素如權重/關鍵字/新奇度，禁止空泛語句）
- `ai_confidence`：HIGH/MED/LOW。**LOW 的 importance_score 上限 70**（除非 must_include）
- `matched_rules_json`：命中哪些 rules.json 規則
- AI 結果存入 `ai_results` 表（快取）
- Config 設定分類規則和 prompt，`prompt_version` 追蹤迭代

**AI 分數校正（Score Calibration）：**

AI 的 importance_score 常有尺度漂移（今天嚴、明天鬆），不能直接用絕對值排序。

校正流程（在 Post Scorer 中執行）：
1. 取當天 AI 分數分布的 P50 和 P80
2. 線性拉伸：`calibrated = (raw - P50) / (P80 - P50) * 30 + 50`
   - 使 P50 ≈ 50、P80 ≈ 80（固定分布錨點）
3. 裁切到 [0, 100]
4. 再套上 must_include 保底（60）與 novelty 降權
5. `calibrated_score` 存入決策快照（不覆蓋 ai_results 原始分數）

效果：Top Picks 每天品質穩定，不會因模型心情而忽嚴忽鬆。

**降級（跳過校正，直接用原始分數）：**

- 當天 AI 結果 < 10 筆（樣本太少）
- P80 == P50（分數全一樣，除以 0）→ 跳過校正，加輕微 jitter
- `ai_confidence=LOW` 的比例 > 50%（模型不穩，硬拉沒意義）

### M14: Public Fetcher（L2 增強，零風險 + 禮貌節流 + 快取）

- 對 `sources.json` 中 `"public": true` 且 `"enabled": true` 的群組/粉專
- **內容快取**：`l2_fetched_at` 在 7 天內 → 不重抓（除非 `--force-l2`）
- HTTP GET：中性 UA `social-digest/1.0`、不帶 cookie、Timeout 3s、max 2 hops
- 禮貌節流：`max_concurrency: 2`、sleep 200-400ms、429 直接降級
- 只解析 OG meta tags
- L2 成功率記錄到 `runs` 表

### M15: 回饋閉環 + Click 追蹤

- Email redirect `/r?pid=...` → 302 到 FB → `feedback` 記錄 click
- 回覆 `GOOD 3,7` / `MUTE 1` → 解析序號 → `feedback` 記錄
- weight 動態調整：good +0.1、mute -0.2
- runs 表記錄 click_count / good_count / mute_count

### M16: 有效性 KPI — 4 層驗證（可監控）

**指標主次（寫死，調參時只看這個順序）：**

| 層級 | 指標 | 用途 |
|------|------|------|
| 主指標 | NDCG@20 + NS（North Star） | 排序品質 + 整體效用 |
| 輔指標 | CTR_top、first_click_rank | 快速觀察用，不作決策依據 |
| 健康指標 | must_include=100%、parse_ok_rate>=90% | 硬約束，違反即告警 |

**訊號強度定義（全局通用）：**

| 訊號 | 權重 | 類型 | 說明 |
|------|------|------|------|
| click | 1 | 弱訊號 | 點了不代表有用，可能秒退 |
| good | 2 | 強訊號 | 使用者主動標記有價值 |
| pin | 3 | 最強訊號 | 使用者認為必收藏 |

- click 是弱訊號、GOOD/PIN 是強訊號 — 所有 KPI 計算都用此權重
- CTR 僅作參考，核心指標以 NDCG（含權重）為準

**層 1：效用指標（快速觀察）**

- `CTR_top = top_picks_click_count / top_picks_count`
- `CTR_all = click_count / sent_count`
- 期望：CTR_top 長期 ~2x CTR_all → AI 排序有效
- CTR_top ≈ CTR_all → AI 排序失效或偏好變了
- 注意：CTR 是弱指標，可能被內容量影響，需搭配 NDCG 驗證

**層 2：排序品質 NDCG@K（比 Hit@K 更準）**

Hit@K 只看是否命中，不看位置差異。改用 NDCG@20 作為主指標：

- 回饋權重：`pin = 3`、`good = 2`、`click = 1`
- NDCG@20 越高 → 越重要的越靠前（ranking 系統標準指標）
- 門檻：兩週後 NDCG@20 >= 0.6；< 0.4 → 需調規則/權重/prompt
- 實作：每週跑一次 SQL 匯出 + Node 計算（不需即時）
- Hit@20 保留作為輔助參考（更直覺）

**層 3：漏報防護**

- `must_include_in_digest_rate` 必須 100%（硬規則保證）
- `must_include_in_top_picks_rate`（在 quota 內應接近 100%）
- 這層做對 → 心理壓力最低

**層 4：對照實驗（Phase 3 A/B）**

- 比較 AI vs 規則排序的 CTR / GOOD / first_click_position

### 北極星指標（North Star Metric）

目標是「早上 3 分鐘掃完、找到值得點的」，不是追求模型分數。

`NS = (pin_count × 3 + good_count × 2 + top_picks_click_count × 1) / top_picks_count`

搭配硬約束：

- `must_include_in_digest_rate` = 100%
- `email_parse_ok_rate` >= 90%

**判斷標準：** NS 持續上升 + 硬約束滿足 → AI 排序確實有用。NS 下降 → 立即觸發校正。

### 校正優先順序（由快到慢）

1. 調 sources weight（good +0.1 / mute -0.2）
2. 調 rules.json（must_keywords / mute_keywords / no_novelty_penalty）
3. 調 prompt_version（要求 reasons 引用可驗證因素，禁止空泛語句）
4. 若 NS 持續低於 Baseline-0 → 觸發 Kill Switch

### Kill Switch（AI 自動降級）

像投研系統的策略失效自動降級：

- **觸發條件 1**：連續 7 天 `NS_AI < NS_Baseline0` → `config.AI_ENABLED = false`
- **觸發條件 2**：NDCG@20 < 0.4 連續兩週 → `config.AI_ENABLED = false`
- **降級行為**：停用 AI 排序，改用純規則排序，digest 仍正常產出
- **恢復條件**：手動設 `AI_ENABLED = true` 後觀察一週，NS 回升才保持
- 每次 Kill Switch 觸發/恢復記錄到 `runs.errors`（可追溯）

---

## Phase 3：進階功能（第 4 週+）

### M16.5: 落地文件（Phase 2 完成時產出）

使用者已提供完整版本，實作時直接寫入：

- **`docs/social-digest/EVALUATION.md`** — AI 有效性驗證規格（10 章：核心哲學、可觀測性、指標主次、訊號權重、指標定義含 NDCG/NS/CTR、Baseline-0、A/B 校驗、校正順序、Kill Switch、最小驗收）
- **`docs/social-digest/OPS-RUNBOOK.md`** — 運營排障手冊（每日例行 3 分鐘 + 10 類告警排查 A~J + Kill Switch 處理 + Debug Recipes + 安全規則 + debug 檔保留）

### M17: 週報彙整

- 每週日發送本週精選（importance_score top N + click 最多）

### M18: A/B 校驗（每週一次）+ 保守基準線

**Baseline-0（最低基準線）：只按群組權重 × 時間排序（不看關鍵字、不看 AI）**

- AI 至少要贏 Baseline-0 才算有用
- 每週計算 Baseline-0 的虛擬 NDCG@20（用歷史回饋資料回算）
- 如果 AI 連 Baseline-0 都贏不了 → 立即停用 AI 排序，回退到純規則

**A/B 測試：**

- 每週三執行，**分兩封信**寄出（避免同封互相干擾點擊歸因）：
  - A 信（主旨標 `[A]`）：AI 排序 Top 20
  - B 信（主旨標 `[B]`）：純規則排序 Top 20
- 連結走 redirect（`/r?pid=...&variant=A|B`）準確歸因
- 比較維度：
  - CTR_A vs CTR_B
  - GOOD_A vs GOOD_B
  - `first_click_rank`（第一次點擊的是第幾則）— A 更小 = AI 更會排
  - `time_to_first_click_sec`（寄出到第一次點擊的秒數）— A 更短 = AI 更會排
- A 的 CTR 高 + first_click_rank 小 → AI 有用的硬證據

### M19: 來源擴展

- 追蹤粉專 / Pages 清單匯出
- 統一進 `sources.json`，`type` = `group` / `page` / `rss` / `x`

---

## 關鍵檔案

| 檔案 | 用途 |
|------|------|
| `src/agents/social-digest/agent.js` | CLI 入口 |
| `src/agents/social-digest/config.json` | IMAP/SMTP/AI 設定 |
| `src/agents/social-digest/data/rules.json` | 規則定義（必看/黑名單/關鍵字） |
| `src/agents/social-digest/src/collectors/imap-collector.js` | IMAP 水位線三件套 |
| `src/agents/social-digest/src/collectors/feedback-collector.js` | 回覆回饋 IMAP 收集（Phase 2） |
| `src/agents/social-digest/src/collectors/public-fetcher.js` | L2 OG meta |
| `src/agents/social-digest/src/processors/email-parser.js` | 三層解析 |
| `src/agents/social-digest/src/processors/url-normalizer.js` | URL 正規化 |
| `src/agents/social-digest/src/processors/deduplicator.js` | SQLite 去重 |
| `src/agents/social-digest/src/processors/rule-filter.js` | 規則優先 guardrail |
| `src/agents/social-digest/src/processors/post-scorer.js` | 評分 + novelty |
| `src/agents/social-digest/src/processors/ai-summarizer.js` | AI 排序+摘要+理由 |
| `src/agents/social-digest/src/publishers/email-publisher.js` | 兩段式 digest |
| `src/agents/social-digest/src/shared/db.js` | SQLite 存取層 |
| `tools/fb-groups-export.js` | 瀏覽器 console script |
| `tools/deploy.sh` | 新增 social-digest 部署 |
| `docs/social-digest/EVALUATION.md` | AI 有效性驗證規格（指標/門檻/A/B 流程） |
| `docs/social-digest/OPS-RUNBOOK.md` | 運營排障手冊（每個告警的排查步驟） |

## 可複用的現有程式碼

| 來源 | 用途 |
|------|------|
| `src/shared/agent-template/` | agent 骨架 |
| `src/agents/market-digest/shared/config-loader.js` | 設定載入 |
| `src/agents/market-digest/shared/logger.js` | 結構化 log |
| `src/agents/market-digest/shared/http-client.js` | HTTP 請求 + retry |
| `src/agents/market-digest/shared/cache-manager.js` | TTL cache |

## 環境需求

```bash
# VPS .env 新增
GMAIL_IMAP_USER=your@gmail.com
GMAIL_IMAP_PASSWORD=xxxx-xxxx-xxxx-xxxx  # Gmail App Password
GMAIL_SMTP_USER=your@gmail.com
GMAIL_SMTP_PASSWORD=xxxx-xxxx-xxxx-xxxx
DIGEST_RECIPIENT=your@email.com
OPENAI_API_KEY=sk-...  # Phase 2 AI 摘要用
```

**Gmail 設定（必做）：**

1. 開啟 2FA → 產生 App Password
2. 建立 Filter → Apply label（對應 `IMAP_LABEL`）、Skip Inbox
3. Facebook 設定 → 通知偏好 → 開啟群組活動 email 通知

## 驗收標準

### 功能驗收

- [ ] 在 `tools/fb-groups-export.js` 新增 browser console script（含 scroll-to-bottom + MutationObserver），驗收：`node -e "const s=require('fs').readFileSync('tools/fb-groups-export.js','utf8'); console.log(s.includes('MutationObserver') && s.includes('scroll'))"` 輸出 `true`
- [ ] 在 `src/agents/social-digest/src/collectors/imap-collector.js` 實作 IMAP 水位線收信，驗收：`node src/agents/social-digest/agent.js run --dry-run` 產出 `data/runtime/latest.html` 且含「Top Picks」字串：`grep -c "Top Picks" src/agents/social-digest/data/runtime/latest.html` 輸出 >= 1
- [ ] 在 `src/agents/social-digest/src/publishers/email-publisher.js` 實作 SMTP 寄信，驗收：`node src/agents/social-digest/agent.js run --dry-run 2>&1 | grep -c "SMTP\|email"` 輸出 >= 1（dry-run 模式跳過實際寄信，但需印出 SMTP 設定確認）
- [ ] 在 `src/agents/social-digest/agent.js` 實作 `--backfill-hours` 旗標，驗收：`node src/agents/social-digest/agent.js run --backfill-hours 24 --dry-run 2>&1 | grep -c "backfill"` 輸出 >= 1
- [ ] 在 `tools/deploy.sh` 新增 social-digest 部署段落，VPS cron 設定為 `0 23 * * *`，驗收：`grep -n "social-digest" tools/deploy.sh | grep -c "23"` 輸出 >= 1
- [ ] 在 `src/agents/social-digest/src/collectors/imap-collector.js` 確認成功跑完才更新水位線，驗收：`grep -n "imap_last_uid\|imap_last_internal_date\|imap_last_message_id" src/agents/social-digest/src/collectors/imap-collector.js | wc -l` 輸出 >= 3
- [ ] 在 `src/agents/social-digest/src/processors/rule-filter.js` 實作 must_include 保底邏輯，驗收：`grep -n "must_include" src/agents/social-digest/src/processors/rule-filter.js | wc -l` 輸出 >= 3

### 品質門檻

- [ ] 在 `src/agents/social-digest/src/processors/email-parser.js` 實作三層解析並輸出 email_parse_ok_rate，驗收：`grep -n "email_parse_ok_rate" src/agents/social-digest/src/processors/email-parser.js | wc -l` 輸出 >= 1
- [ ] 在 `src/agents/social-digest/src/processors/email-parser.js` 計算 post_extract_ok_rate，驗收：`grep -n "post_extract_ok_rate" src/agents/social-digest/src/processors/email-parser.js | wc -l` 輸出 >= 1
- [ ] 在 `src/agents/social-digest/src/processors/deduplicator.js` 實作 sha256(canonical_url) 主鍵去重，驗收：`grep -n "sha256" src/agents/social-digest/src/processors/deduplicator.js | wc -l` 輸出 >= 1
- [ ] 在 `src/agents/social-digest/src/collectors/public-fetcher.js` 記錄 L2 成功率，驗收：`grep -n "l2_success_rate" src/agents/social-digest/src/collectors/public-fetcher.js | wc -l` 輸出 >= 1
- [ ] 在 `src/agents/social-digest/data/runtime/latest.json` 包含水位線三件套，驗收：`node -e "const j=require('./src/agents/social-digest/data/runtime/latest.json'); console.log(['imap_last_uid','imap_last_internal_date','imap_last_message_id'].every(k=>k in j))"` 輸出 `true`（需先跑一次 dry-run）
- [ ] 在 `src/agents/social-digest/src/publishers/email-publisher.js` 確保排序 deterministic（importance→score→first_seen→id），驗收：`grep -n "first_seen_at\|ORDER BY\|sort" src/agents/social-digest/src/publishers/email-publisher.js | wc -l` 輸出 >= 2
- [ ] 在 `src/agents/social-digest/agent.js` 實作故障告警（IMAP 0 封、parse_ok 低、SMTP 失敗），驗收：`grep -n "alert\|warn\|IMAP_NO_MAIL\|SMTP_FAIL" src/agents/social-digest/agent.js | wc -l` 輸出 >= 3

## 風險

| 風險 | 概率 | 影響 | 緩解措施 | 驗證方式 |
|------|------|------|---------|---------|
| Facebook 改變通知 email 格式 | 中 | 高 | template_fp 指紋監控，high_conf_rate 下降時告警 | `high_conf_rate` 告警閾值 < 70% 觸發 |
| Gmail IMAP 連線不穩 | 低 | 高 | lookback_minutes=120 保險、Message-ID 去重防重抓 | `imap_last_uid` 每次 run 更新確認 |
| SMTP 寄信失敗 | 低 | 中 | retry 1 次、stderr log 告警 | `grep SMTP_FAIL logs/` 輸出 0 |
| AI API 費用超支 | 中 | 低 | daily cap MAX_POSTS=200、超過仍產出 digest（規則排序） | `runs.post_count` <= 200 |
| VPS 記憶體不足（2GB） | 低 | 中 | 批次處理、SQLite 輕量、不用 embedding model | `ps aux` 確認 node 常駐 < 200MB |

## Decision Log

- **2026-03-01**：選擇 IMAP + 無登入 HTTP GET。放棄 Playwright（封號風險）、Graph API（已廢除）。
- **2026-03-01**：P0 收信穩定性。水位線三件套（UID + internalDate + Message-ID），成功才更新。
- **2026-03-01**：Gmail label 為 config 參數（`IMAP_LABEL` + `IMAP_MAILBOX_TYPE`），啟動時驗證。
- **2026-03-01**：Parser 三層策略 + template_fp 指紋。三段成功率。
- **2026-03-01**：去重主鍵 `sha256(canonical_url)`。post_id 只是輔助。url-normalizer 處理 tracking / m.facebook / l.facebook redirect。
- **2026-03-01**：SQLite Phase 1。posts/ai_results/feedback/runs 四表。ai_results 加 reasons_json + matched_rules_json。feedback 記錄 good/mute/click。
- **2026-03-01**：sources.json Phase 1 加 `type`/`enabled`/`must_include`。
- **2026-03-01**：**AI 是排序器不是篩選器**。永遠收齊 L1，AI 加分類/摘要/排序/理由，篩選由規則+上限控制。
- **2026-03-01**：Rule Filter 在 AI 之前跑。must_include 保底 60、黑名單降權。AI 不得違反硬規則。
- **2026-03-01**：Digest 兩段式（Top Picks 完整 + Everything Else 縮短）。使用者不怕漏。
- **2026-03-01**：Novelty 降權：24h/7d tags 去重，重複主題降 10-20 分。
- **2026-03-01**：回饋閉環：redirect click 追蹤 + 回覆 GOOD/MUTE。weight 動態調整。
- **2026-03-01**：有效性 KPI：CTR、Hit@K、品質趨勢。runs 表可監控。
- **2026-03-01**：Phase 3 A/B 校驗：週三同時寄 AI vs 規則排序，量化 AI 有沒有用。
- **2026-03-01**：Digest 排序 deterministic。L2 加中性 UA、禮貌節流、7天快取。AI 批次+快取。
- **2026-03-01**：CLI 加 `--backfill-hours N`。Email 同時送 text+html。
- **2026-03-01**：Agent 命名 `social-digest`，預留擴展。
- **2026-03-01**：must_include 配額控制（quota = min(8, top_picks_max/2)），防 Top Picks 被必看群組塞爆。
- **2026-03-01**：feedback 加 `pin` action（比 good 更強，週報必收錄）。回覆解析容錯（支援空格/全形逗號/中文）。
- **2026-03-01**：Novelty 兩層 signature：topic_signature 24h 降權、source_signature 7d 只降很小（保護連載型內容）。rules.json 可設 no_novelty_penalty_groups。
- **2026-03-01**：AI daily cap（AI_MAX_POSTS_PER_DAY=200, AI_MAX_BATCHES=6），超過仍產 digest 但不做 AI enrich。
- **2026-03-01**：ai_results 加 ai_confidence（HIGH/MED/LOW），LOW 的 importance_score 上限 70（除非 must_include）。reasons 必須引用可驗證因素。
- **2026-03-01**：A/B 校驗改為分兩封信（避免互相干擾），redirect 帶 variant=A|B 歸因。
- **2026-03-01**：4 層有效性驗證：CTR_top vs CTR_all → Hit@K → 漏報防護 → A/B 對照。校正順序：weight → rules → prompt。
- **2026-03-01**：決策快照 `run-{run_id}.json`，記錄每筆 post 完整分數拆解（weight/rule_boost/novelty_penalty/ai_score/calibrated_score/final_rank/quota_reason），可回放排序。
- **2026-03-01**：rules.json 版本化（`version` 欄位），runs 記錄 `rules_version`，搭配 prompt_version 追蹤 KPI 變化原因。
- **2026-03-01**：Weight 動態調整加約束：`weight ∈ [0.2, 3.0]`、每日最多調整一次（cooldown 24h）。防暴衝/打死。
- **2026-03-01**：AI 分數校正（Score Calibration）：取 P50/P80 線性拉伸到固定分布，防尺度漂移。< 10 筆時跳過校正。
- **2026-03-01**：Everything Else overflow 策略：超過 60 則只顯示前 60，footer 顯示剩餘數量，完整清單在 latest.html。
- **2026-03-01**：NDCG@20 取代 Hit@K 作為主排序品質指標。回饋權重：pin=3、good=2、click=1。Hit@20 保留為輔助。
- **2026-03-01**：A/B 校驗新增 first_click_rank + time_to_first_click_sec 指標，runs 表新增對應欄位。
- **2026-03-01**：Baseline-0（群組權重×時間排序）作為保守基準線，AI 至少要贏 Baseline-0 才算有用，否則回退純規則。
- **2026-03-01**：訊號強度分級：click=1（弱）、good=2（強）、pin=3（最強）。所有 KPI 用此權重，CTR 僅作參考。
- **2026-03-01**：北極星指標 NS = (pin×3 + good×2 + click×1) / top_picks_count。搭配硬約束（must_include=100%、parse>=90%）。NS 持續低於 Baseline-0 → 停用 AI。
- **2026-03-01**：P0.5 Feedback Inbox。回覆回饋靠 IMAP 讀 digest 回覆信，新增 feedback-collector.js + `IMAP_FEEDBACK_LABEL`。Phase 2 啟用前必須完成。
- **2026-03-01**：feedback 表新增 rank + section 欄位，記錄點擊位置與區段，支撐 Median Click Rank / Clicks Distribution 計算。
- **2026-03-01**：Stable Token 短碼 `[#A1B2]`（base32(sha256) 前 4 位），防序號漂移。回覆支援短碼或序號。決策快照建立雙向映射。
- **2026-03-01**：must_include 排序底線：final_rank 一定 ≤ top_picks_max + 20，即使 AI 沒跑。
- **2026-03-01**：Novelty 豁免：must_keywords 命中時 topic_signature 降權減半。新增 novelty_exempt_keywords 完全不降權。
- **2026-03-01**：Score Calibration 護欄：P80==P50 → 跳過校正加 jitter；ai_confidence=LOW > 50% → 跳過校正。
- **2026-03-01**：指標主次寫死：主=NDCG@20+NS，輔=CTR_top+first_click_rank，健康=must_include+parse_ok。CTR 不作決策依據。
- **2026-03-01**：Kill Switch：連續 7 天 NS < Baseline0 或 NDCG@20 < 0.4 連續兩週 → AI_ENABLED=false，降級為純規則排序。手動恢復+觀察一週。
- **2026-03-01**：新增 EVALUATION.md + OPS-RUNBOOK.md。前者定義驗證規格，後者定義運營排障手冊。
