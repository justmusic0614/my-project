# {AGENT_NAME}

> 建立日期: YYYY-MM-DD

## 功能

{一句話描述}

## 使用方式

```bash
node agent.js run       # 執行
node agent.js status    # 查看上次執行狀態
node agent.js help      # 說明
```

## 資料目錄

| 路徑 | 用途 | 保留天數 |
|------|------|---------|
| `data/runtime/` | 短暫狀態（latest.json） | 7 |
| `logs/` | 執行日誌 | 30 |

## 配置

編輯 `config.json`，所有 `${...}` 變數從 `.env` 讀取。

## Cron（如適用）

```cron
# 範例
0 */2 * * * nice -n 10 /path/to/agent.js run >> logs/cron.log 2>&1
```
