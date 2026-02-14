# Telegram Bot 整合設定指南

## 概述

Kanban Dashboard 現在支援透過 Telegram 指令建立和管理任務。

## 功能

- ✅ `/task add <標題>` - 建立新任務
- ✅ `/task list` - 列出進行中的任務
- ✅ `/task done <ID>` - 完成任務
- ✅ 支援優先度設定：`@high`, `@medium`, `@low`
- ✅ 支援標籤：`#tag1 #tag2`
- ✅ 自動建立 Dashboard 通知

## 指令範例

```bash
# 基本使用
/task add 買牛奶

# 設定優先度
/task add 重要會議 @high

# 加入標籤
/task add 讀書 #學習 #每日

# 組合使用
/task add 完成報告 @high #工作 #deadline

# 列出任務
/task list

# 完成任務
/task done <task_id>

# 查看幫助
/task help
```

## Webhook 設定

### 方法 1：使用 ngrok（本地開發）

1. **安裝 ngrok**
   ```bash
   brew install ngrok
   # 或從 https://ngrok.com 下載
   ```

2. **啟動 ngrok**
   ```bash
   ngrok http 3001
   ```

   會得到類似：`https://abc123.ngrok.io`

3. **設定 Telegram Webhook**
   ```bash
   curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
     -d "url=https://abc123.ngrok.io/api/telegram/webhook" \
     -d "secret_token=REDACTED_SECRET"
   ```

4. **驗證 Webhook**
   ```bash
   curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
   ```

### 方法 2：使用 VPS（生產環境）

1. **在 VPS 上設定 Nginx Reverse Proxy**

   ```nginx
   # /etc/nginx/sites-available/kanban
   server {
       listen 80;
       server_name yourdomain.com;

       location /api/telegram/webhook {
           proxy_pass http://localhost:3001;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

2. **設定 Webhook**
   ```bash
   curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
     -d "url=https://yourdomain.com/api/telegram/webhook" \
     -d "secret_token=YOUR_SECRET_TOKEN"
   ```

## 環境變數設定

在 `.env` 檔案中加入：

```bash
# Telegram Webhook Secret (optional but recommended)
TELEGRAM_WEBHOOK_SECRET=your_random_secret_string_here
```

**安全建議**：
- 生產環境務必設定 `TELEGRAM_WEBHOOK_SECRET`
- 使用強隨機字串（至少 32 字元）
- 與 Telegram `setWebhook` 的 `secret_token` 保持一致

## 測試

### 1. 本地測試（不需要 Bot）

```bash
# 測試建立任務
curl -X POST http://localhost:3001/api/telegram/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "from": {"id": 123, "username": "test"},
      "chat": {"id": 123},
      "text": "/task add 測試任務 @high #test"
    }
  }'

# 測試列表
curl -X POST http://localhost:3001/api/telegram/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "from": {"id": 123, "username": "test"},
      "chat": {"id": 123},
      "text": "/task list"
    }
  }'
```

### 2. Telegram 端測試

在 Telegram 與你的 Bot 對話：

```
/task add 買牛奶 @high #購物
/task list
/task done <task_id>
```

## 資料流程

```
Telegram 訊息
    ↓
Telegram Webhook (POST /api/telegram/webhook)
    ↓
指令解析器 (parseTaskCommand)
    ↓
Task Service (createTask / updateTask)
    ↓
Notification Service (addNotification)
    ↓
回傳確認訊息 (clawdbot message send)
```

## 整合現有 Clawdbot

當前實作使用 `clawdbot message send` 回傳訊息，與現有 agent 整合無縫：

```javascript
// telegram.js 使用與 telegram-wrapper.sh 相同的方式
execSync(`clawdbot message send --channel telegram --target ${chatId} --message "${text}"`);
```

## Troubleshooting

### Webhook 沒有收到訊息

1. **檢查 Webhook 狀態**
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
   ```

2. **檢查 Server Log**
   ```bash
   # Kanban Dashboard 的 console 輸出會顯示 webhook 請求
   [Telegram Webhook] { chatId: 123, username: 'test', text: '/task add ...' }
   ```

3. **確認 URL 可連線**
   ```bash
   curl https://your-webhook-url/api/telegram/webhook
   # 應該返回 404 或其他 HTTP 錯誤（不是連線錯誤）
   ```

### Clawdbot 回傳失敗

1. **確認 Clawdbot 已安裝**
   ```bash
   which clawdbot
   clawdbot --version
   ```

2. **測試 Clawdbot**
   ```bash
   clawdbot message send --channel telegram --target YOUR_CHAT_ID --message "測試"
   ```

3. **檢查 Error Log**
   - Server console 會顯示 `[Telegram] Failed to send reply:` 錯誤

### Task 沒有出現在 Dashboard

1. **檢查 Task 是否建立**
   ```bash
   curl http://localhost:3001/api/tasks?column=ongoing
   ```

2. **檢查 Notification**
   ```bash
   curl http://localhost:3001/api/notifications
   ```

3. **重新整理 Dashboard** - 前端不會自動更新，需要手動重新整理

## 進階功能（未來擴充）

- [ ] 支援 Inline Keyboard（快速操作按鈕）
- [ ] 支援編輯任務
- [ ] 支援刪除任務
- [ ] 支援設定截止日期
- [ ] 支援附加檔案
- [ ] 支援任務評論
- [ ] 雙向同步（Dashboard → Telegram 通知）

## 相關檔案

| 檔案 | 用途 |
|------|------|
| `server/routes/telegram.js` | Telegram webhook handler |
| `server/services/task-service.js` | Task CRUD 邏輯 |
| `server/services/notification-service.js` | 通知機制 |
| `server/index.js` | Route 註冊 |

## 參考資料

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Webhooks](https://core.telegram.org/bots/webhooks)
- [ngrok Documentation](https://ngrok.com/docs)
