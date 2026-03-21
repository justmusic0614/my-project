#!/usr/bin/env node
/**
 * brain-distill.js — 純文字/URL → Brain Markdown → JSON → Knowledge Base
 *
 * Usage:
 *   node brain-distill.js "<text or URL>" [--job-id=brain-xxx]
 *
 * Output (stdout):
 *   ---RESULT_START---
 *   { "ok": true, "summary": "...", "docId": "brain-xxx", "brainFile": "...", "error": null }
 *   ---RESULT_END---
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ─── Paths ──────────────────────────────────────────────────────────────────

const SCRIPT_DIR = __dirname;
const AGENT_ROOT = path.resolve(SCRIPT_DIR, '..');
const SHARED_DIR = path.resolve(AGENT_ROOT, '..', '..', 'shared');
const PROJECT_ROOT = path.resolve(AGENT_ROOT, '..', '..', '..');

const PROMPT_PATH = path.join(SHARED_DIR, 'prompts', 'brain_v1.md');
const BRAIN_PARSER_PATH = path.join(PROJECT_ROOT, 'tools', 'brain-parser.py');
const DIGEST_SCRIPT = path.join(SCRIPT_DIR, 'digest.js');
const DATA_DIR = path.join(AGENT_ROOT, 'data', 'runtime', 'brain');
const RAW_DIR = path.join(DATA_DIR, 'raw');

const PLACEHOLDER = '<<<TRANSCRIPT>>>';
const RESULT_DELIM_START = '---RESULT_START---';
const RESULT_DELIM_END = '---RESULT_END---';

// ─── Load .env ──────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

// ─── Input Classification ───────────────────────────────────────────────────

function classifyInput(input) {
  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./, '');
    if (host.endsWith('youtube.com') || host === 'youtu.be') return 'youtube';
    return 'webpage';
  } catch {
    return input.startsWith('http') ? 'webpage' : 'text';
  }
}

function sourceTypeFromClass(inputType) {
  const map = { text: 'telegram-text', webpage: 'telegram-url', youtube: 'telegram-youtube' };
  return map[inputType] || 'telegram-text';
}

// ─── Content Extraction ─────────────────────────────────────────────────────

function extractYouTube(url) {
  const cmd = `summarize "${url}" --extract --youtube auto`;
  return execSync(cmd, { encoding: 'utf8', timeout: 180000, maxBuffer: 20 * 1024 * 1024 }).trim();
}

function extractWebpage(url) {
  // Primary: summarize --extract
  try {
    const cmd = `summarize "${url}" --extract`;
    return execSync(cmd, { encoding: 'utf8', timeout: 60000, maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch (e) {
    console.error(`[brain-distill] summarize --extract failed, trying curl fallback: ${e.message}`);
  }
  // Fallback: curl + strip HTML
  try {
    const html = execSync(`curl -sL --max-time 30 "${url}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100000);
  } catch (e2) {
    throw new Error(`網頁擷取失敗：${e2.message}`);
  }
}

function extractContent(input, inputType) {
  switch (inputType) {
    case 'text':
      return input;
    case 'youtube':
      return extractYouTube(input);
    case 'webpage':
      return extractWebpage(input);
    default:
      return input;
  }
}

// ─── Title Generation ───────────────────────────────────────────────────────

function generateTitle(input, inputType) {
  if (inputType === 'youtube' || inputType === 'webpage') {
    try {
      const url = new URL(input);
      return `Brain: ${url.hostname}${url.pathname.substring(0, 60)}`;
    } catch { /* fallthrough */ }
  }
  // 純文字：取前 50 字
  const clean = input.replace(/\n/g, ' ').trim();
  return `Brain: ${clean.substring(0, 50)}${clean.length > 50 ? '...' : ''}`;
}

// ─── OpenAI API ─────────────────────────────────────────────────────────────

async function callOpenAI(systemPrompt, userMessage) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY 未設定');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 8000,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${errBody.substring(0, 300)}`);
  }

  const data = await response.json();
  if (!data.choices || !data.choices[0]) {
    throw new Error('OpenAI API 未返回 choices');
  }
  return data.choices[0].message.content;
}

// ─── Summary Extraction ─────────────────────────────────────────────────────

function extractSummary(brainContent, jobId) {
  const sections = {};
  const sectionRe = /^## (.+)$/gm;
  let match;
  const matches = [];
  while ((match = sectionRe.exec(brainContent)) !== null) {
    matches.push({ name: match[1].trim(), start: match.index + match[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const end = i + 1 < matches.length ? matches[i + 1].start - matches[i + 1].name.length - 4 : brainContent.length;
    sections[matches[i].name] = brainContent.substring(matches[i].start, end).trim();
  }

  const parts = [];
  if (sections['Executive Insight']) {
    parts.push(`**Executive Insight**\n${sections['Executive Insight']}`);
  }
  if (sections['Key Takeaways']) {
    parts.push(`**Key Takeaways**\n${sections['Key Takeaways']}`);
  }
  parts.push(`\u{1F4A1} 用 /brain-search ${jobId} 查詢全文`);

  let summary = parts.join('\n\n');
  if (summary.length > 3800) {
    summary = summary.substring(0, 3797) + '...';
  }
  return summary;
}

// ─── Source Metadata ────────────────────────────────────────────────────────

function buildSourceSection(jobId, inputType, brainFilePath) {
  const now = new Date();
  const tz = '+08:00';
  const generated = now.toISOString().replace('Z', tz);

  return [
    '## Source',
    '',
    `- Document-ID: ${jobId}`,
    `- Source-Type: ${sourceTypeFromClass(inputType)}`,
    `- Source-Basename: ${jobId}.md`,
    `- File: ${brainFilePath}`,
    `- Generated: ${generated}`,
    '- Engine: brain-distill',
    '- Model: openai/gpt-4o-mini',
    '- Style: brain',
    '- Template-Version: brain_v1',
  ].join('\n');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help') {
    console.error('Usage: node brain-distill.js "<text or URL>" [--job-id=brain-xxx]');
    process.exit(1);
  }

  // Parse args
  const input = args.find(a => !a.startsWith('--'));
  if (!input) {
    outputResult({ ok: false, summary: null, docId: null, brainFile: null, error: '未提供輸入' });
    process.exit(1);
  }

  const jobIdArg = args.find(a => a.startsWith('--job-id='));
  const jobId = jobIdArg ? jobIdArg.split('=')[1] : `brain-${Date.now()}`;
  const inputType = classifyInput(input);

  console.error(`[brain-distill] jobId=${jobId} type=${inputType} input=${input.substring(0, 80)}`);

  try {
    // 1. Save raw input
    fs.mkdirSync(RAW_DIR, { recursive: true });
    fs.writeFileSync(path.join(RAW_DIR, `${jobId}.input.txt`), input, 'utf8');

    // 2. Extract content
    console.error(`[brain-distill] Extracting content (${inputType})...`);
    const rawContent = extractContent(input, inputType);
    if (!rawContent || rawContent.length < 20) {
      throw new Error(`擷取內容過短（${rawContent ? rawContent.length : 0} 字元）`);
    }
    console.error(`[brain-distill] Content extracted: ${rawContent.length} chars`);

    // 3. Load prompt template
    if (!fs.existsSync(PROMPT_PATH)) {
      throw new Error(`Prompt 模板不存在: ${PROMPT_PATH}`);
    }
    const template = fs.readFileSync(PROMPT_PATH, 'utf8');
    if (!template.includes(PLACEHOLDER)) {
      throw new Error(`Prompt 模板缺少 ${PLACEHOLDER} placeholder`);
    }

    // 4. Build system prompt (remove placeholder) + user message
    const systemPrompt = template.replace(PLACEHOLDER, '').trim();
    const userMessage = rawContent;

    // 5. Call OpenAI API
    console.error('[brain-distill] Calling OpenAI API...');
    const brainContent = await callOpenAI(systemPrompt, userMessage);
    console.error(`[brain-distill] API response: ${brainContent.length} chars`);

    // 6. Assemble brain markdown
    const title = generateTitle(input, inputType);
    const brainFilePath = path.join(DATA_DIR, `${jobId}.md`);
    const sourceSection = buildSourceSection(jobId, inputType, brainFilePath);

    const brainMd = [
      `# ${title}`,
      '',
      sourceSection,
      '',
      '---',
      '',
      brainContent,
    ].join('\n');

    // 7. Write brain markdown
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(brainFilePath, brainMd, 'utf8');
    console.error(`[brain-distill] Saved: ${brainFilePath}`);

    // 8. Run brain-parser
    let parserWarning = '';
    try {
      const parserCmd = `python3 "${BRAIN_PARSER_PATH}" "${brainFilePath}" -o "${DATA_DIR}" --doc-id "${jobId}" --no-transcript`;
      console.error(`[brain-distill] Running brain-parser...`);
      execSync(parserCmd, { encoding: 'utf8', timeout: 30000 });
    } catch (e) {
      console.error(`[brain-distill] brain-parser warning: ${e.message}`);
      parserWarning = '（brain-parser 有警告）';
    }

    // 9. Run digest ingest
    let ingestWarning = '';
    const chunksFile = path.join(DATA_DIR, 'chunks', `${jobId}.chunks.json`);
    if (fs.existsSync(chunksFile)) {
      try {
        const ingestCmd = `node "${DIGEST_SCRIPT}" ingest "${chunksFile}" --yes --tags=brain`;
        console.error(`[brain-distill] Running digest ingest...`);
        execSync(ingestCmd, { encoding: 'utf8', timeout: 30000 });
      } catch (e) {
        console.error(`[brain-distill] digest ingest warning: ${e.message}`);
        ingestWarning = '（寫入 KB 失敗）';
      }
    } else {
      ingestWarning = '（chunks 檔案不存在，跳過 ingest）';
    }

    // 10. Extract summary
    const summary = extractSummary(brainContent, jobId)
      + (parserWarning ? `\n\n⚠️ ${parserWarning}` : '')
      + (ingestWarning ? `\n\n⚠️ ${ingestWarning}` : '');

    outputResult({ ok: true, summary, docId: jobId, brainFile: brainFilePath, error: null });

  } catch (err) {
    console.error(`[brain-distill] Fatal: ${err.message}`);
    outputResult({ ok: false, summary: null, docId: jobId, brainFile: null, error: err.message });
    process.exit(1);
  }
}

function outputResult(result) {
  console.log(RESULT_DELIM_START);
  console.log(JSON.stringify(result));
  console.log(RESULT_DELIM_END);
}

main();
