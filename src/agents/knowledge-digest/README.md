# Knowledge Digest Agent

長期知識累積與檢索系統，專注財經領域知識管理。

## 核心功能

1. **知識擷取** (`digest`)
   - 網頁文章摘要（URL）
   - PDF/文件摘要（本地檔案）
   - 純文字筆記（手動輸入）

2. **知識儲存** (`store`)
   - 結構化 JSON 格式
   - Markdown 可讀格式
   - 可選：Notion 整合

3. **知識檢索** (`query`)
   - 關鍵字搜尋
   - 日期範圍過濾
   - 標籤分類查詢

4. **定期整理** (`report`)
   - 週報：本週新增知識摘要
   - 月報：主題彙整
   - 年度回顧

## 資料結構

```json
{
  "id": "uuid",
  "title": "標題",
  "source": "URL 或來源",
  "content": "摘要內容",
  "tags": ["財經", "投資", "台股"],
  "created_at": "2026-02-03T09:38:00Z",
  "type": "article|book|note",
  "metadata": {
    "author": "作者",
    "published_date": "發布日期"
  }
}
```

## 使用範例

```bash
# 摘要文章
node digest.js add-url "https://example.com/article" --tags "台股,法說會"

# 新增筆記
node digest.js add-note "今日觀察：台積電..." --tags "台股,筆記"

# 搜尋
node digest.js query --keyword "台積電" --days 30

# 週報
node digest.js weekly

# Brain Parser 匯入（端對端 pipeline）
./tools/brain-ingest.sh path/to/brain.md              # 互動確認
./tools/brain-ingest.sh path/to/brain.md --yes        # 自動寫入
./tools/brain-ingest.sh path/to/brain.md --dry-run    # 只預覽

# 或分步執行
python3 tools/brain-parser.py brain.md
node digest.js ingest data/chunks/brain.chunks.json --dry-run
node digest.js ingest data/chunks/brain.chunks.json
```

## Brain Ingest 資料流

```
brain markdown
    ↓  brain-parser.py
data/chunks/{name}.chunks.json
    ↓  digest.js ingest
data/knowledge-store.jsonl  +  data/index.json  +  data/markdown/
    ↓  openclaw memory index --force
OpenClaw RAG（可語意搜尋）
```

### chunks.json 最低必要欄位

```json
{
  "document_id": "唯一識別",
  "title": "文件標題",
  "metadata": { "source_url": "...", "source_basename": "..." },
  "parser_version": "1.0",
  "chunks": [
    { "section": "章節名稱", "text": "內容", "char_count": 820 }
  ]
}
```

### digest entry schema（brain-chunk 類型）

```json
{
  "id": "sha1(doc_id::chunk_order) 前 16 碼",
  "title": "{doc_title} — {section}",
  "source": "來源 URL 或 brain-parser",
  "content": "章節全文",
  "tags": ["user-tag", "brain-digest", "section:executive-insight"],
  "created_at": "ISO8601（僅新增時設定，更新時沿用舊值）",
  "updated_at": "ISO8601（新增與更新都更新；跳過時不改）",
  "type": "brain-chunk",
  "status": "processed",
  "metadata": {
    "doc_id": "文件 ID",
    "parser_version": "1.0",
    "section": "Executive Insight",
    "section_slug": "executive-insight",
    "chunk_order": 0,
    "char_count": 820,
    "word_count": 150,
    "source_file": "路徑/brain.chunks.json",
    "source_url": "https://...",
    "ingest_version": "1",
    "graph_triples_count": 12,
    "graph_file": "路徑/brain.graph.json 或 null",
    "ai_summarized": true
  }
}
```

### ingest 模式

| flags | 行為 |
|-------|------|
| 預設 | 預覽 → 詢問確認 → 寫入 → reindex |
| `--yes` | 預覽 → 不詢問 → 寫入 → reindex |
| `--dry-run` | 預覽 only，不詢問、不寫入、不 reindex |
| `--yes --dry-run` | dry-run 優先 |

### 失敗處理

| 情境 | 行為 |
|------|------|
| parser 失敗 | brain-ingest.sh 以非 0 exit code 中止 |
| ingest 用戶取消 | 不寫入，正常結束 |
| reindex 失敗 | digest 寫入保留，顯示手動重試指令 |
| rerun 同一檔 | upsert：id 相同且 content 相同 → skip |

### 已知限制

- 不同資料夾的同名 markdown 會產生相同 chunks 檔名互撞，後續可改成 doc_id-based output naming
- 手動使用可用預設互動模式；**自動化 / cron / pipeline 請搭配 `--yes`**（預設會詢問，不適合非互動環境）

## 整合

- 與 Market Digest 共用標籤系統
- 可選整合 Notion 做為外部儲存
- Telegram 週報推播
