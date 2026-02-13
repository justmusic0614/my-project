# Optimization Advisor Agent

主動優化建議系統，定期掃描系統並提供改進建議。

## 核心功能

### 1. 智能掃描（每2小時）
- **規則引擎**：快速檢查已知問題
- **日誌分析**：識別錯誤模式
- **效能監控**：資源使用趨勢
- **設定稽核**：系統設定檢查

### 2. LLM 深度分析（每日一次）
- 使用 Claude 分析系統狀態
- 發現潛在優化機會
- 提供具體實作建議

### 3. 智能推播
- **即時推播**：發現新建議立即通知
- **每日彙總**：21:00 推送完整分析報告
- **建議去重**：避免重複推送

## 掃描範圍

### Agents & Services
- market-digest
- knowledge-digest
- security-patrol
- clawdbot-gateway
- deploy-monitor

### 系統層面
- Cron 任務優化
- systemd 服務狀態
- 日誌大小與輪轉
- 磁碟/記憶體/CPU 趨勢
- 備份策略

### 程式碼品質
- 錯誤處理完整性
- 硬編碼值檢查
- 設定檔規範

## 建議類型

### 技術優化
- 效能瓶頸
- 資源優化
- 錯誤修復

### 最佳實踐
- 程式碼結構
- 設定管理
- 日誌規範

### 功能擴展（可選）
- 新功能建議
- 整合機會
- 自動化改進

## 建議格式

### 即時建議（簡短）
```
💡 新建議 (2條)

1. 🔧 security-patrol 日誌持續增長
   建議：啟用日誌輪轉

2. ⚡ 3個cron任務時間接近
   建議：錯開執行時間避免資源競爭
```

### 每日彙總（詳細）
```
📊 每日優化建議報告

高優先級 (1)
- 🔴 market-digest 缺少錯誤處理
  影響：服務穩定性
  建議：加入 try-catch 包裹 API 呼叫

中優先級 (2)
- 🟡 knowledge-digest 資料目錄可壓縮
  預估節省：約50MB
  建議：實作自動歸檔

低優先級 (3)
- 🟢 可以整合 Notion API
  好處：雙向同步知識庫
```

## 使用方式

### 自動執行（推薦）
```cron
# 每2小時掃描
0 */2 * * * bash ~/clawd/agents/optimization-advisor/scripts/scan.sh

# 每日21:00彙總報告
0 13 * * * bash ~/clawd/agents/optimization-advisor/scripts/daily-report.sh
```

### 手動執行
```bash
# 立即掃描
node advisor.js scan

# 產生報告
node advisor.js report

# 查看歷史建議
node advisor.js history --days 7
```

## 設定

```json
{
  "scan": {
    "interval_hours": 2,
    "daily_report_time": "21:00"
  },
  "rules": {
    "log_size_mb": 100,
    "disk_growth_percent": 10,
    "error_threshold": 5,
    "memory_trend_threshold": 10
  },
  "llm": {
    "enabled": true,
    "daily_analysis": true,
    "model": "anthropic/claude-sonnet-4-5"
  },
  "notifications": {
    "instant": true,
    "daily_summary": true,
    "min_priority": "medium"
  }
}
```

## 資料結構

### 建議格式
```json
{
  "id": "uuid",
  "timestamp": "2026-02-03T10:08:00Z",
  "category": "performance|security|code-quality|feature",
  "priority": "high|medium|low",
  "title": "簡短標題",
  "description": "詳細描述",
  "suggestion": "具體建議",
  "impact": "影響說明",
  "effort": "small|medium|large",
  "source": "rule-engine|llm-analysis",
  "related_files": [],
  "status": "new|acknowledged|implemented|ignored"
}
```

## 整合

- 與 Deploy & Monitor 共用健康檢查資料
- 與 Security Patrol 共用日誌分析
- 與 Knowledge Digest 共用標籤系統
- 可選：整合 GitHub Issues（自動建立 issue）
