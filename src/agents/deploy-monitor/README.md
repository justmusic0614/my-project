# Deploy & Monitor Agent

自動化部署與服務監控系統，整合部署、健康檢查、日誌分析與回滾功能。

## 核心功能

### 1. 一鍵部署
- Git pull 更新
- 依賴安裝（npm/pip）
- 服務重啟
- 部署驗證
- 自動備份

### 2. 服務健康檢查
- systemd 狀態監控
- 程序存活檢查
- 連接埠監聽狀態
- 記憶體/CPU 使用率
- 錯誤率統計

### 3. 日誌分析
- 即時日誌查看
- 錯誤日誌過濾
- 關鍵字搜尋
- 日誌摘要

### 4. 回滾機制
- 快速回滾到上一版本
- Git commit 回退
- 服務狀態恢復
- 回滾驗證

## 支援的服務

```json
{
  "market-digest": {
    "type": "node",
    "path": "/home/clawbot/clawd/skills/market-digest",
    "service": "market-digest.service",
    "git": true,
    "npm": true
  },
  "knowledge-digest": {
    "type": "node",
    "path": "/home/clawbot/clawd/agents/knowledge-digest",
    "service": null,
    "git": false,
    "npm": false
  },
  "clawdbot-gateway": {
    "type": "systemd",
    "service": "clawdbot-gateway.service",
    "git": false,
    "npm": false
  }
}
```

## 使用範例

### 部署
```bash
# 部署 market-digest
node deploy.js deploy market-digest

# 帶備份
node deploy.js deploy market-digest --backup
```

### 健康檢查
```bash
# 全部服務
node deploy.js health

# 特定服務
node deploy.js health market-digest
```

### 日誌
```bash
# 查看最近日誌
node deploy.js logs market-digest --lines 50

# 只看錯誤
node deploy.js logs market-digest --error

# 搜尋關鍵字
node deploy.js logs market-digest --grep "推播失敗"
```

### 回滾
```bash
# 回滾到上一版本
node deploy.js rollback market-digest

# 回滾到特定 commit
node deploy.js rollback market-digest --commit abc1234
```

## Telegram 整合

- `/deploy <service>`：部署服務
- `/health`：所有服務健康狀態
- `/health <service>`：特定服務狀態
- `/logs <service>`：查看日誌
- `/rollback <service>`：回滾服務

## 自動化監控

每小時檢查服務狀態，異常時自動推播警報。
