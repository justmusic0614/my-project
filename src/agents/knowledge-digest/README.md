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
node digest.js weekly-report
```

## 整合

- 與 Market Digest 共用標籤系統
- 可選整合 Notion 做為外部儲存
- Telegram 週報推播
