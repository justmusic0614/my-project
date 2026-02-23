# 部署工作流程（歸檔）

> **注意：** 此文件已歸檔。Claude Code 的 VPS 部署操作以 `.claude/skills/vps-deploy/SKILL.md` 為準。
> 此文件保留供人類參考。

## 🎯 專案架構說明

### 兩個獨立的環境

| 環境 | 路徑 | 用途 | Git Branch |
|------|------|------|-----------|
| **本地 (macOS)** | `/Users/suweicheng/projects/my-project` | 開發環境 | `main` |
| **VPS (生產)** | `/home/clawbot/clawd` | 運行環境 | `master` |

**重要**：這兩個是**獨立的 git repositories**，不能直接 pull/merge！

### 為什麼不能直接 Git Pull？

| 項目 | 本地 (my-project) | VPS (clawd) |
|------|-------------------|-------------|
| **結構** | 完整開發專案（src/、測試、前端） | 精簡運行環境（agents/、scripts） |
| **獨有檔案** | React 前端、測試檔案、開發配置 | OpenClaw agents、運維腳本、memory/ |
| **Git 歷史** | Kanban Dashboard 開發歷史 | OpenClaw 部署歷史 |
| **目的** | 版本控制 + 開發 | 生產運行 |

---

## ✅ 正確的部署流程

### 步驟 1：本地開發

```bash
cd /Users/suweicheng/projects/my-project

# 修改程式碼
vim src/agents/shared/message-dispatcher.js

# 本地測試（可選）
npm test
node src/agents/kanban-dashboard/server/index.js
```

### 步驟 2：Commit 到本地 Git

```bash
git add .
git commit -m "描述變更內容"
```

**自動提醒**：post-commit hook 會檢查是否修改了需要同步的檔案並提醒你。

### 步驟 3：Push 到 GitHub

```bash
git push origin main
```

**用途**：
- 版本控制（可追溯歷史）
- 備份（防止本地資料遺失）
- 協作（團隊可見變更）

### 步驟 4：同步到 VPS

```bash
./scripts/sync-to-vps.sh
```

**這會同步**：
- `agents/shared/` - Dispatcher
- `agents/knowledge-digest/scripts/`
- `agents/kanban-dashboard/server/`
- `agents/kanban-dashboard/data/llm-config.json`
- `agents/kanban-dashboard/package.json`

**不會同步**：
- `src/` 下的其他開發檔案
- React 前端
- 測試檔案
- node_modules/

### 步驟 5：重啟 VPS 服務（如果需要）

**判斷是否需要重啟**：
- ✅ 修改了 server 程式碼（`server/`） → 需要重啟
- ✅ 修改了 dispatcher 邏輯 → 需要重啟
- ❌ 只修改了 `llm-config.json` → 不需要重啟（動態載入）

**重啟 Webhook Server**：
```bash
ssh clawbot@159.65.136.0 "pkill -f 'node server/index.js' && /home/clawbot/clawd/agents/kanban-dashboard/start-server.sh"
```

**檢查服務狀態**：
```bash
ssh clawbot@159.65.136.0 "tail -f /home/clawbot/clawd/agents/kanban-dashboard/logs/server.log"
```

---

## 🔍 常用檢查指令

### 檢查本地與 GitHub 同步狀態

```bash
# 查看本地未 push 的 commits
git log origin/main..HEAD

# 查看 staging area 的變更
git status
```

### 檢查 VPS 同步狀態

```bash
# 執行同步檢查腳本
./scripts/check-vps-sync.sh
```

### 檢查 VPS 服務狀態

```bash
# Webhook Server
ssh clawbot@159.65.136.0 "ps aux | grep 'node server/index.js' | grep -v grep"

# Cloudflare Tunnel
ssh clawbot@159.65.136.0 "ps aux | grep cloudflared | grep -v grep"

# 查看 Tunnel URL
ssh clawbot@159.65.136.0 "grep 'trycloudflare.com' /home/clawbot/clawd/agents/kanban-dashboard/logs/cloudflare.log | tail -1"
```

---

## 📋 完整範例工作流程

### 情境：修改 Dispatcher 路由邏輯

```bash
# 1. 本地修改
vim src/agents/shared/message-dispatcher.js

# 2. 測試（可選）
node -e "const d = require('./src/agents/shared/message-dispatcher'); console.log(d.route('/task test', {chatId: 123, username: 'test', timestamp: Date.now()/1000}))"

# 3. Commit
git add src/agents/shared/message-dispatcher.js
git commit -m "Update dispatcher routing logic for better keyword matching"

# ⚠️ post-commit hook 提醒：需要同步到 VPS！

# 4. Push to GitHub
git push origin main

# 5. 同步到 VPS
./scripts/sync-to-vps.sh

# 輸出：
# 🔄 開始同步到 VPS...
# 📦 同步: src/agents/shared
#   ✅ 目錄已同步
# 🎉 同步完成！

# 6. 重啟 VPS Webhook Server
ssh clawbot@159.65.136.0 "pkill -f 'node server/index.js' && /home/clawbot/clawd/agents/kanban-dashboard/start-server.sh"

# 輸出：
# ✅ Kanban webhook server started (PID: 54321)

# 7. 驗證
# 在 Telegram 發送測試訊息，檢查是否正常運作
```

---

## ⚠️ 重要注意事項

### 1. VPS 的 Git Repo 不要直接 commit/push

VPS 上的 `/home/clawbot/clawd` 雖然是 git repo，但：
- ❌ **不要**在 VPS 上 `git commit`（會產生衝突）
- ❌ **不要**在 VPS 上 `git pull origin main`（會破壞結構）
- ✅ **只用**來追蹤 VPS 本地變更（如 cron 產生的資料）

### 2. 同步是單向的

```
本地 (my-project)  →  VPS (clawd)
     ✅ 同步           ❌ 不回傳
```

如果在 VPS 上修改了檔案（如調整配置），需要手動複製回本地。

### 3. GitHub Remote 的用途

VPS 上設定的 `origin` remote 只用於：
- ✅ 查看本地與 GitHub 的差異（`git fetch`）
- ✅ 追蹤版本歷史（`git log origin/main`）
- ❌ **不用於** merge/pull

---

## 🔄 自動化提醒機制

### Git Post-Commit Hook

每次 commit 後，如果修改了需要同步的檔案，會自動提醒：

```
⚠️  ============================================
⚠️  VPS 同步提醒
⚠️  ============================================

📦 本次 commit 修改了需要同步到 VPS 的檔案：
  - src/agents/shared/message-dispatcher.js

💡 請執行以下指令同步到 VPS：
   /Users/suweicheng/projects/my-project/scripts/sync-to-vps.sh
```

### 每日檢查（可選）

加入 crontab 每天檢查：

```bash
# 編輯 crontab
crontab -e

# 加入這行（每天早上 9:00 檢查）
0 9 * * * /Users/suweicheng/projects/my-project/scripts/check-vps-sync.sh
```

---

## 🐛 疑難排解

### Q: 同步後 Telegram 沒反應？

```bash
# 1. 檢查 webhook server 是否運行
ssh clawbot@159.65.136.0 "ps aux | grep 'node server/index.js'"

# 2. 檢查 server log
ssh clawbot@159.65.136.0 "tail -50 /home/clawbot/clawd/agents/kanban-dashboard/logs/server.log"

# 3. 檢查 Telegram webhook 設定
curl -s "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo" | jq .url
```

### Q: Cloudflare Tunnel URL 改變了？

Tunnel 重啟後 URL 會改變，需要更新 webhook：

```bash
# 1. 查看新 URL
ssh clawbot@159.65.136.0 "grep 'trycloudflare.com' /home/clawbot/clawd/agents/kanban-dashboard/logs/cloudflare.log | tail -1"

# 2. 更新 webhook
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://NEW_URL.trycloudflare.com/api/telegram/webhook","secret_token":"<WEBHOOK_SECRET>"}'
```

### Q: npm install 失敗？

VPS 上執行：

```bash
ssh clawbot@159.65.136.0 "cd /home/clawbot/clawd/agents/kanban-dashboard && export NVM_DIR=\$HOME/.nvm && source \$NVM_DIR/nvm.sh && npm install"
```

---

## 📚 相關文件

- [scripts/README_VPS_SYNC.md](scripts/README_VPS_SYNC.md) - VPS 同步機制詳細說明
- [CLAUDE.md](CLAUDE.md) - 專案規範與指引
