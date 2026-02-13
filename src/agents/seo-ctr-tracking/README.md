# SEO CTR Tracking SEO 點擊率追蹤 Agent

## 📋 概述

SEO CTR Tracking agent 每天凌晨 6 點追蹤部落格和文件頁面的 SEO 表現，分析點擊率、排名變化，並提供優化建議。

## 🎯 目的

- **排名監控**：追蹤 Google 搜尋排名變化
- **CTR 分析**：計算點擊率（CTR）和曝光數
- **關鍵字研究**：發現新的搜尋機會
- **標題優化**：建議更具吸引力的標題

## ⚙️ 設定

```yaml
名稱: seo-ctr-tracking
排程: "0 6 * * *"  # 每天早上 06:00
逾時: 180000       # 3 分鐘
記憶體限制: 100M
```

## 📊 追蹤指標

```
Google Search Console 資料：
  ├─ 曝光數（Impressions）
  ├─ 點擊數（Clicks）
  ├─ 點擊率（CTR）
  ├─ 平均排名（Average Position）
  └─ 查詢關鍵字（Queries）

分析維度：
  • 依頁面分組
  • 依關鍵字分組
  • 時間趨勢（7 天、30 天）
  • 裝置類型（桌面、行動）
```

## 🔧 依賴套件

| 套件 | 版本 | 用途 |
|------|------|------|
| googleapis | ^120.0.0 | Search Console API |
| @anthropic-ai/sdk | ^0.32.0 | 標題優化建議 |
| chart.js | ^4.0.0 | 趨勢圖表 |

## 📝 範例輸出

```markdown
# SEO CTR 報告 - 2026-02-14

## 📈 總體表現
- 總曝光數：1,234 次（↑ 15% vs 上週）
- 總點擊數：87 次（↑ 8% vs 上週）
- 平均 CTR：7.05%（↓ 0.5%）
- 平均排名：12.3（↑ 1.2）

## 🎯 Top 5 頁面
1. React 效能優化指南（CTR 12.3%, 排名 8）
2. AI Agent 設計模式（CTR 9.8%, 排名 11）
3. VPS 部署教學（CTR 8.5%, 排名 15）

## 🔍 關鍵字機會
- "react useMemo 優化"（排名 12 → 建議提升至 Top 10）
- "ai agent 架構"（排名 18 → 建議加強內容）

## 💡 優化建議
1. 「修復 Dashboard Bug」→「如何修復 React Dashboard 記憶體洩漏」
2. 「Agent 設計」→「5 種 AI Agent 設計模式完整指南」
```

## 📈 效能指標

- **平均執行時間**：1-2 分鐘
- **API 呼叫數**：約 5-10 次
- **記憶體使用**：尖峰 60-80 MB

## 🔍 監控

日誌儲存於：`~/.openclaw/logs/seo-ctr-tracking.log`

## 🛠️ 故障排除

### 問題：Search Console API 認證失敗
**解決方案**：更新 OAuth2 憑證或 Service Account 金鑰

### 問題：無資料回傳
**解決方案**：確認網站已驗證並連結至 Search Console

---

**最後更新**：2026-02-14
**維護者**：AI 系統
**版本**：1.0
