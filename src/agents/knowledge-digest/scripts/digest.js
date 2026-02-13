#!/usr/bin/env node
// digest.js - Knowledge Digest Agent v2
// P1: Daily Review  P2: AI URL Summary  P3: Related Notes
// P4: Inbox Status  P5: Semantic Search (TF-IDF + Claude ranking)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

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

async function callLLM(prompt, maxTokens = 800) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      console.error(`⚠️ Claude API 回傳 ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.content?.[0]?.text || null;
  } catch (e) {
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

    const prompt = `你是知識萃取助手。分析以下網頁內容，以繁體中文產出結構化摘要。

現有標籤庫：${existingTags.join(', ') || '（無）'}

請嚴格回傳以下 JSON，不要任何其他文字：
{
  "title": "20字內的精準標題",
  "summary": "## 核心觀點\\n- 觀點1\\n- 觀點2\\n\\n## 關鍵數據\\n- 數據（若無則省略此節）\\n\\n## 重要結論\\n- 結論1\\n- 結論2",
  "tags": ["標籤1", "標籤2"]
}

網頁內容（前 3000 字）：
${rawContent.substring(0, 3000)}`;

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

  // Claude ranking（知識庫 ≤ 80 則時使用，避免 context 過長）
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && entries.length <= 80) {
    console.log('🤖 AI 語意分析中...');
    const entriesList = entries.map(e =>
      `[${e.id}] ${e.title} | 標籤:${e.tags.join(',')} | ${e.content.replace(/\n/g, ' ').substring(0, 100)}`
    ).join('\n');

    const prompt = `知識庫條目：\n${entriesList}\n\n用戶問題：${question}\n\n請返回最相關的 3 個條目 ID（只回傳 ID 以逗號分隔，例：abc123,def456,ghi789）：`;

    const result = await callLLM(prompt, 100);
    if (result) {
      const ids = result.trim().split(/[,\s]+/).filter(id => /^[0-9a-f]{16}$/.test(id));
      const found = ids.map(id => entries.find(e => e.id === id)).filter(Boolean);
      if (found.length > 0) {
        console.log(`\n🔍 語意搜尋：「${question}」\n`);
        found.forEach((e, i) => {
          console.log(`${i + 1}. 📄 ${e.title}`);
          console.log(`   🏷️ ${e.tags.join(', ')}`);
          console.log(`   ${e.content.replace(/\n+/g, ' ').trim().substring(0, 150)}...`);
          console.log('');
        });
        return;
      }
    }
  }

  // Fallback: TF-IDF
  console.log('🔍 TF-IDF 相似度搜尋中...');
  const { vectors, tokenize } = buildTFIDF(entries);
  const queryTokens = tokenize(question);
  const queryVec = {};
  queryTokens.forEach(t => { queryVec[t] = 1; });

  const scored = vectors
    .map((vec, i) => ({ entry: entries[i], score: cosineSimilarity(queryVec, vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .filter(r => r.score > 0);

  console.log(`\n🔍 語意搜尋：「${question}」\n`);
  if (scored.length === 0) {
    console.log('（無相關結果）');
    return;
  }
  scored.forEach((r, i) => {
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

      default:
        console.log(`
Knowledge Digest Agent v2

指令：
  add-url  <URL>        [--tags=t1,t2] [--title="標題"]   新增 URL（AI 摘要）
  add-note "<內容>"     [--tags=t1,t2] [--title="標題"]   新增筆記
  query                 [--keyword=詞] [--tags=t] [--days=N] 查詢（含相關筆記）
  daily-review                                              每日複習（3 則加權隨機）
  inbox                                                     收件匣（待處理筆記）
  mark-read <id>                                            標記為已讀
  archive   <id>                                            封存筆記
  semantic-search "<問題>"                                  語意搜尋
  weekly                                                    週報
  stats                                                     統計
        `);
    }
  })().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

module.exports = { addUrl, addNote, query, dailyReview, inbox, markRead, archiveEntry, semanticSearch, weeklyReport, stats };
