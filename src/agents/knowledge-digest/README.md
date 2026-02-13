# Knowledge Digest 知識摘要 Agent

## 📋 概述

Knowledge Digest agent 自動處理和摘要來自各種來源的知識條目，生成每日摘要並維護可搜尋的知識庫。

## 🎯 目的

- **每日審查**：處理過去 24 小時內新增的知識條目
- **AI 摘要**：使用 Claude API 生成簡潔摘要
- **語義搜尋**：透過向量嵌入實現快速檢索
- **關聯筆記**：自動連結相似的知識條目

## ⚙️ 設定

```yaml
名稱: knowledge-digest
排程: "30 3 * * *"  # 每天凌晨 03:30
逾時: 600000         # 10 分鐘
記憶體限制: 200M
```

## 📊 資料流程

```
輸入來源：
  ├─ knowledge-store.jsonl（主要）
  ├─ inbox/（未處理條目）
  └─ 外部 API（可選）

處理流程：
  1. 載入新條目（按時間戳篩選）
  2. 生成 AI 摘要（Claude Haiku）
  3. 提取嵌入向量（nomic-embed-text）
  4. 更新搜尋索引
  5. 生成關聯筆記連結

輸出：
  ├─ knowledge-store.jsonl（已更新）
  ├─ index.json（元資料）
  └─ markdown/（格式化筆記）
```

## 🔧 依賴套件

| 套件 | 版本 | 用途 |
|------|------|------|
| @anthropic-ai/sdk | ^0.32.0 | Claude API 整合 |
| ollama | ^0.5.0 | 本地嵌入向量 |
| date-fns | ^4.1.0 | 日期工具 |

## 📝 輸入格式

```json
{
  "id": "uuid-v4",
  "content": "原始知識文字...",
  "source": "manual|api|import",
  "tags": ["標籤1", "標籤2"],
  "createdAt": "2026-02-14T03:30:00Z"
}
```

## 📤 輸出格式

```json
{
  "id": "uuid-v4",
  "content": "原始文字...",
  "summary": "AI 生成的簡潔摘要...",
  "embedding": [0.123, -0.456, ...],
  "relatedNotes": ["note-id-1", "note-id-2"],
  "processedAt": "2026-02-14T03:35:00Z"
}
```

## 🚀 執行流程

1. **啟動**（03:30 AM）
   - 檢查自上次執行以來的新條目
   - 驗證資料完整性

2. **處理**（03:30-03:35 AM）
   - 批次處理條目（每次最多 100 個）
   - 並行生成摘要（5 個並發）
   - 增量更新嵌入向量

3. **收尾**（03:35-03:36 AM）
   - 寫入更新後的索引
   - 生成每日報告
   - 清理臨時檔案

4. **清理**（03:36 AM）
   - 歸檔已處理的收件匣項目
   - 記錄完成狀態

## 📈 效能指標

- **平均執行時間**：5-6 分鐘
- **處理條目數**：每天約 50-100 個
- **記憶體使用**：尖峰 150-180 MB
- **Token 消耗**：每天約 50K tokens（Claude Haiku）

## 🔍 監控

日誌儲存於：`~/.openclaw/logs/knowledge-digest.log`

關鍵監控指標：
- 每個條目的處理時間
- API 錯誤率（Claude/Ollama）
- 記憶體使用趨勢
- 索引大小增長

## 🛠️ 故障排除

### 問題：Agent 無法啟動
**原因**：Ollama 服務未運行
**解決方案**：`systemctl --user start ollama`

### 問題：記憶體使用過高
**原因**：一次處理太多條目
**解決方案**：在設定中減少批次大小（預設：100）

### 問題：嵌入向量生成緩慢
**原因**：Ollama 在單核心上受 CPU 限制
**解決方案**：VPS 預期行為，考慮升級或減少批次大小

## 🔗 整合點

- **OpenClaw Memory**：索引至 `~/.openclaw/memory/main.sqlite`
- **Kanban Dashboard**：在日曆視圖中可見（每天 03:30）
- **通知系統**：發布完成狀態至 dashboard

## 📚 參考資料

- [OpenClaw CLI 文件](https://openclaw.dev/docs)
- [Claude API 參考](https://docs.anthropic.com/claude/reference)
- [Ollama Embeddings](https://ollama.com/library/nomic-embed-text)

---

**最後更新**：2026-02-14
**維護者**：AI 系統
**版本**：2.0（已升級語義搜尋功能）
