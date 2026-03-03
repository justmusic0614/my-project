# Social-Digest 多來源擴展 — Phase 1 執行計劃

## Context

目前 social-digest 只透過 IMAP 收 Facebook 群組通知信作為唯一來源。本計劃擴展為多來源晨報，新增 RSS feeds、GitHub Releases、GitHub Trending、Hacker News 四種合規來源。

原則：不要理論 AI 論文（無 arXiv）、完全合規（無灰色地帶爬蟲）、不破壞既有 IMAP pipeline。

Phase 1 目標：建好所有基礎建設 + HN Collector 上線，跑 3 天驗證 pipeline。Phase 2 再接 GitHub / RSS / Scoring / Publisher。

## 架構設計

```text
                 ┌─ IMAP Collector (既有) ──── Email Parser ─┐
                 │                                           │
agent.js run() ──┼─ HN Collector (Phase 1) ────────────────┼──▶ Dedup ──▶ Rule Filter ──▶ Scorer ──▶ Publisher
                 │                                           │
                 ├─ GitHub Collector (Phase 2) ─────────────┤
                 │                                           │
                 └─ RSS Collector (Phase 2) ───────────────┘
```

新 collector 產出標準 post 物件 → 匯入既有 pipeline（dedup → score → publish） → 合成一封晨報。

---

## 全域規格（全 Phase 共用）

### Type 字串（全系統唯一）

`l1_imap` | `rss` | `hackernews` | `github_releases` | `github_trending`

- sources.json `type` 欄位 = config.json `collectors` key = `post.source` 值
- **不得使用別名**（不可用 `imap` / `hn` / `gh`）

### source_key 規格

**`source_key = makeSourceKey(sourceType, sourceId)`**

- `sourceType`：collector type 字串（同上）
- `sourceId`：sources.json 的短 `id`
- 函式簽名 `makeSourceKey(sourceType, sourceId)` → `"${sourceType}:${sourceId}"`
- 不依賴 post 物件（collector 層在 normalize 前即可調用）
- 範例：`hackernews:hn_frontpage`、`rss:openai_blog`、`github_releases:gh_langchain`

適用於：

- `web_watermarks[source_key]` — 每個 source 的上次抓取完成時間
- `disabled_sources[source_key]` — 被封鎖的 source
- `feed_cache[source_key]` — RSS feed-level cache（僅 `rss:*` 使用，key = `"rss:" + source_id`，硬編碼前綴，**不使用 makeSourceKey()**）

### Post 最小契約（collector → pipeline）

所有 collector 輸出的 post 物件必須滿足：

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `id` | string | 必有 | sha256(canonical_url)，fallback 見 ID schema |
| `source` | string | 必有 | collector type（見上方 Type 字串） |
| `url` | string | 可 null | canonical URL（正規化後），null 時 id 用 fallback |
| `title` | string | 必有 | 貼文標題 |
| `published_at` | string | 必有 | ISO 8601，fallback 順序見下 |
| `snippet` | string | 必有 | 可空字串 `""`，不可 `undefined` |
| `group_name` | string | 必有 | 優先序：sourceConfig.name → parsed.group_name（IMAP/FB）→ source_id |
| `raw` | object | 必有 | 至少含 `raw.source_id`、`raw.source_item_key` |

選填：`raw_url`、`author`、`group_url`、`snippet_hash`、`confidence`、`template_fp`、`raw_email_message_id`、`post_id`

**published_at fallback 順序：**

- RSS/HN：`isoDate` → `pubDate` / `published` → fetch_time
- GitHub Releases：`published_at` → `created_at` → fetch_time
- GitHub Trending：直接用 fetch_time（daily snapshot 語意）

**欄位語意：**

- `post.source` = **collector type**（用於 `idx_posts_source` 查堆積量）
- `post.group_name` = **來源顯示名稱**（用於 email render）
- `raw.source_id` = **sources.json 短 id**（用於 watermark/disabled/feed_cache）

### ID schema

- `id`：DB primary key
  - 一般：`sha256(canonical_url)`
  - 無 URL 時：`sha256(source_id + ":" + source_item_key)`
  - **例外：`github_trending` 強制走 fallback**（repo URL 固定但 source_item_key 含日期，每日一次）
    - `post.url` 仍為 repo canonical_url（email 連結指向 repo）
- `post_id`：**不動**，保留 IMAP 語意（email message-id），web 來源設 null
- `source_item_key` 優先序（per source type）：
  - RSS：link → guid → title + published_at（link 更穩；保留 `raw.guid`、`raw.link` debug 用）
  - HN：guid → link
  - GitHub Releases：`${repo}#${release_id}`
  - GitHub Trending：`${full_name}:${yyyy-mm-dd}`

### canonical_url 正規化（保守策略）

- 只移除白名單 tracking query：`utm_*`、`fbclid`、`ref`、`source`、`__tn__`、`amp`、`outputType`
- **不得清空所有 query**
- 去掉 trailing slash
- `m.` → 去掉；`www.` 不動
- `http` → `https`：僅當 host 在 `HTTPS_ONLY_HOSTS` Set 內（定義在 `web-normalizer.js` 頂部，全系統唯一一份）
- 保留 `raw_url` 存原始 URL

### stats 欄位定義（全 collector 統一）

- `ok`：`true` = >=1 source 成功（200/304 + parse ok，即使 posts=0）；`false` = 0 sources 成功或 crash
- `fetched`：HTTP/API 取得的 items 原始數量
- `parsed`：成功 parse 成 item 的數量
- `filtered`：被時間窗/條件過濾掉的數量（不含 dedup）
- `new`：**dedup 後**增量（本次入庫/進下一步的 posts 數）
- `skipped_disabled`：number，因 disabled 跳過的 source 數
- `errors[]`：collector-level 結構性錯誤
- `source_failures[]`：`[{ source_key, reason, detail? }]`
- `disabled[]`：`[{ source_key, until, reason }]`
- `duration_ms`：整個 collector 執行時間

### Watermark 策略（per-source）

- watermark 存 `fetch_completed_at`（source 成功完成抓取的時間）
- 只在該 source 成功時更新
- `effective_since = watermark - safetyWindowMinutes`（預設 180 分鐘）
- 過濾：`item.published_at > effective_since`
  - published_at 解析失敗 → **不做時間過濾**，靠 dedup 兜底
  - 設 `raw.publish_confidence = "LOW"`，scorer 降低 recency_score
- 多抓無妨，dedup 以 `post.id` 兜底

### 403/429 disabled_until 持久化

**儲存位置：** `latest.json` 的 `disabled_sources` map，key 用 source_key

```json
{
  "disabled_sources": {
    "rss:tldr_ai": { "until": "2026-03-04T12:00:00Z", "reason": "403", "since": "2026-03-03T12:00:00Z", "consecutive": 1 }
  }
}
```

**Backoff 策略（寫死）：**

- **429**：優先用 `Retry-After`；沒有則 `now + 30min * 2^k`（k = consecutive，上限 6）
- **403**：`now + 24h` 起跳；連續 3 次 → 72h；上限 7d
- **成功**：清空 disabled entry + consecutive 歸 0
- **consecutive**：失敗 +1，成功歸 0，「跳過 disabled」（until > now）**不加** consecutive

**run() 流程：**

1. `loadLatest()` 讀取 `disabled_sources`
2. collector 跳過 `until > now` 的 source，`stats.skipped_disabled` 累加
3. 遇 403/429 回傳 `disabled[]`：`[{ source_key, until, reason, consecutive }]`
4. 成功回傳 `recovered[]`：`[source_key]`
5. `saveLatest()` 合併：disabled 覆寫同 key；recovered 刪除 key；過期清理

### DB Schema

不做 migration，不改 posts table 欄位語意：

- `id`：primary key（sha256 canonical_url / fallback）
- `post_id`：保留 IMAP 用途，web 來源設 NULL
- `url`：存 canonical_url（正規化後）
- `raw_url`：存原始 URL
- `snippet`：HTML strip + 500 字元截斷
- `source`：新增值 `rss`、`github_releases`、`github_trending`、`hackernews`
- `template_fp`：**復用既有 TEXT column**（免 migration）
  - `l1_imap`：沿用 template fingerprint 字串
  - web 來源：存 raw JSON string（`JSON.stringify(obj)`，object 型別，上限 8KB）
  - **讀取端契約**：必須先用 `post.source` 判斷解析方式
  - **容錯**：JSON.parse 失敗 → `{ source_id: "unknown", source_item_key: "unknown", parse_error: true }`，記 stats `raw_parse_error`
- raw 必含：`source_id`、`source_item_key`（永不裁剪）
- 超 8KB 裁剪順序：snippet（500→300→200）→ `raw.html`/`raw.description_html` → `raw.etag`/`raw.last_modified`
- 新增 index：`idx_posts_source`、`idx_posts_source_first_seen`（`first_seen_at` 已在現有 schema 確認存在）

### sources.json 每筆必填欄位

- `id`：短字串
- `type`：collector type（= `post.source`，全系統唯一）
- `enabled`：boolean
- `name`：顯示名稱
- `url`：feed URL（rss/hackernews）
- `repo`：owner/repo（github_releases）
- `queries`：查詢陣列（github_trending）
- 各 type 只需自己的欄位

### collector_stats vs per-source 狀態

- `collector_stats` key = **collector type**（per-collector 聚合統計）
- per-source 狀態放 `source_failures[]` / `disabled[]` / `web_watermarks` / `disabled_sources`

---

## Phase 1 執行項目

### 1.1 新增 `src/collectors/http-client.js`

輕量 HTTP client（Node 內建 `https`）：

- `fetchText(url, opts)` / `fetchJSON(url, opts)`
- 重試 + exponential backoff（3 次）
- 雙段 timeout：connect 5s、read 15s
- gzip/deflate 支援
- 硬性 2MB 上限，超過直接 fail（不截斷）
- User-Agent：`social-digest/1.0`
- 403/429：throw `HttpError`（含 `status`、`retryAfterSec`、`headers`），**不計算 disabled_until**（在 collector 層做）
- 可選 `If-Modified-Since` / `ETag`
- 參考 `src/agents/market-digest/shared/http-client.js` 精簡化

### 1.2 新增 `src/processors/web-normalizer.js`

`normalizeToPost(item, sourceConfig)` → 標準 post 物件（依全域 Post 最小契約）

- ID schema、canonical_url 正規化、snippet 處理（HTML strip + 500 字元 + podcast 特殊處理）
- `HTTPS_ONLY_HOSTS` Set 定義在此檔案頂部

### 1.3 擴展 `src/shared/source-manager.js`

- 新增 `getEnabledByType(type)` — 按 type 過濾
- 新增 `getById(id)` — 用短 id 查找
- `getEnabled()` 回傳所有 type

### 1.4 擴展 `src/shared/db.js`

```sql
CREATE INDEX IF NOT EXISTS idx_posts_source ON posts(source);
CREATE INDEX IF NOT EXISTS idx_posts_source_first_seen ON posts(source, first_seen_at DESC);
```

### 1.5 `package.json` 新增 `rss-parser: "^3.13.0"`

### 1.6 新增 `src/collectors/hn-collector.js`

- hnrss.org RSS feed（合規公開服務）
- `rss-parser` 解析，timeout 15s
- 統一回傳格式：`{ posts, watermark, stats }`
- Watermark / disabled / recovered 依全域規格

### 1.7 修改 `agent.js` — Step 1b Web 收集

在 Step 1（IMAP）和 Step 2（解析+去重）之間插入：

- web collector 以 `Promise.allSettled` 並行
- log collector stats summary（表格式）
- merge posts + deep merge watermark（key-level，只更新成功的 key）
- `config.collectors.{type}.enabled` 開關
- `loadLatest()` 讀 `disabled_sources` → 傳給 collector → `saveLatest()` 合併

### 1.8 修改 `config.json`

> collectors key **必須等於 post.source**。

```json
{
  "http": {
    "connectTimeout": 5000,
    "readTimeout": 15000,
    "maxResponseSize": 2097152,
    "userAgent": "social-digest/1.0",
    "concurrency": 3
  },
  "collectors": {
    "l1_imap": { "enabled": true },
    "hackernews": { "enabled": true, "maxItems": 30, "safetyWindowMinutes": 180 },
    "rss": { "enabled": false, "maxItemsPerFeed": 20, "maxAgeHours": 336, "safetyWindowMinutes": 180 },
    "github_releases": { "enabled": false, "token": "${GITHUB_TOKEN:-}", "maxReleasesPerRepo": 3, "safetyWindowMinutes": 180 },
    "github_trending": { "enabled": false, "token": "${GITHUB_TOKEN:-}", "minStars": 50, "createdWithinDays": 7 }
  }
}
```

> Phase 1 只啟用 `l1_imap` + `hackernews`，其餘 Phase 2 再開。

### 1.9 擴展 `data/sources.json` — 僅新增 HN 2 筆 + 既有 FB 加 id/type 欄位

| id | type | 名稱 | URL |
| --- | --- | --- | --- |
| hn_frontpage | hackernews | HN Front Page | `https://hnrss.org/frontpage?count=30&points=50` |
| hn_aiml | hackernews | HN AI/ML | `https://hnrss.org/newest?q=AI+OR+LLM+OR+agent&count=20&points=20` |

既有 69 個 FB 群組每筆補上 `id`（短字串）和 `type: "l1_imap"` 欄位。

### 1.10 修改 `saveLatest()` — 新增 web_watermarks + collector_stats + disabled_sources

```json
{
  "web_watermarks": {
    "hackernews:hn_frontpage": "2026-03-03T23:00:00Z",
    "hackernews:hn_aiml": "2026-03-03T23:00:00Z"
  },
  "collector_stats": {
    "hackernews": { "ok": true, "fetched": 30, "new": 12, "duration_ms": 2300 }
  },
  "disabled_sources": {}
}
```

key-level deep merge：只更新成功的 key，其餘原封不動。

commit + push → **跑 3 天只看 HN + IMAP，驗證 stats/watermark/dedup 穩定**

---

## Phase 1 關鍵檔案

新增（3 個）：

1. `src/agents/social-digest/src/collectors/http-client.js`
2. `src/agents/social-digest/src/collectors/hn-collector.js`
3. `src/agents/social-digest/src/processors/web-normalizer.js`

修改（5 個）：

1. `src/agents/social-digest/agent.js` — Step 1b + saveLatest 擴展
2. `src/agents/social-digest/config.json` — http + collectors
3. `src/agents/social-digest/package.json` — rss-parser
4. `src/agents/social-digest/data/sources.json` — HN 2 筆 + 既有加 id/type
5. `src/agents/social-digest/src/shared/source-manager.js` — getEnabledByType/getById
6. `src/agents/social-digest/src/shared/db.js` — 2 個新 index

---

## Phase 1 驗證方式

```bash
# 1. 安裝依賴
cd src/agents/social-digest && npm install

# 2. dry-run（不寄信，不需 IMAP）
node agent.js run --dry-run

# 3. collector stats summary（run 結束時 stderr 輸出表格）

# 4. DB HN 數量
node -e "
  const {getDB} = require('./src/shared/db');
  const db = getDB(__dirname, 'data/social-digest.db');
  const r = db.db.prepare('SELECT COUNT(*) as n FROM posts WHERE source = ?').get('hackernews');
  console.log('hackernews:', r.n);
"

# 5. watermark 確認
cat data/runtime/latest.json | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log('watermarks:', d.web_watermarks);
  console.log('stats:', d.collector_stats);
  console.log('disabled:', d.disabled_sources);
"
```

---

## Phase 2 銜接（下次執行）

Phase 1 跑穩後依序開啟：

1. **GitHub Releases Collector** — `src/collectors/github-collector.js`（collectReleases）
2. **RSS Collector** — `src/collectors/rss-collector.js`（concurrency 3，feed_cache，podcast 處理）
3. **Dedup 增強** — soft-dedup（sha1 domain+title+date，漸進降權 -5/-10/-15）
4. **Sources 擴展** — RSS 26 筆 + GitHub 5 筆 + IMAP newsletter 1 筆
5. **Scoring 增強** — 6 個新訊號（source_type_boost, domain_reputation, keyword_packs, recency_curve, language_hint, source_trust_penalty）
6. **Publisher 微調** — 來源標籤 [RSS]/[GH]/[HN]/[POD] + 按 category 分段 + 來源節流 caps
7. **GitHub Trending** — 最後開（enabled: false → true）

### Phase 2 已確認的 Sources 清單

#### RSS — AI/Tech（14 筆）

| id | 名稱 | URL |
| --- | --- | --- |
| anthropic_news | Anthropic News | `https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml` |
| openai_blog | OpenAI Blog | `https://openai.com/blog/rss.xml` |
| google_ai | Google AI Blog | `https://blog.google/technology/ai/rss/` |
| bens_bites | Ben's Bites | `https://www.bensbites.com/feed` |
| latent_space | Latent Space | `https://www.latent.space/feed` |
| ai_tidbits | AI Tidbits | `https://www.aitidbits.ai/feed` |
| ai_supremacy | AI Supremacy | `https://www.ai-supremacy.com/feed` |
| simon_willison | Simon Willison | `https://simonwillison.net/atom/everything/` |
| interconnects | Interconnects | `https://www.interconnects.ai/feed` |
| nlp_news | NLP News | `https://nlp.elvissaravia.com/feed` |
| pragmatic_eng | Pragmatic Engineer | `https://newsletter.pragmaticengineer.com/feed` |
| bytebytego | ByteByteGo | `https://blog.bytebytego.com/feed` |
| lennys | Lenny's Newsletter | `https://www.lennysnewsletter.com/feed` |
| tldr_ai | TLDR AI | `https://tldr.tech/api/rss/ai` |

#### RSS — 投資/財經大師（4 筆）

| id | 名稱 | URL |
| --- | --- | --- |
| lyn_alden | Lyn Alden | `https://www.lynalden.com/feed/` |
| stratechery | Stratechery | `https://stratechery.com/feed/` |
| bridgewater | Bridgewater | `https://www.bridgewater.com/research-and-insights.rss` |
| naval | Naval Ravikant | `https://nav.al/feed` |

#### RSS — Podcast（4 筆）

| id | 名稱 | URL |
| --- | --- | --- |
| a16z_show | a16z Show | `https://feeds.simplecast.com/JGE3yC0V` |
| a16z_ai | AI + a16z | `https://feeds.simplecast.com/Hb_IuXOo` |
| real_vision | Real Vision | `https://feeds.megaphone.fm/realvision` |
| invest_best | Invest Like the Best | `https://feeds.megaphone.fm/CLS2859450455` |

#### RSS — 主流財經新聞（4 筆）

| id | 名稱 | URL |
| --- | --- | --- |
| udn_money | 經濟日報 | `https://money.udn.com/rssfeed/news/1001/5591/latest` |
| cnyes | 鉅亨網 | `https://news.cnyes.com/rss/v1/news/category/headline` |
| cnbc_biz | CNBC Business | `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147` |
| cnbc_tech | CNBC Technology | `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19854910` |

#### GitHub Releases（5 筆）

| id | 名稱 | Repo |
| --- | --- | --- |
| gh_langchain | LangChain | `langchain-ai/langchain` |
| gh_crewai | CrewAI | `crewAIInc/crewAI` |
| gh_autogen | AutoGen | `microsoft/autogen` |
| gh_anthropic_sdk | Anthropic SDK | `anthropics/anthropic-sdk-python` |
| gh_openai_sdk | OpenAI SDK | `openai/openai-python` |

#### GitHub Trending（1 筆，預設 disabled）

| id | 名稱 | 備註 |
| --- | --- | --- |
| gh_trending_ai | GitHub AI Trending | 雙查詢，最後開 |

#### IMAP Newsletter（1 筆）

| id | 名稱 | 方式 |
| --- | --- | --- |
| ng_the_batch | Andrew Ng - The Batch | Gmail filter + IMAP |

#### X/Twitter（2 筆，Phase 3+ 再處理，enabled: false）

| id | 名稱 | 帳號 |
| --- | --- | --- |
| x_karpathy | Andrej Karpathy | @karpathy |
| x_jimfan | Jim Fan | @DrJimFan |

### 排除的來源

- ~~工商時報~~ — Cloudflare WAF 403
- ~~Howard Marks / Oaktree~~ — 無 RSS
- ~~Michael Mauboussin / Morgan Stanley~~ — 無 RSS
- ~~Cliff Asness / AQR~~ — 無 RSS
- ~~Stanley Druckenmiller~~ — 無任何數位管道
- ~~Discord~~ — 無免費公開 RSS
