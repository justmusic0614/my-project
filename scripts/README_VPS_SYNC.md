# VPS 同步機制說明

## 問題背景

本地 (`/Users/suweicheng/projects/my-project`) 和 VPS (`/home/clawbot/clawd`) 是兩個獨立的專案，需要手動同步。

## 自動提醒機制

### 1. Git Post-Commit Hook（即時提醒）

**觸發時機**：每次 `git commit` 後
**檢查範圍**：
- `src/agents/shared/*` - Dispatcher
- `src/agents/knowledge-digest/scripts/*`
- `src/agents/kanban-dashboard/server/*`
- `src/agents/kanban-dashboard/data/*`
- `src/agents/kanban-dashboard/package.json`

**效果**：如果 commit 包含上述檔案，會在終端顯示同步提醒。

### 2. 每日檢查腳本（定期檢查）

**手動執行**：
```bash
./scripts/check-vps-sync.sh
```

**自動執行**（可選）：加入 crontab
```bash
# 每天早上 9:00 檢查
0 9 * * * /Users/suweicheng/projects/my-project/scripts/check-vps-sync.sh
```

## 同步方法

### 同步到 VPS

```bash
./scripts/sync-to-vps.sh
```

這會同步以下內容：
- Dispatcher 程式碼 (`agents/shared/`)
- Knowledge Digest 腳本
- Kanban Dashboard server
- LLM 配置檔

### 同步後需要做什麼？

1. **重啟 Kanban webhook server**（如果修改了 server 程式碼）：
   ```bash
   ssh clawbot@159.65.136.0 "pkill -f 'node server/index.js' && /home/clawbot/clawd/agents/kanban-dashboard/start-server.sh"
   ```

2. **檢查 server 狀態**：
   ```bash
   ssh clawbot@159.65.136.0 "tail -f /home/clawbot/clawd/agents/kanban-dashboard/logs/server.log"
   ```

## VPS 服務狀態

### Webhook Server
- **路徑**: `/home/clawbot/clawd/agents/kanban-dashboard`
- **Port**: 3001
- **Public URL**: Cloudflare Tunnel (動態，需查看 `logs/cloudflare.log`)
- **啟動**: `./start-server.sh`
- **Log**: `logs/server.log`

### Cloudflare Tunnel
- **用途**: 提供 HTTPS endpoint 給 Telegram webhook
- **檢查狀態**: `ps aux | grep cloudflared`
- **Log**: `logs/cloudflare.log`

## Telegram Webhook 配置

查看當前 webhook 設定：
```bash
curl -s "https://api.telegram.org/botREDACTED_TOKEN/getWebhookInfo" | jq .
```

## 常見問題

### Q: 同步後 Telegram 沒反應？
A: 檢查 webhook server 是否正常運行：
```bash
ssh clawbot@159.65.136.0 "curl -s http://localhost:3001/api/telegram/webhook -X POST -H 'Content-Type: application/json' -d '{\"message\":{\"text\":\"/task list\",\"chat\":{\"id\":123},\"from\":{\"username\":\"test\"},\"date\":1234567890}}'"
```

### Q: Cloudflare Tunnel URL 改變了？
A: 免費 tunnel 每次重啟 URL 會變，需要重新設定 webhook：
```bash
# 1. 查看新 URL
ssh clawbot@159.65.136.0 "grep 'trycloudflare.com' /home/clawbot/clawd/agents/kanban-dashboard/logs/cloudflare.log | tail -1"

# 2. 更新 webhook（替換 URL）
curl -X POST "https://api.telegram.org/botREDACTED_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://NEW_URL.trycloudflare.com/api/telegram/webhook","secret_token":"REDACTED_SECRET"}'
```

### Q: 如何永久固定 Tunnel URL？
A: 需要註冊 Cloudflare 帳號並建立 Named Tunnel（免費）：
https://developers.cloudflare.com/cloudflare-one/connections/connect-apps

## 備註

- VPS 和本地是不同的 git repo，commit 歷史不同
- 同步是**單向**的（本地 → VPS），VPS 上的變更不會回傳
- 建議在本地開發，測試後再同步到 VPS
