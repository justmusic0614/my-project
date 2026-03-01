# social-digest Agent

Facebook Groups 晨報系統。每日透過 IMAP 收集 Facebook 群組通知信 → AI 分類摘要排序 → Email 晨報。

## 核心設計

- **資料來源**：IMAP 解析 Facebook email 通知（零封號風險）
- **AI 是排序器**：永遠收齊所有 L1 貼文，AI 做分類/摘要/排序，不篩選
- **兩段式 Digest**：Top Picks（完整摘要）+ Everything Else（縮短）

## 快速開始

### 1. 設定環境變數

```bash
# 複製並編輯 .env
cp ../../../.env.example .env
# 必填：GMAIL_IMAP_USER, GMAIL_IMAP_PASSWORD, GMAIL_SMTP_USER, GMAIL_SMTP_PASSWORD, DIGEST_RECIPIENT
# Phase 2 需：OPENAI_API_KEY
```

### 2. 匯出 Facebook 群組清單

1. 開啟 https://www.facebook.com/groups/joins/
2. 打開 DevTools → Console
3. 執行 `tools/fb-groups-export.js` 的內容
4. 複製輸出 JSON，覆寫 `data/sources.json`
5. 手動調整 `enabled`、`weight`、`must_include`、`tags`

### 3. 設定 Gmail Filter

Gmail → Settings → Filters and Blocked Addresses → Create new filter:
- From: `notification@facebookmail.com`
- Subject: `in your group OR 在你的社團`
- Action: Apply label `FB-Groups`, Skip Inbox

### 4. 安裝依賴

```bash
cd src/agents/social-digest
npm install better-sqlite3 imapflow nodemailer dotenv
```

### 5. 執行

```bash
node agent.js help
node agent.js run --dry-run   # 先試跑
node agent.js run             # 正式執行
node agent.js status          # 查看上次狀態
node agent.js db-stats        # 查看資料庫統計
```

## 目錄結構

```
social-digest/
├── agent.js              # CLI 入口
├── config.json           # 設定（IMAP/SMTP/AI/DB）
├── README.md
├── src/
│   ├── collectors/
│   │   ├── imap-collector.js      # M4：IMAP 水位線收信
│   │   ├── feedback-collector.js  # M15/Phase 2：IMAP 回饋收集
│   │   └── public-fetcher.js      # M14/Phase 2：L2 OG meta 抓取
│   ├── processors/
│   │   ├── email-parser.js        # M6：三層解析 + confidence
│   │   ├── url-normalizer.js      # M5：URL 正規化
│   │   ├── deduplicator.js        # M7：跨通知去重
│   │   ├── rule-filter.js         # M8：規則優先 guardrail
│   │   ├── post-scorer.js         # M10：貼文評分 + novelty 降權
│   │   └── ai-summarizer.js       # M13/Phase 2：AI 排序+摘要
│   ├── publishers/
│   │   └── email-publisher.js     # M9：nodemailer 兩段式 digest
│   └── shared/
│       ├── db.js                  # SQLite 存取層（4 張表）
│       └── source-manager.js      # sources.json 管理 + weight 調整
├── data/
│   ├── sources.json               # 群組清單
│   ├── rules.json                 # 規則定義（含 version）
│   ├── social-digest.db           # SQLite（自動建立）
│   └── runtime/
│       ├── latest.json            # 水位線三件套 + 執行狀態
│       └── latest.html            # Digest preview（dry-run）
└── logs/
```

## 設定說明

### config.json

| 欄位 | 說明 |
|------|------|
| `imap.label` | Gmail label 名稱（env: `IMAP_LABEL`，預設 `FB-Groups`） |
| `imap.lookbackMinutes` | 水位線往前看的緩衝時間（預設 120 分鐘） |
| `ai.enabled` | 是否啟用 AI 摘要（env: `AI_ENABLED`，預設 `true`） |
| `ai.maxPostsPerDay` | AI daily cap（超過仍產 digest，但不做 AI enrich） |
| `digest.topPicksMax` | Top Picks 最大篇數（預設 20） |
| `digest.everythingElseMax` | Everything Else 最大篇數（預設 60） |

### sources.json

```json
{
  "type": "group",        // Phase 1: "group"；Phase 3 擴展 "page"/"rss"
  "name": "群組名稱",
  "url": "https://www.facebook.com/groups/...",
  "public": false,        // true = 可做 L2 fetch（公開群組）
  "enabled": true,        // false = 停用（不刪資料）
  "weight": 1.0,          // 重要性權重 [0.2, 3.0]
  "tags": ["理財"],       // 用於搜尋/過濾
  "must_include": false,  // true = 保底進 digest（importance >= 60）
  "last_weight_update": null  // 24h cooldown 控制
}
```

### rules.json

修改必須遞增 `version`（格式 `YYYY-MM-DD.N`）。`runs` 表記錄 `rules_version`，可回溯 KPI 變化原因。

## Phase 開發進度

| Phase | 里程碑 | 狀態 |
|-------|--------|------|
| 1 | M1 Console Script | ✅ |
| 1 | M2 Agent 骨架 | ✅ |
| 1 | M3 SQLite Schema | ✅ |
| 1 | M4 IMAP Collector | 待實作 |
| 1 | M5 URL Normalizer | 待實作 |
| 1 | M6 Email Parser | 待實作 |
| 1 | M7 Deduplicator | 待實作 |
| 1 | M8 Rule Filter | 待實作 |
| 1 | M9 Email Publisher | 待實作 |
| 1 | M10 Post Scorer | 待實作 |
| 1 | M11 故障告警 | 待實作 |
| 1 | M12 VPS Cron 部署 | 待實作 |
| 2 | M13 AI Summarizer | 待實作 |
| 2 | M14 Public Fetcher（L2） | 待實作 |
| 2 | M15 回饋閉環 | 待實作 |

## 水位線三件套

`data/runtime/latest.json` 記錄：

- `imap_last_uid` — IMAP UID（加速遍歷）
- `imap_last_internal_date` — 最後一封的 internalDate（主視窗）
- `imap_last_message_id` — 最後一封的 Message-ID（最終去重）

**只在成功跑完後才更新**（避免中途失敗漏抓）。

## 告警說明

| 告警 | 觸發條件 | 影響 |
|------|----------|------|
| IMAP label 不存在 | 啟動時找不到 label | 阻擋，需修 config |
| IMAP 0 封 | 收到 0 封通知 | 告警，繼續執行 |
| parse_ok_rate < 90% | email 解析失敗率高 | 告警，可能 FB 改模板 |
| high_conf_rate 下降 > 20% | 高信心解析比例下降 | 警告，監控即可 |
| SMTP 失敗 | 發信失敗 | 重試 1 次，失敗再告警 |
