'use strict';

/**
 * ai-summarizer.js — AI 批次摘要 + 分類（M13）
 *
 * 透過 OpenAI gpt-4o-mini 批次處理貼文，產出：
 *   category, summary, tags, importance_score, ai_confidence, reasons
 *
 * 設計重點：
 *   - JSON mode（response_format: json_object）
 *   - _validateResult() 嚴格 schema 驗證 + hard truncation（B5）
 *   - 失敗自動 retry 附 error context（A4）
 *   - 失敗率 > 50% 停止剩餘 batches
 *   - maxCallsPerRun cap（A5，預設 10 含 retry）
 */

const {
  AI_RESULT_FIELDS,
  AI_CONFIDENCE_ENUM,
  SUMMARY_MAX_CHARS,
  REASONS_MAX_COUNT,
  TAGS_MAX_COUNT,
} = require('../shared/contracts');

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert content analyst for a daily tech & finance news digest.

For each post provided, output a JSON object with this exact schema:
{
  "posts": [
    {
      "id": "<same id from input>",
      "category": "<one of: AI, Finance, DevTools, Career, Community, Security, Cloud, Mobile, Other>",
      "summary": "<concise summary in the post's original language, max ${SUMMARY_MAX_CHARS} chars>",
      "tags": ["<max ${TAGS_MAX_COUNT} tags, lowercase, no spaces>"],
      "importance_score": <integer 0-100>,
      "ai_confidence": "<HIGH | MED | LOW>",
      "reasons": ["<max ${REASONS_MAX_COUNT} reasons, each max 12 words>"]
    }
  ]
}

Scoring guide:
  90-100: Major industry event, critical vulnerability, paradigm shift
  70-89:  High-value insight, significant release, important analysis
  50-69:  Useful information, moderate relevance
  30-49:  Low relevance, routine updates
  0-29:   Noise, spam, or off-topic

Rules:
- Output ONLY valid JSON. No markdown, no extra text.
- Every post in the input MUST appear in the output (same id).
- Do NOT invent posts not in the input.
- summary must be ≤ ${SUMMARY_MAX_CHARS} characters.
- reasons must have ≤ ${REASONS_MAX_COUNT} items, each ≤ 12 words.
- tags must have ≤ ${TAGS_MAX_COUNT} items.`;

// ── Build Prompt ──────────────────────────────────────────────────────────────

/**
 * 建構 user message 中的 posts payload
 * @param {Array} posts - DB posts（含 id, snippet, group_name, author, source, url）
 * @returns {string} JSON string
 */
function _buildPrompt(posts) {
  const items = posts.map(p => ({
    id: p.id,
    snippet: (p.snippet || '').slice(0, 1000),
    group_name: p.group_name || '',
    author: p.author || '',
    source: p.source || '',
    url: p.url || '',
  }));
  return JSON.stringify(items);
}

// ── Parse Response ────────────────────────────────────────────────────────────

/**
 * 解析 OpenAI 回傳（C2 容錯）
 * @param {string} content - choices[0].message.content
 * @returns {{ posts: Array } | null} - null 表示 parse 失敗
 */
function _parseResponse(content) {
  if (!content || typeof content !== 'string') return null;

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  // 頂層必須是 object 且含 posts array
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.posts)) {
    return null;
  }

  return parsed;
}

// ── Validate Result ───────────────────────────────────────────────────────────

/**
 * 驗證 + 強制裁切每筆 AI 結果（B5 hard truncation）
 * @param {Array} aiPosts - parsed.posts
 * @param {Set<string>} validIds - input post ids
 * @returns {{ valid: Array, errors: string[], stats: object }}
 */
function _validateResult(aiPosts, validIds) {
  const valid = [];
  const errors = [];
  const stats = { ai_invalid_id: 0, ai_truncated: 0 };

  for (const item of aiPosts) {
    // ID 過濾：丟棄不在 input 中的
    if (!item.id || !validIds.has(item.id)) {
      stats.ai_invalid_id++;
      errors.push(`unknown id: ${item.id}`);
      continue;
    }

    // 必要欄位檢查（post_id 由 id 映射，不在此檢查）
    const missing = [];
    for (const field of AI_RESULT_FIELDS) {
      if (field === 'post_id') continue; // id → post_id 在最後映射
      if (item[field] === undefined || item[field] === null) {
        missing.push(field);
      }
    }
    if (missing.length > 0) {
      errors.push(`id=${item.id} missing: ${missing.join(', ')}`);
      // 嘗試用 fallback 修補而非直接丟棄
      if (missing.includes('importance_score')) item.importance_score = 50;
      if (missing.includes('ai_confidence')) item.ai_confidence = 'MED';
      if (missing.includes('summary')) item.summary = '';
      if (missing.includes('category')) item.category = 'Other';
      if (missing.includes('tags')) item.tags = [];
      if (missing.includes('reasons')) item.reasons = [];
    }

    // importance_score 型別檢查
    if (typeof item.importance_score !== 'number' || isNaN(item.importance_score)) {
      errors.push(`id=${item.id} importance_score not a number, fallback 50`);
      item.importance_score = 50;
    }
    item.importance_score = Math.max(0, Math.min(100, Math.round(item.importance_score)));

    // ai_confidence enum 檢查
    if (!AI_CONFIDENCE_ENUM.includes(item.ai_confidence)) {
      errors.push(`id=${item.id} invalid ai_confidence: ${item.ai_confidence}`);
      item.ai_confidence = 'MED';
    }

    // tags 型別 + 裁切
    if (!Array.isArray(item.tags)) {
      item.tags = typeof item.tags === 'string' ? [item.tags] : [];
    }
    if (item.tags.length > TAGS_MAX_COUNT) {
      item.tags = item.tags.slice(0, TAGS_MAX_COUNT);
      stats.ai_truncated++;
    }

    // reasons 型別 + 裁切
    if (!Array.isArray(item.reasons)) {
      item.reasons = typeof item.reasons === 'string' ? [item.reasons] : [];
    }
    if (item.reasons.length > REASONS_MAX_COUNT) {
      item.reasons = item.reasons.slice(0, REASONS_MAX_COUNT);
      stats.ai_truncated++;
    }

    // summary 裁切
    if (typeof item.summary !== 'string') item.summary = String(item.summary || '');
    if (item.summary.length > SUMMARY_MAX_CHARS) {
      item.summary = item.summary.slice(0, SUMMARY_MAX_CHARS - 3) + '...';
      stats.ai_truncated++;
    }

    valid.push({
      post_id: item.id,
      category: item.category || 'Other',
      summary: item.summary,
      tags: item.tags,
      importance_score: item.importance_score,
      ai_confidence: item.ai_confidence,
      reasons: item.reasons,
    });
  }

  return { valid, errors, stats };
}

// ── Summarize Batch ───────────────────────────────────────────────────────────

/**
 * 處理單批貼文
 * @param {Array} posts - 一批貼文
 * @param {object} config - config.ai
 * @param {object} openai - OpenAI client instance
 * @returns {{ results: Array, stats: object }}
 */
async function summarizeBatch(posts, config, openai) {
  const validIds = new Set(posts.map(p => p.id));
  const userMsg = _buildPrompt(posts);
  const stats = {
    ai_tokens_in: 0,
    ai_tokens_out: 0,
    ai_invalid_id: 0,
    ai_truncated: 0,
    ai_retry_success: 0,
    ai_retry_fail: 0,
    ai_coverage: 0,
  };

  let lastErrors = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ];

    // A4: retry 帶 error context
    if (attempt > 0 && lastErrors.length > 0) {
      messages.push({
        role: 'user',
        content: `Previous output had errors: ${lastErrors.join('; ')}. Please output again strictly matching schema.`,
      });
    }

    let response;
    try {
      response = await openai.chat.completions.create({
        model: config.model || 'gpt-4o-mini',
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.3,
      });
    } catch (err) {
      console.error(`[ai-summarizer] API error (attempt ${attempt + 1}):`, err.message);
      if (attempt === 0) continue;
      stats.ai_retry_fail++;
      return { results: [], stats };
    }

    // Token 追蹤
    if (response.usage) {
      stats.ai_tokens_in += response.usage.prompt_tokens || 0;
      stats.ai_tokens_out += response.usage.completion_tokens || 0;
    }

    const content = response.choices?.[0]?.message?.content;
    const parsed = _parseResponse(content);

    if (!parsed) {
      lastErrors = ['Response is not valid JSON or missing posts array'];
      if (attempt === 0) continue;
      stats.ai_retry_fail++;
      return { results: [], stats };
    }

    const { valid, errors, stats: vStats } = _validateResult(parsed.posts, validIds);
    Object.assign(stats, {
      ai_invalid_id: stats.ai_invalid_id + vStats.ai_invalid_id,
      ai_truncated: stats.ai_truncated + vStats.ai_truncated,
    });

    // 有嚴重錯誤且是第一次 → retry
    if (errors.length > 0 && attempt === 0) {
      lastErrors = errors;
      continue;
    }

    if (attempt > 0 && valid.length > 0) {
      stats.ai_retry_success++;
    }
    stats.ai_coverage = valid.length / posts.length;
    return { results: valid, stats };
  }

  // should not reach here, but safety fallback
  stats.ai_retry_fail++;
  return { results: [], stats };
}

// ── Summarize All ─────────────────────────────────────────────────────────────

/**
 * 批次處理所有待 AI 的貼文
 * @param {object} db - DB instance
 * @param {object} config - 完整 config（取 config.ai）
 * @returns {{ totalProcessed: number, stats: object }}
 */
async function summarizeAll(db, config) {
  const aiConfig = config.ai || {};
  const maxPostsPerDay = aiConfig.maxPostsPerDay || 200;
  const batchSize = aiConfig.batchSize || 30;
  const maxBatches = aiConfig.maxBatches || 6;
  const maxCallsPerRun = aiConfig.maxCallsPerRun || 10;

  const posts = db.getPostsForAI(maxPostsPerDay);
  if (posts.length === 0) {
    console.log('[ai-summarizer] No posts pending AI processing');
    return { totalProcessed: 0, stats: { ai_tokens_in: 0, ai_tokens_out: 0 } };
  }

  console.log(`[ai-summarizer] ${posts.length} posts to process (batchSize=${batchSize}, maxBatches=${maxBatches})`);

  // OpenAI client — lazy init
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: aiConfig.apiKey });

  const aggStats = {
    ai_tokens_in: 0,
    ai_tokens_out: 0,
    ai_invalid_id: 0,
    ai_truncated: 0,
    ai_retry_success: 0,
    ai_retry_fail: 0,
    ai_batches_attempted: 0,
    ai_batches_succeeded: 0,
    ai_call_cap_hit: false,
    ai_budget_halted: false,
    ai_coverage: 0,
  };

  let totalProcessed = 0;
  let totalCalls = 0;
  let failedBatches = 0;

  const batches = [];
  for (let i = 0; i < posts.length && batches.length < maxBatches; i += batchSize) {
    batches.push(posts.slice(i, i + batchSize));
  }

  for (const batch of batches) {
    // A5: maxCallsPerRun cap
    if (totalCalls >= maxCallsPerRun) {
      console.log(`[ai-summarizer] Call cap hit (${maxCallsPerRun}), stopping`);
      aggStats.ai_call_cap_hit = true;
      break;
    }

    // 失敗率 > 50% → halt
    if (aggStats.ai_batches_attempted > 0 && failedBatches / aggStats.ai_batches_attempted > 0.5) {
      console.log('[ai-summarizer] >50% batch failure rate, halting remaining');
      aggStats.ai_budget_halted = true;
      break;
    }

    aggStats.ai_batches_attempted++;
    totalCalls++; // 每次 summarizeBatch 至少 1 call（retry 時 +1 已在 batch 內計算）

    const { results, stats: batchStats } = await summarizeBatch(batch, aiConfig, openai);

    // Accumulate token stats
    aggStats.ai_tokens_in += batchStats.ai_tokens_in;
    aggStats.ai_tokens_out += batchStats.ai_tokens_out;
    aggStats.ai_invalid_id += batchStats.ai_invalid_id;
    aggStats.ai_truncated += batchStats.ai_truncated;
    aggStats.ai_retry_success += batchStats.ai_retry_success;
    aggStats.ai_retry_fail += batchStats.ai_retry_fail;

    // retry 也算 call
    if (batchStats.ai_retry_success || batchStats.ai_retry_fail) {
      totalCalls++;
    }

    if (results.length === 0) {
      failedBatches++;
      console.log(`[ai-summarizer] Batch ${aggStats.ai_batches_attempted} failed (0 results)`);
      continue;
    }

    aggStats.ai_batches_succeeded++;
    totalProcessed += results.length;

    // 立即寫入 DB
    for (const r of results) {
      db.upsertAiResult({
        ...r,
        model: aiConfig.model || 'gpt-4o-mini',
        prompt_version: aiConfig.promptVersion || '1.0',
      });
    }

    console.log(`[ai-summarizer] Batch ${aggStats.ai_batches_attempted}: ${results.length}/${batch.length} processed`);
  }

  if (totalProcessed > 0) {
    aggStats.ai_coverage = totalProcessed / posts.length;
  }

  console.log(`[ai-summarizer] Done: ${totalProcessed}/${posts.length} posts, tokens: ${aggStats.ai_tokens_in}/${aggStats.ai_tokens_out}`);

  return { totalProcessed, stats: aggStats };
}

module.exports = {
  summarizeAll,
  summarizeBatch,
  _buildPrompt,
  _parseResponse,
  _validateResult,
};
