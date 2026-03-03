# Social-Digest 運維手冊（OPS-RUNBOOK）

> **版本**: 2026-03-04
> **適用**: VPS (159.65.136.0) PM2 環境

---

## 1. 每日例行（~3 分鐘）

### 1.1 檢查 cron log

```bash
tail -20 ~/clawd/agents/social-digest/logs/cron.log
```

確認：
- `run 完成` 出現
- 無 `❌` error
- `top_picks` 數量 > 0

### 1.2 檢查 redirect-server

```bash
pm2 status social-digest-redirect
curl http://localhost:3100/health
```

確認 `{"ok":true}`。

### 1.3 快速 KPI 檢查

```bash
node agent.js kpi
```

看 `ns`（> 0.5 正常）和 `ndcg`（> 0.4 正常）。

---

## 2. 告警排查

### A. IMAP 連線失敗

**症狀**: `IMAP_ERROR` 或 `IMAP_NO_CREDENTIALS`

**排查**:
1. 確認 `.env` 的 `GMAIL_IMAP_USER` / `GMAIL_IMAP_PASSWORD` 有效
2. Gmail App Password 是否過期
3. 網路連線：`openssl s_client -connect imap.gmail.com:993`
4. 若 Gmail 鎖帳號：登入 Google 帳號解鎖

### B. AI Summarizer 失敗

**症狀**: `AI_ERROR` 或 `ai_batches_succeeded: 0`

**排查**:
1. 確認 `OPENAI_API_KEY` 有效：`curl https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"`
2. 檢查 `ai_flags`：`node -e "const {getDB}=require('./src/shared/db'); const db=getDB(__dirname); console.log(db.getLatestRun()?.ai_flags)"`
3. 若 `ai_budget_halted: true`：失敗率超 50%，可能是 API 限流
4. **AI 失敗不影響 pipeline**（fail-open），晨報仍會送出（rule-based 排序）

### C. SendGrid 發信失敗

**症狀**: `SMTP_FAILED`

**排查**:
1. 確認 `SENDGRID_API_KEY`：`echo $SENDGRID_API_KEY | head -c 10`
2. SendGrid 帳號額度：登入 app.sendgrid.com 查看
3. 檢查收件人 email 是否有效

### D. Redirect Server 不回應

**症狀**: `curl localhost:3100/health` 超時

**排查**:
1. `pm2 restart social-digest-redirect`
2. `pm2 logs social-digest-redirect --lines 50`
3. 確認 port 3100 未被佔用：`lsof -i :3100`

### E. Feedback 解析異常

**症狀**: `feedback_inserted: 0` 但收到回信

**排查**:
1. 確認 IMAP `feedbackLabel` 設定正確
2. 回信 subject 是否包含 `[SocialDigest XXXXXXXX]`
3. 檢查 `feedback-seen.json` 是否 Message-ID 重複
4. 手動測試：`node agent.js feedback`

### F. KPI 異常低

**症狀**: `ns < 0.3` 或 `ndcg < 0.3`

**排查**:
1. 確認有足夠 feedback：`SELECT COUNT(*) FROM feedback WHERE run_id = 'XXXXXXXX'`
2. 無 feedback → 所有 rel = 0 → NDCG = 0（正常現象，需等回饋）
3. 若持續低 → 檢查 AI 分數分布是否合理
4. 考慮調整 `rules.json` keyword_packs 或 feedback_adjustments

### G. Kill Switch 觸發

**症狀**: `kill_switch_active: true`

**排查**:
1. 讀取 `data/runtime/kill-switch.json`
2. 查看 `reason`、`kpi_at_trigger`
3. 查看 audit log：`cat data/runtime/kill-switch.log`
4. 若要恢復：手動設 `ai_enabled: true`
5. 觀察一週後確認 NS 回升

### H. DB 磁碟空間不足

**症狀**: SQLite write error

**排查**:
1. `df -h`
2. 清理舊 snapshot：`ls -la data/runtime/snapshots/ | head -20`
3. 清理舊 logs：`find logs/ -name '*.log' -mtime +30 -delete`

### I. Web Collector 異常

**症狀**: `collector_stats.rss.ok: false` 或類似

**排查**:
1. 檢查 source 是否被 disabled：`cat data/runtime/latest.json | jq .disabled_sources`
2. 過期的 disabled entry 會自動清理
3. 手動恢復：編輯 `latest.json` 刪除對應 `disabled_sources` entry

### J. Snapshot 缺失

**症狀**: `feedback_snapshot_missing > 0` 或 `redirect_unresolved > 0`

**排查**:
1. 確認 `data/runtime/snapshots/` 目錄存在
2. 確認有對應 `run-XXXXXXXX.json`
3. 舊 snapshot 7 天後自動清理 — 若 feedback 延遲超過 7 天則無法回溯

---

## 3. Kill Switch 處理 SOP

### 觸發

```
自動觸發條件（rules.json）：
  NS < baseline-0 連續 7 天
  OR
  NDCG < 0.4 連續 2 週
```

觸發後：
1. `kill-switch.json` 寫入 `ai_enabled: false`
2. Audit log 記錄事件
3. Pipeline 自動切換到 rule-based 排序（fail-open）

### 恢復

```bash
# 1. 查看觸發原因
cat data/runtime/kill-switch.json

# 2. 查看 audit log
cat data/runtime/kill-switch.log

# 3. 分析原因（AI 模型品質下降？feedback 變少？規則需調整？）

# 4. 手動恢復
# 編輯 kill-switch.json:
#   "ai_enabled": true
#   "triggered_at": null

# 5. 觀察一週
```

### 每週例行

每週一檢查：
1. `kill-switch.json` 狀態
2. 本週 NS trend（`node agent.js kpi`）
3. Audit log 是否有新事件

---

## 4. Debug Recipes

### 查看最近一次 run 的 AI 結果

```bash
node -e "
const {getDB}=require('./src/shared/db');
const db=getDB(__dirname);
const run = db.getLatestRun();
console.log('Run:', run.run_id);
console.log('AI flags:', run.ai_flags);
console.log('Tokens:', run.ai_tokens_in, '/', run.ai_tokens_out);
"
```

### 查看特定 post 的 AI 結果

```bash
node -e "
const {getDB}=require('./src/shared/db');
const db=getDB(__dirname);
const r = db.db.prepare('SELECT * FROM ai_results WHERE post_id = ?').get('POST_ID_HERE');
console.log(r);
"
```

### 手動觸發 shadow run

```bash
node agent.js kpi --shadow
```

### 查看 feedback 統計

```bash
node -e "
const {getDB}=require('./src/shared/db');
const db=getDB(__dirname);
const r = db.db.prepare('SELECT action, COUNT(*) as cnt FROM feedback GROUP BY action').all();
console.table(r);
"
```

### 清理過期 snapshot

```bash
node -e "
const { cleanupSnapshots } = require('./src/collectors/feedback-collector');
const cleaned = cleanupSnapshots(__dirname);
console.log('Cleaned:', cleaned, 'snapshots');
"
```

---

## 5. 安全規則

### 環境變數

以下變數**必須在 .env 中設定**，不可硬編碼：

| 變數 | 用途 |
|------|------|
| `GMAIL_IMAP_USER` | IMAP 帳號 |
| `GMAIL_IMAP_PASSWORD` | IMAP App Password |
| `GMAIL_SMTP_USER` | SMTP 帳號 |
| `GMAIL_SMTP_PASSWORD` | SMTP App Password |
| `SENDGRID_API_KEY` | SendGrid 發信 |
| `OPENAI_API_KEY` | AI 摘要 |
| `REDIRECT_SECRET_CURRENT` | HMAC 簽章（當前） |
| `REDIRECT_SECRET_PREV` | HMAC 簽章（輪替） |

### HMAC Secret 輪替

```bash
# 1. 生成新 secret
NEW_SECRET=$(openssl rand -hex 32)

# 2. 更新 .env
#    REDIRECT_SECRET_PREV=<原本的 CURRENT>
#    REDIRECT_SECRET_CURRENT=<新 secret>

# 3. 重啟 redirect server
pm2 restart social-digest-redirect

# 過渡期：舊信的連結仍可用（PREV key 驗證通過）
```

### DB 備份

```bash
# 每日自動備份（建議加入 cron）
cp data/social-digest.db data/social-digest.db.bak
```

---

## 6. Debug 檔保留規則

| 檔案 | 保留期 |
|------|--------|
| `data/runtime/snapshots/run-*.json` | 7 天（自動清理） |
| `data/runtime/feedback-seen.json` | 7 天（自動清理 entries） |
| `data/runtime/kill-switch.log` | 永久（append-only） |
| `data/runtime/latest.html` | 最新一份 |
| `data/runtime/latest.json` | 最新一份 |
| `logs/cron.log` | 手動清理（建議 30 天） |
