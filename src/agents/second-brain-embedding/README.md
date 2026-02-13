# Second Brain Embedding 第二大腦嵌入 Agent

## 📋 概述

Second Brain Embedding agent 每天凌晨 3:30 為所有知識條目生成向量嵌入，並建立語義搜尋索引。

## 🎯 目的

- **向量生成**：使用 Ollama nomic-embed-text 模型
- **索引更新**：增量更新 SQLite 向量資料庫
- **語義連結**：自動發現相關筆記
- **搜尋優化**：支援自然語言查詢

## ⚙️ 設定

```yaml
名稱: second-brain-embedding
排程: "30 3 * * *"  # 每天凌晨 03:30
逾時: 600000        # 10 分鐘
記憶體限制: 200M
```

## 📊 處理流程

```
輸入：
  └─ 未索引的知識條目（新增或更新）

處理步驟：
  1. 批次載入條目（50 個/批次）
  2. 送至 Ollama 生成 768 維向量
  3. 計算與既有筆記的相似度
  4. 更新 SQLite 向量索引
  5. 建立雙向連結

輸出：
  ├─ ~/.openclaw/memory/main.sqlite（更新）
  ├─ 相關筆記連結
  └─ 索引統計報告
```

## 🔧 依賴套件

| 套件 | 版本 | 用途 |
|------|------|------|
| ollama | ^0.5.0 | 向量嵌入 |
| better-sqlite3 | ^9.0.0 | SQLite 操作 |
| vector-db | ^1.0.0 | 向量相似度計算 |

## 📝 向量資料庫結構

```sql
CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,
  content TEXT,
  embedding BLOB,  -- 768 float32
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX idx_embedding ON embeddings(embedding);
```

## 📈 效能指標

- **平均執行時間**：4-6 分鐘
- **處理條目數**：每天約 50-100 個
- **記憶體使用**：尖峰 150-180 MB
- **向量維度**：768（nomic-embed-text）

## 🔍 監控

日誌儲存於：`~/.openclaw/logs/second-brain-embedding.log`

關鍵指標：
- Ollama 回應時間（平均 ~200ms/條目）
- 索引大小增長
- 相似度計算耗時

## 🛠️ 故障排除

### 問題：Ollama 連線逾時
**解決方案**：檢查 Ollama 服務狀態 `systemctl --user status ollama`

### 問題：向量維度不符
**解決方案**：確認使用 nomic-embed-text 模型（768 維）

---

**最後更新**：2026-02-14
**維護者**：AI 系統
**版本**：1.0
