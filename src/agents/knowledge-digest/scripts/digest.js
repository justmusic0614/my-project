#!/usr/bin/env node
// digest.js - Knowledge Digest Agent v2
// P1: Daily Review  P2: AI URL Summary  P3: Related Notes
// P4: Inbox Status  P5: Semantic Search (TF-IDF + Claude ranking)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

let _emitAlert;
try {
  _emitAlert = require('../../../core/alert-system').emitAlert;
} catch (_) {
  _emitAlert = () => Promise.resolve(null); // VPS 獨立執行時 fallback
}

const DATA_DIR = path.join(__dirname, '../data');
const STORE_FILE = path.join(DATA_DIR, 'knowledge-store.jsonl');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ============================================================
// Utilities
// ============================================================

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

function timestamp() {
  return new Date().toISOString();
}

function readAllEntries() {
  if (!fs.existsSync(STORE_FILE)) return [];
  return fs.readFileSync(STORE_FILE, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(line => JSON.parse(line));
}

// 重寫整個 JSONL（用於 status 更新）
function writeAllEntries(entries) {
  fs.writeFileSync(STORE_FILE, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  rebuildIndex(entries);
}

// ============================================================
// P2 / P5 helper: 呼叫 Claude API
// ============================================================

const CONFIG_PATH = path.join(__dirname, '../../kanban-dashboard/data/llm-config.json');

function loadLLMConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return config.currentModel;
  } catch (e) {
    console.warn('⚠️ 無法讀取 LLM 配置，使用預設模型');
    return 'claude-haiku-4-5-20251001';  // fallback
  }
}

async function callLLM(prompt, maxTokens = 800) {
  const llmClient = require('../../kanban-dashboard/server/services/llm-client');

  try {
    const result = await llmClient.callLLM(prompt, {
      agentId: 'knowledge-digest',  // 新增 agentId，自動查詢 Agent 專用模型
      maxTokens,
      source: 'knowledge-digest'
    });
    return result.text;
  } catch (e) {
    console.error('⚠️  LLM call failed:', e.message);
    return null;
  }
}

// ============================================================
// Storage & Index
// ============================================================

function storeEntry(entry, existingEntries = null) {
  fs.appendFileSync(STORE_FILE, JSON.stringify(entry) + '\n');
  appendToIndex(entry);
  // 若呼叫端已有 entries 列表就直接用，避免重讀整個 JSONL
  const allEntries = existingEntries
    ? [...existingEntries, entry]
    : readAllEntries();
  createMarkdown(entry, allEntries);
  console.log(`✅ 已儲存：${entry.title} (ID: ${entry.id})`);
}

function appendToIndex(entry) {
  let index = { entries: [], tags: {}, total: 0, updated_at: '' };
  if (fs.existsSync(INDEX_FILE)) {
    index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  }
  index.entries.push({
    id: entry.id,
    title: entry.title,
    tags: entry.tags,
    created_at: entry.created_at,
    type: entry.type,
    status: entry.status || 'inbox'
  });
  entry.tags.forEach(tag => {
    index.tags[tag] = (index.tags[tag] || 0) + 1;
  });
  index.total = index.entries.length;
  index.updated_at = timestamp();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

function rebuildIndex(entries) {
  const index = { entries: [], tags: {}, total: 0, updated_at: timestamp() };
  entries.forEach(e => {
    index.entries.push({
      id: e.id,
      title: e.title,
      tags: e.tags,
      created_at: e.created_at,
      type: e.type,
      status: e.status || 'processed'
    });
    e.tags.forEach(tag => {
      index.tags[tag] = (index.tags[tag] || 0) + 1;
    });
  });
  index.total = entries.length;
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

// ============================================================
// P3: 相關筆記 (Jaccard similarity on tags + title overlap)
// ============================================================

function findRelated(entry, allEntries, topN = 3) {
  const targetTags = new Set(entry.tags);
  if (targetTags.size === 0 && allEntries.length < 2) return [];

  return allEntries
    .filter(e => e.id !== entry.id)
    .map(e => {
      const otherTags = new Set(e.tags);
      const intersection = [...targetTags].filter(t => otherTags.has(t)).length;
      const union = new Set([...targetTags, ...otherTags]).size;
      const jaccard = union > 0 ? intersection / union : 0;

      const titleWords = entry.title.split(/\s+|\b/).filter(w => w.length >= 2);
      const titleOverlap = titleWords.length > 0
        ? titleWords.filter(w => e.title.includes(w)).length / titleWords.length
        : 0;

      return { entry: e, score: jaccard * 0.7 + titleOverlap * 0.3 };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(r => r.entry);
}

// ============================================================
// Markdown 產生（含相關筆記）
// ============================================================

function createMarkdown(entry, allEntries = null) {
  const date = entry.created_at.split('T')[0];
  const mdDir = path.join(DATA_DIR, 'markdown', date);
  if (!fs.existsSync(mdDir)) {
    fs.mkdirSync(mdDir, { recursive: true });
  }

  let relatedSection = '';
  if (allEntries && allEntries.length > 1) {
    const related = findRelated(entry, allEntries);
    if (related.length > 0) {
      relatedSection = `\n## 相關筆記\n\n${related.map(r =>
        `- [[${r.id}]] ${r.title} (${r.created_at.split('T')[0]})`
      ).join('\n')}\n`;
    }
  }

  const metaSection = entry.metadata && Object.keys(entry.metadata).length > 0
    ? `\n## Metadata\n\n${Object.entries(entry.metadata).map(([k, v]) => `- **${k}**: ${v}`).join('\n')}\n`
    : '';

  const statusIcon = { inbox: '📥', processed: '✅', archived: '📦' }[entry.status || 'inbox'] || '📄';

  const mdContent = `# ${entry.title}

**ID**: ${entry.id}
**來源**: ${entry.source || 'N/A'}
**類型**: ${entry.type}
**標籤**: ${entry.tags.join(', ')}
**狀態**: ${statusIcon} ${entry.status || 'inbox'}
**建立時間**: ${entry.created_at}

## 內容

${entry.content}
${metaSection}${relatedSection}`;

  fs.writeFileSync(path.join(mdDir, `${entry.id}.md`), mdContent);
}

// ============================================================
// 從 URL 擷取內容（Clawdbot gateway）
// ============================================================

function fetchFromUrl(url) {
  console.log(`📥 擷取中：${url}`);
  try {
    const payload = JSON.stringify({ url, extractMode: 'markdown' });
    const escaped = payload.replace(/'/g, "'\\''");
    const cmd = `curl -s http://localhost:18788/tools/web_fetch -H "Content-Type: application/json" -d '${escaped}' | jq -r '.content'`;
    const content = execSync(cmd, { encoding: 'utf8', timeout: 30000 }).trim();
    if (content && content !== 'null') return content;
    throw new Error('無法擷取內容');
  } catch (e) {
    console.error(`❌ 擷取失敗：${e.message}`);
    return null;
  }
}

// ============================================================
// P1: 每日複習推送
// ============================================================

function dailyReview() {
  const entries = readAllEntries();
  if (entries.length === 0) {
    console.log('📭 知識庫為空，尚無筆記可複習');
    return;
  }

  // 加權隨機選取：越舊的筆記權重越高
  const now = Date.now();
  const pool = entries.map(e => {
    const ageDays = (now - new Date(e.created_at).getTime()) / (1000 * 60 * 60 * 24);
    const weight = Math.min(Math.max(Math.sqrt(ageDays + 1), 1), 10);
    return { entry: e, weight };
  });

  const selected = [];
  const available = [...pool];
  const count = Math.min(3, available.length);

  for (let i = 0; i < count; i++) {
    const totalWeight = available.reduce((s, w) => s + w.weight, 0);
    let rand = Math.random() * totalWeight;
    for (let j = 0; j < available.length; j++) {
      rand -= available[j].weight;
      if (rand <= 0) {
        selected.push(available[j].entry);
        available.splice(j, 1);
        break;
      }
    }
  }

  const dateStr = new Date().toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' });
  console.log(`📚 ${dateStr} 每日複習（共 ${entries.length} 則筆記）\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  selected.forEach((e, i) => {
    const preview = e.content.replace(/#+\s*/g, '').replace(/\n+/g, ' ').trim().substring(0, 200);
    const dateAdded = e.created_at.split('T')[0];
    console.log(`${i + 1}. 📄 ${e.title}`);
    console.log(`   🏷️  ${e.tags.join(' · ')}  |  📅 存入 ${dateAdded}`);
    console.log(`   ${preview}${preview.length >= 200 ? '...' : ''}`);
    console.log('');
  });
}

// ============================================================
// P2: 新增 URL（含 AI 摘要）
// ============================================================

async function addUrl(url, tags = [], title = null) {
  const rawContent = fetchFromUrl(url);
  if (!rawContent) process.exit(1);

  let content = rawContent.substring(0, 5000);
  let autoTitle = title;
  let autoTags = [...tags];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    console.log('🤖 AI 摘要生成中...');

    const existingTags = fs.existsSync(INDEX_FILE)
      ? Object.keys(JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')).tags || {})
      : [];

    const prompt = `以繁體中文摘要此文，回傳 JSON（無其他文字）：
{"title":"20字標題","summary":"## 核心觀點\\n- ...\\n## 關鍵數據\\n- ...\\n## 結論\\n- ...","tags":["標籤"]}
已有標籤：${existingTags.slice(0, 20).join(',') || '無'}
內容：
${rawContent.substring(0, 2000)}`;

    const llmResult = await callLLM(prompt, 1000);
    if (llmResult) {
      try {
        const jsonMatch = llmResult.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (!autoTitle && parsed.title) autoTitle = parsed.title;
          if (parsed.summary) content = parsed.summary;
          if (parsed.tags?.length > 0 && tags.length === 0) autoTags = parsed.tags;
          console.log('✨ AI 摘要完成');
        }
      } catch (e) {
        console.log('⚠️ AI 摘要解析失敗，使用原始內容');
        content = rawContent.substring(0, 5000);
      }
    }
  }

  if (!autoTitle) {
    autoTitle = rawContent.split('\n').find(l => l.trim().length > 0)?.substring(0, 50) || 'Untitled';
  }

  const entry = {
    id: generateId(),
    title: autoTitle,
    source: url,
    content,
    tags: autoTags,
    created_at: timestamp(),
    type: 'article',
    status: 'inbox',
    metadata: { url, fetch_date: timestamp(), ai_summarized: !!apiKey }
  };

  storeEntry(entry);
}

// ============================================================
// 新增筆記
// ============================================================

function addNote(content, tags = [], title = 'Untitled Note') {
  const entry = {
    id: generateId(),
    title,
    source: 'manual',
    content,
    tags,
    created_at: timestamp(),
    type: 'note',
    status: 'inbox',
    metadata: {}
  };
  storeEntry(entry);
}

// ============================================================
// 查詢（P3: 附相關筆記）
// ============================================================

function query(keyword = null, tags = null, days = null) {
  const allEntries = readAllEntries();
  if (allEntries.length === 0) {
    console.log('📭 知識庫為空');
    return;
  }

  let results = [...allEntries];

  if (keyword) {
    results = results.filter(e =>
      e.title.includes(keyword) ||
      e.content.includes(keyword) ||
      e.tags.some(t => t.includes(keyword))
    );
  }
  if (tags) {
    const tagList = tags.split(',');
    results = results.filter(e => tagList.some(t => e.tags.includes(t)));
  }
  if (days) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    results = results.filter(e => e.created_at >= cutoff);
  }

  console.log(`\n🔍 找到 ${results.length} 筆結果\n`);

  results.forEach(e => {
    const statusIcon = { inbox: '📥', processed: '✅', archived: '📦' }[e.status || 'inbox'];
    console.log(`${statusIcon} ${e.title}`);
    console.log(`   ID: ${e.id}  |  🏷️ ${e.tags.join(', ')}  |  📅 ${e.created_at.split('T')[0]}`);
    console.log(`   ${e.content.replace(/#+\s*/g, '').replace(/\n+/g, ' ').trim().substring(0, 120)}...`);

    // P3: 相關筆記
    const related = findRelated(e, allEntries);
    if (related.length > 0) {
      console.log(`   🔗 相關：${related.map(r => r.title).join('  ·  ')}`);
    }
    console.log('');
  });
}

// ============================================================
// P4: Inbox 狀態管理
// ============================================================

function inbox() {
  const entries = readAllEntries();
  // 只顯示明確標記為 inbox 的條目；舊條目（無 status）視為已處理
  const items = entries.filter(e => e.status === 'inbox');

  if (items.length === 0) {
    console.log('✅ 收件匣為空，所有筆記已處理');
    return;
  }

  console.log(`\n📥 收件匣（${items.length} 則待處理）\n`);
  items.forEach(e => {
    const preview = e.content.replace(/\n+/g, ' ').trim().substring(0, 80);
    console.log(`📄 ${e.title}`);
    console.log(`   ID: ${e.id}  |  🏷️ ${e.tags.join(', ')}  |  📅 ${e.created_at.split('T')[0]}`);
    console.log(`   ${preview}...`);
    console.log('');
  });
}

function markRead(id) {
  updateEntryStatus(id, 'processed');
}

function archiveEntry(id) {
  updateEntryStatus(id, 'archived');
}

function updateEntryStatus(id, newStatus) {
  const entries = readAllEntries();
  const entry = entries.find(e => e.id === id);
  if (!entry) {
    console.log(`❌ 找不到 ID：${id}`);
    process.exit(1);
  }
  entry.status = newStatus;
  writeAllEntries(entries);
  const label = { processed: '✅ 已讀', archived: '📦 已封存', inbox: '📥 收件匣' }[newStatus] || newStatus;
  console.log(`${label}：${entry.title}`);
}

// ============================================================
// P5: 語意搜尋（TF-IDF + Claude ranking fallback）
// ============================================================

function buildTFIDF(entries) {
  const tokenize = (text) => {
    const cleaned = (text || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ');
    const tokens = new Set();
    // ASCII words (≥2 chars)
    cleaned.split(/\s+/).filter(w => w.length >= 2).forEach(w => tokens.add(w.toLowerCase()));
    // CJK bigrams and trigrams
    const cjk = (text || '').replace(/[^\u4e00-\u9fa5]/g, '');
    for (let i = 0; i < cjk.length - 1; i++) {
      tokens.add(cjk.slice(i, i + 2));
      if (i < cjk.length - 2) tokens.add(cjk.slice(i, i + 3));
    }
    return [...tokens];
  };

  const dfMap = new Map();
  const docTokenSets = entries.map(e => {
    const text = `${e.title} ${e.tags.join(' ')} ${e.content.substring(0, 500)}`;
    const tokens = new Set(tokenize(text));
    tokens.forEach(t => dfMap.set(t, (dfMap.get(t) || 0) + 1));
    return tokens;
  });

  const N = entries.length;
  const vectors = docTokenSets.map(tokenSet => {
    const vec = {};
    tokenSet.forEach(t => {
      const df = dfMap.get(t) || 1;
      vec[t] = Math.log(N / df + 1);
    });
    return vec;
  });

  return { vectors, tokenize };
}

function cosineSimilarity(vecA, vecB) {
  const dot = Object.keys(vecA).reduce((s, k) => s + (vecA[k] || 0) * (vecB[k] || 0), 0);
  const magA = Math.sqrt(Object.values(vecA).reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt(Object.values(vecB).reduce((s, v) => s + v * v, 0));
  return (magA > 0 && magB > 0) ? dot / (magA * magB) : 0;
}

async function semanticSearch(question) {
  const entries = readAllEntries();
  if (entries.length === 0) {
    console.log('📭 知識庫為空');
    return;
  }

  // 優先使用 OpenClaw memory search（向量 + BM25，0 Claude API token）
  try {
    const { execSync } = require('child_process');
    const escaped = question.replace(/"/g, '\\"').replace(/\$/g, '\\$');
    const cmd = `export NVM_DIR=$HOME/.nvm && source $NVM_DIR/nvm.sh && openclaw memory search --json --max-results 3 "${escaped}"`;
    const raw = execSync(cmd, { shell: '/bin/bash', timeout: 15000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    // openclaw 可能在 JSON 前輸出 config warning，取第一個 '{' 之後的內容
    const jsonStart = raw.indexOf('{');
    if (jsonStart < 0) throw new Error('No JSON in openclaw output');
    const parsed = JSON.parse(raw.substring(jsonStart));
    const results = parsed.results || parsed;
    if (Array.isArray(results) && results.length > 0) {
      console.log(`\n🔍 語意搜尋：「${question}」（向量搜尋）\n`);
      results.forEach((r, i) => {
        const title = r.path ? r.path.replace(/^.*\//, '').replace(/\.md$/, '') : 'Untitled';
        const snippet = (r.snippet || '').replace(/\n+/g, ' ').trim().substring(0, 150);
        console.log(`${i + 1}. 📄 ${title}  (score: ${(r.score || 0).toFixed(3)})`);
        console.log(`   ${snippet}${snippet.length >= 150 ? '...' : ''}`);
        console.log('');
      });
      return;
    }
  } catch (e) {
    // OpenClaw memory search 不可用，fallback 到 TF-IDF
    if (process.env.DEBUG) console.error('⚠️ openclaw search fallback:', e.message);
  }

  // Fallback: TF-IDF（0 Claude API token）
  console.log('🔍 TF-IDF 相似度搜尋中...');
  const { vectors, tokenize } = buildTFIDF(entries);
  const queryTokens = tokenize(question);
  const queryVec = {};
  queryTokens.forEach(t => { queryVec[t] = 1; });

  const topResults = vectors
    .map((vec, i) => ({ entry: entries[i], score: cosineSimilarity(queryVec, vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .filter(r => r.score > 0);

  console.log(`\n🔍 語意搜尋：「${question}」（TF-IDF）\n`);
  if (topResults.length === 0) {
    console.log('（無相關結果）');
    return;
  }
  topResults.forEach((r, i) => {
    console.log(`${i + 1}. 📄 ${r.entry.title}  (相似度: ${r.score.toFixed(3)})`);
    console.log(`   🏷️ ${r.entry.tags.join(', ')}`);
    console.log(`   ${r.entry.content.replace(/\n+/g, ' ').trim().substring(0, 150)}...`);
    console.log('');
  });
}

// ============================================================
// 週報
// ============================================================

function weeklyReport() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const entries = readAllEntries();
  const recent = entries.filter(e => e.created_at >= weekAgo);

  console.log(`📚 本週知識摘要（${recent.length} 筆）\n`);

  const byTag = {};
  recent.forEach(e => {
    e.tags.forEach(tag => {
      if (!byTag[tag]) byTag[tag] = [];
      byTag[tag].push(e);
    });
  });

  if (Object.keys(byTag).length === 0) {
    console.log('（本週尚無新增筆記）');
    return;
  }

  Object.entries(byTag).forEach(([tag, items]) => {
    console.log(`🏷️ ${tag}（${items.length}）`);
    items.forEach(e => {
      const statusIcon = { inbox: '📥', processed: '✅', archived: '📦' }[e.status || 'inbox'];
      console.log(`  ${statusIcon} ${e.title}  (${e.created_at.split('T')[0]})`);
    });
    console.log('');
  });
}

// ============================================================
// 統計
// ============================================================

function stats() {
  if (!fs.existsSync(INDEX_FILE)) {
    console.log('📭 知識庫為空');
    return;
  }

  const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  const entries = readAllEntries();
  const statusCount = { inbox: 0, processed: 0, archived: 0 };
  entries.forEach(e => {
    const s = e.status || 'processed';
    statusCount[s] = (statusCount[s] || 0) + 1;
  });

  console.log('📊 知識庫統計\n');
  console.log(`總條目：${index.total}`);
  console.log(`最後更新：${index.updated_at}`);
  console.log(`\n狀態分布：`);
  console.log(`  📥 收件匣 (inbox)：${statusCount.inbox}`);
  console.log(`  ✅ 已處理 (processed)：${statusCount.processed}`);
  console.log(`  📦 已封存 (archived)：${statusCount.archived}`);

  const topTags = Object.entries(index.tags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (topTags.length > 0) {
    console.log('\n🏷️ 標籤分布（前 10）：');
    topTags.forEach(([tag, count]) => {
      console.log(`  ${tag}：${count}`);
    });
  }
}

// ============================================================
// Brain Ingest
// ============================================================

function slugifyTag(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function brainEntryId(docId, chunkOrder) {
  return crypto.createHash('sha1').update(`${docId}::${chunkOrder}`).digest('hex').slice(0, 16);
}

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str.padEnd(maxLen);
  return str.slice(0, maxLen - 1) + '…';
}

async function ingestBrain(chunksFile, opts = {}) {
  const { yes = false, dryRun = false, rawTags = '' } = opts;

  // dry-run 優先
  const effectiveDryRun = dryRun;

  // 讀取 chunks.json
  let chunksData;
  try {
    chunksData = JSON.parse(fs.readFileSync(chunksFile, 'utf8'));
  } catch (e) {
    console.error(`❌ 無法讀取 ${chunksFile}：${e.message}`);
    _emitAlert({
      key: 'ingest-fail:knowledge-digest:brain-ingest',
      type: 'ingest-fail',
      source: 'knowledge-digest',
      component: 'brain-ingest',
      title: 'brain-ingest 讀取失敗',
      data: { error: e.message, file: chunksFile }
    }).catch(() => {});
    process.exit(1);
  }

  const docId = chunksData.document_id || '';
  const docTitle = chunksData.title || docId;
  const docMeta = chunksData.metadata || {};
  const sourceUrl = docMeta.source_url || docMeta.url || '';
  const sourceFile = chunksFile;
  const parserVersion = chunksData.parser_version || '';
  const chunks = chunksData.chunks || [];

  if (chunks.length === 0) {
    console.log('⚠️  chunks.json 無章節資料');
    process.exit(0);
  }

  // 嘗試讀取 graph.json（取三元組數量）
  const chunksPath = require('path').resolve(chunksFile);
  const graphFile = chunksPath
    .replace(/[/\\]chunks[/\\]/, '/graph/')
    .replace(/\.chunks\.json$/, '.graph.json');
  let graphTriplesCount = 0;
  let graphFilePath = null;
  if (fs.existsSync(graphFile)) {
    try {
      const g = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
      graphTriplesCount = g.edge_count || (g.triples || []).length;
      graphFilePath = graphFile;
    } catch (_) {}
  }

  // 正規化 user tags
  const normalizedUserTags = [...new Set(
    rawTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
  )];

  // 讀取現有 store（建立 id → entry map）
  const existingEntries = readAllEntries();
  const existingMap = new Map(existingEntries.map(e => [e.id, e]));

  // 計算每個 chunk 的動作
  const plan = chunks.map((chunk, i) => {
    const chunkOrder = i;
    const id = brainEntryId(docId, chunkOrder);
    const sectionSlug = slugifyTag(chunk.section) || `section-${chunkOrder}`;
    const wordCount = (chunk.text || '').split(/\s+/).filter(Boolean).length;

    const tags = [...normalizedUserTags, 'brain-digest', `section:${sectionSlug}`];

    const entry = {
      id,
      title: `${docTitle || docId} — ${chunk.section}`,
      source: sourceUrl || 'brain-parser',
      content: chunk.text || '',
      tags,
      type: 'brain-chunk',
      status: 'processed',
      metadata: {
        doc_id: docId,
        parser_version: parserVersion,
        section: chunk.section,
        section_slug: sectionSlug,
        chunk_order: chunkOrder,
        char_count: chunk.char_count || (chunk.text || '').length,
        word_count: wordCount,
        source_file: sourceFile,
        source_url: sourceUrl || null,
        ingest_version: '1',
        graph_triples_count: graphTriplesCount,
        graph_file: graphFilePath,
        ai_summarized: true
      }
    };

    const existing = existingMap.get(id);
    let action;
    if (!existing) {
      action = 'add';
      entry.created_at = timestamp();
      entry.updated_at = timestamp();
    } else if (existing.content === entry.content) {
      action = 'skip';
      entry.created_at = existing.created_at;
      entry.updated_at = existing.updated_at;
    } else {
      action = 'update';
      entry.created_at = existing.created_at;  // 保留原 created_at
      entry.updated_at = timestamp();
    }

    return { entry, action, section: chunk.section, charCount: chunk.char_count || 0 };
  });

  const counts = { add: 0, update: 0, skip: 0 };
  plan.forEach(p => counts[p.action]++);
  const totalChars = plan.reduce((s, p) => s + p.charCount, 0);

  // 印預覽表格
  console.log('\n📥 Brain Ingest 預覽');
  console.log('━'.repeat(54));
  console.log(`來源: ${docTitle || docId}`);
  console.log(`章節: ${chunks.length} 個 | 總字數: ${totalChars.toLocaleString()} 字`);
  console.log('');
  console.log(`  # │ ${'章節'.padEnd(24)} │ ${'字數'.padStart(5)} │ 動作`);
  console.log(` ───┼─${'─'.repeat(24)}─┼──────┼──────`);
  plan.forEach((p, i) => {
    const secLabel = truncate(p.section, 24);
    const charStr = String(p.charCount).padStart(5);
    const actionLabel = { add: '新增', update: '更新', skip: '跳過' }[p.action];
    console.log(`  ${String(i + 1).padStart(1)} │ ${secLabel} │ ${charStr} │ ${actionLabel}`);
  });
  console.log('━'.repeat(54));
  console.log(`新增: ${counts.add} | 更新: ${counts.update} | 跳過: ${counts.skip}`);
  console.log('');

  // dry-run：只預覽，不詢問，不寫入
  if (effectiveDryRun) {
    console.log('（dry-run 模式，不寫入）');
    return;
  }

  // 詢問確認（除非 --yes）
  if (!yes) {
    const confirmed = await new Promise(resolve => {
      const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
      rl.question('確認存入知識庫？(y/N): ', answer => {
        rl.close();
        resolve(answer.trim() === 'y' || answer.trim() === 'Y');
      });
    });
    if (!confirmed) {
      console.log('已取消。');
      return;
    }
  }

  // 無需寫入的情況
  if (counts.add === 0 && counts.update === 0) {
    console.log('（全部跳過，無需寫入）');
    return;
  }

  // 執行 upsert
  const toWrite = plan.filter(p => p.action !== 'skip');
  let updatedEntries = [...existingEntries];

  toWrite.forEach(p => {
    if (p.action === 'add') {
      updatedEntries.push(p.entry);
    } else {
      // update：替換
      const idx = updatedEntries.findIndex(e => e.id === p.entry.id);
      if (idx >= 0) updatedEntries[idx] = p.entry;
    }
  });

  writeAllEntries(updatedEntries);
  console.log(`\nIngest complete:`);
  console.log(`  added:   ${counts.add}`);
  console.log(`  updated: ${counts.update}`);
  console.log(`  skipped: ${counts.skip}`);

  // 條件式 reindex
  console.log('\nTriggering memory reindex...');
  try {
    execSync('openclaw memory index --force', { stdio: 'inherit' });
    console.log('✔ memory index updated');
  } catch (e) {
    console.error('✖ memory index failed (exit code ' + (e.status || '?') + ')');
    console.error('Digest entries were saved successfully.');
    console.error('Manual retry: openclaw memory index --force');
    _emitAlert({
      key: 'memory-index-fail:knowledge-digest:openclaw-memory',
      type: 'memory-index-fail',
      source: 'knowledge-digest',
      component: 'openclaw-memory',
      title: 'OpenClaw memory index 失敗',
      data: { error: `exit code ${e.status || '?'}` }
    }).catch(() => {});
  }
}

// ============================================================
// CLI 入口
// ============================================================

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const command = args[0];

    const getFlag = (flag) => args.find(a => a.startsWith(`--${flag}=`))?.split('=').slice(1).join('=');
    const getTags = (flag = 'tags') => (getFlag(flag) || '').split(',').filter(Boolean);

    switch (command) {
      case 'add-url':
        if (!args[1]) { console.log('❌ 請提供 URL：node digest.js add-url <URL>'); process.exit(1); }
        await addUrl(args[1], getTags(), getFlag('title'));
        break;

      case 'add-note':
        if (!args[1]) { console.log('❌ 請提供內容：node digest.js add-note "<內容>"'); process.exit(1); }
        addNote(args[1], getTags(), getFlag('title') || 'Untitled Note');
        break;

      case 'query':
        query(getFlag('keyword'), getFlag('tags'), getFlag('days') ? Number(getFlag('days')) : null);
        break;

      case 'daily-review':
        dailyReview();
        break;

      case 'inbox':
        inbox();
        break;

      case 'mark-read':
        if (!args[1]) { console.log('❌ 請提供筆記 ID：node digest.js mark-read <id>'); process.exit(1); }
        markRead(args[1]);
        break;

      case 'archive':
        if (!args[1]) { console.log('❌ 請提供筆記 ID：node digest.js archive <id>'); process.exit(1); }
        archiveEntry(args[1]);
        break;

      case 'semantic-search':
        if (!args[1]) { console.log('❌ 請提供問題：node digest.js semantic-search "<問題>"'); process.exit(1); }
        await semanticSearch(args[1]);
        break;

      case 'weekly':
        weeklyReport();
        break;

      case 'stats':
        stats();
        break;

      case 'ingest': {
        if (!args[1]) { console.log('❌ 請提供 brain-chunks.json 路徑：node digest.js ingest <chunks.json>'); process.exit(1); }
        const hasYes = args.includes('--yes');
        const hasDryRun = args.includes('--dry-run');
        await ingestBrain(args[1], {
          yes: hasYes,
          dryRun: hasDryRun,
          rawTags: getFlag('tags') || ''
        });
        break;
      }

      default:
        console.log(`
Knowledge Digest Agent v2

指令：
  add-url  <URL>        [--tags=t1,t2] [--title="標題"]   新增 URL（AI 摘要）
  add-note "<內容>"     [--tags=t1,t2] [--title="標題"]   新增筆記
  ingest   <chunks.json> [--yes] [--dry-run] [--tags=t1,t2]  從 brain-parser 輸出匯入
  query                 [--keyword=詞] [--tags=t] [--days=N] 查詢（含相關筆記）
  daily-review                                              每日複習（3 則加權隨機）
  inbox                                                     收件匣（待處理筆記）
  mark-read <id>                                            標記為已讀
  archive   <id>                                            封存筆記
  semantic-search "<問題>"                                  語意搜尋
  weekly                                                    週報
  stats                                                     統計

ingest 模式：
  （預設）  預覽 → 詢問確認 → 寫入 → reindex
  --yes     預覽 → 不詢問 → 寫入 → reindex
  --dry-run 預覽 only，不詢問、不寫入、不 reindex
        `);
    }
  })().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

module.exports = { addUrl, addNote, query, dailyReview, inbox, markRead, archiveEntry, semanticSearch, weeklyReport, stats };
