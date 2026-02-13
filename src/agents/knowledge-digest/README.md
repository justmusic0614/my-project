# Knowledge Digest Agent

## 📋 Overview

The Knowledge Digest agent automatically processes and summarizes knowledge entries from various sources, generating daily digests and maintaining a searchable knowledge base.

## 🎯 Purpose

- **Daily Review**: Process knowledge entries added in the past 24 hours
- **AI Summary**: Generate concise summaries using Claude API
- **Semantic Search**: Enable fast retrieval via vector embeddings
- **Related Notes**: Link similar knowledge entries automatically

## ⚙️ Configuration

```yaml
name: knowledge-digest
schedule: "30 3 * * *"  # Daily at 03:30 AM
timeout: 600000         # 10 minutes
memory_limit: 200M
```

## 📊 Data Flow

```
Input Sources:
  ├─ knowledge-store.jsonl (primary)
  ├─ inbox/ (unprocessed entries)
  └─ external APIs (optional)

Processing Pipeline:
  1. Load new entries (filter by timestamp)
  2. Generate AI summaries (Claude Haiku)
  3. Extract embeddings (nomic-embed-text)
  4. Update search index
  5. Generate related notes links

Output:
  ├─ knowledge-store.jsonl (updated)
  ├─ index.json (metadata)
  └─ markdown/ (formatted notes)
```

## 🔧 Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @anthropic-ai/sdk | ^0.32.0 | Claude API integration |
| ollama | ^0.5.0 | Local embeddings |
| date-fns | ^4.1.0 | Date utilities |

## 📝 Input Format

```json
{
  "id": "uuid-v4",
  "content": "Raw knowledge text...",
  "source": "manual|api|import",
  "tags": ["tag1", "tag2"],
  "createdAt": "2026-02-14T03:30:00Z"
}
```

## 📤 Output Format

```json
{
  "id": "uuid-v4",
  "content": "Original text...",
  "summary": "AI-generated concise summary...",
  "embedding": [0.123, -0.456, ...],
  "relatedNotes": ["note-id-1", "note-id-2"],
  "processedAt": "2026-02-14T03:35:00Z"
}
```

## 🚀 Execution Flow

1. **Startup** (03:30 AM)
   - Check for new entries since last run
   - Validate data integrity

2. **Processing** (03:30-03:35 AM)
   - Batch process entries (max 100/run)
   - Generate summaries in parallel (5 concurrent)
   - Update embeddings incrementally

3. **Finalization** (03:35-03:36 AM)
   - Write updated index
   - Generate daily report
   - Clean up temporary files

4. **Cleanup** (03:36 AM)
   - Archive processed inbox items
   - Log completion status

## 📈 Performance Metrics

- **Average Runtime**: 5-6 minutes
- **Entries Processed**: ~50-100 per day
- **Memory Usage**: 150-180 MB peak
- **Token Consumption**: ~50K tokens/day (Claude Haiku)

## 🔍 Monitoring

Logs are stored at: `~/.openclaw/logs/knowledge-digest.log`

Key metrics to monitor:
- Processing time per entry
- API error rate (Claude/Ollama)
- Memory usage trends
- Index size growth

## 🛠️ Troubleshooting

### Issue: Agent fails to start
**Cause**: Ollama service not running
**Solution**: `systemctl --user start ollama`

### Issue: High memory usage
**Cause**: Too many entries processed at once
**Solution**: Reduce batch size in config (default: 100)

### Issue: Slow embedding generation
**Cause**: Ollama CPU-bound on single core
**Solution**: Expected on VPS, consider upgrading or reduce batch size

## 🔗 Integration Points

- **OpenClaw Memory**: Indexes into `~/.openclaw/memory/main.sqlite`
- **Kanban Dashboard**: Visible in Calendar view (03:30 daily)
- **Notification System**: Posts completion status to dashboard

## 📚 References

- [OpenClaw CLI Docs](https://openclaw.dev/docs)
- [Claude API Reference](https://docs.anthropic.com/claude/reference)
- [Ollama Embeddings](https://ollama.com/library/nomic-embed-text)

---

**Last Updated**: 2026-02-14
**Maintainer**: AI System
**Version**: 2.0 (upgraded with semantic search)
