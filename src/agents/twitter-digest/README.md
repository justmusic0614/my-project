# Twitter Digest 推特摘要 Agent

## 📋 概述

Twitter Digest agent 每日凌晨抓取關注的 Twitter 帳號推文，使用 AI 生成摘要並儲存至知識庫。

## 🎯 目的

- **自動抓取**：從指定帳號列表抓取最新推文
- **AI 摘要**：使用 Claude Haiku 提取重點
- **分類整理**：依主題自動分類（技術、產品、市場）
- **去重處理**：避免重複儲存相同內容

## ⚙️ 設定

```yaml
名稱: twitter-digest
排程: "0 0 * * *"  # 每天午夜 00:00
逾時: 300000       # 5 分鐘
記憶體限制: 100M
```

## 📊 抓取流程

```
資料來源：
  ├─ Twitter API v2（官方）
  ├─ 關注列表：config/twitter-follows.json
  └─ 時間範圍：過去 24 小時

處理步驟：
  1. 驗證 API 憑證
  2. 批次抓取推文（100 則/批次）
  3. 過濾轉推和廣告
  4. AI 摘要生成
  5. 儲存至 knowledge-digest 資料夾

輸出格式：
  - 每日一個 markdown 檔案
  - 按主題分組
  - 包含原文連結
```

## 🔧 依賴套件

| 套件 | 版本 | 用途 |
|------|------|------|
| @anthropic-ai/sdk | ^0.32.0 | AI 摘要 |
| twitter-api-v2 | ^1.15.0 | Twitter API |
| date-fns | ^4.1.0 | 日期處理 |

## 📝 範例輸出

```markdown
# Twitter Digest - 2026-02-14

## 技術趨勢
- **@sama**：OpenAI 發布新模型，推理能力提升 30%
- **@karpathy**：關於 Transformer 架構的深度解析

## 產品更新
- **@vercel**：Next.js 16 即將發布，支援 React Server Components

## 市場觀察
- **@benedictevans**：AI 投資趨勢分析
```

## 📈 效能指標

- **平均執行時間**：2-3 分鐘
- **抓取推文數**：每天約 200-300 則
- **記憶體使用**：尖峰 60-80 MB
- **Token 消耗**：每天約 30K tokens

## 🔍 監控

日誌儲存於：`~/.openclaw/logs/twitter-digest.log`

關鍵指標：
- API 配額使用量
- 摘要生成成功率
- 去重處理數量

## 🛠️ 故障排除

### 問題：API 認證失敗
**解決方案**：更新 `.env` 中的 `TWITTER_BEARER_TOKEN`

### 問題：抓取數量為 0
**解決方案**：檢查關注列表檔案是否存在

---

**最後更新**：2026-02-14
**維護者**：AI 系統
**版本**：1.0
