# Kanban Dashboard

Web-based kanban board for monitoring OpenClaw AI agents and tasks.

## 架構說明

kanban-dashboard 是 Web 服務，架構不同於其他 agents（非 CLI 模式）：

- `server/index.js` — Express 後端 API
- `client/` — 前端靜態檔案
- `data/` — 任務資料持久化

## 啟動方式

```bash
# 直接啟動（本地開發）
node server/index.js

# 透過 PM2（VPS 生產環境）
pm2 start ecosystem.config.js
pm2 restart kanban-dashboard
```

## 環境變數

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `PORT` | 監聽埠號 | `3000` |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token（通知用） | — |
| `TELEGRAM_CHAT_ID` | Telegram Chat ID | — |

詳見 `TELEGRAM_SETUP.md`。

## VPS 部署狀態

- PM2 process name: `kanban-dashboard`
- 服務埠號: 3000（透過 nginx reverse proxy 對外）
- 健康檢查: `curl http://localhost:3000/api/health`

## 注意

kanban-dashboard 不符合 agent-template 標準結構（無 `agent.js` / `src/` / `data/runtime/`），
這是預期行為。詳見 CLAUDE.md 的 Agent 結構摘要。
