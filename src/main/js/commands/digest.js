#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "../../../..");

function resolveOutputDir() {
  return process.env.DIGEST_OUTPUT_DIR || path.join(ROOT, "output");
}

function resolveExamplesDir() {
  return process.env.DIGEST_EXAMPLES_DIR || path.join(ROOT, "examples");
}

const PRIORITY_KEYWORDS = ["Fed", "CPI", "台積電", "美股", "美元", "殖利率", "AI"];

const DEFAULT_HEADLINES = [
  "Fed宣布維持利率不變 市場反應平穩",
  "台積電第四季營收創歷史新高 AI晶片需求強勁",
  "美股三大指數齊漲 道瓊突破四萬點大關",
  "CPI年增率降至2.3% 通膨壓力持續緩解",
  "美元指數跌破104 亞洲貨幣普遍走強",
  "殖利率曲線倒掛加劇 經濟衰退疑慮升溫",
  "AI概念股全面噴發 輝達市值突破三兆美元",
  "台股加權指數站上兩萬點 外資連續買超",
  "Fed主席鮑爾暗示年底前可能降息兩次",
  "國際油價回落至每桶70美元 能源類股承壓",
];

function digestHelp() {
  console.log(`
my-project digest - 新聞摘要工具

Usage:
  my-project digest fetch       讀取範例輸入並產生 output/raw.json
  my-project digest summarize   從 raw.json 產生 Top 5 摘要
  my-project digest run         依序執行 fetch → summarize
  my-project digest --help      顯示此說明

Output:
  output/raw.json     所有正規化新聞條目
  output/brief.json   Top 5 摘要 (JSON)
  output/brief.md     Top 5 摘要 (Markdown)
`.trim());
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function digestFetch() {
  const examplesDir = resolveExamplesDir();
  const outputDir = resolveOutputDir();
  const sampleInput = path.join(examplesDir, "sample_input.txt");
  const rawJson = path.join(outputDir, "raw.json");

  ensureDir(examplesDir);
  ensureDir(outputDir);

  if (!fs.existsSync(sampleInput)) {
    console.log("sample_input.txt 不存在，建立預設範例...");
    fs.writeFileSync(sampleInput, DEFAULT_HEADLINES.join("\n") + "\n", "utf-8");
  }

  const content = fs.readFileSync(sampleInput, "utf-8");
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const now = new Date().toISOString();
  const items = lines.map((line) => ({
    id: crypto.randomUUID(),
    title: line,
    source: "sample",
    ts: now,
    raw: line,
  }));

  fs.writeFileSync(rawJson, JSON.stringify(items, null, 2), "utf-8");
  console.log(`fetch 完成：${items.length} 筆寫入 ${rawJson}`);
}

function scoreItem(item) {
  const matched = PRIORITY_KEYWORDS.filter((kw) => item.title.includes(kw));
  return { keywordCount: matched.length, titleLength: item.title.length };
}

function digestSummarize() {
  const outputDir = resolveOutputDir();
  const rawJson = path.join(outputDir, "raw.json");
  const briefJson = path.join(outputDir, "brief.json");
  const briefMd = path.join(outputDir, "brief.md");

  if (!fs.existsSync(rawJson)) {
    console.error("錯誤：raw.json 不存在，請先執行 digest fetch");
    process.exitCode = 1;
    return;
  }

  const items = JSON.parse(fs.readFileSync(rawJson, "utf-8"));

  const scored = items.map((item) => {
    const s = scoreItem(item);
    return { ...item, _keywordCount: s.keywordCount, _titleLength: s.titleLength };
  });

  scored.sort((a, b) => {
    if (b._keywordCount !== a._keywordCount) return b._keywordCount - a._keywordCount;
    return b._titleLength - a._titleLength;
  });

  const top5 = scored.slice(0, 5).map(({ _keywordCount, _titleLength, ...rest }) => rest);

  ensureDir(outputDir);

  fs.writeFileSync(briefJson, JSON.stringify(top5, null, 2), "utf-8");

  const now = new Date().toISOString();
  const mdLines = [
    "# 每日新聞摘要 — Top 5",
    "",
    `> 產生時間：${now}`,
    "",
    ...top5.map((item, i) => `${i + 1}. **${item.title}**  \n   來源：${item.source} ｜ ${item.ts}`),
    "",
    "---",
    `共 ${items.length} 筆來源，篩選 ${top5.length} 筆重點新聞。`,
    "",
  ];
  fs.writeFileSync(briefMd, mdLines.join("\n"), "utf-8");

  console.log(`summarize 完成：Top ${top5.length} 寫入 ${briefJson} 及 ${briefMd}`);
}

function digestRun() {
  digestFetch();
  digestSummarize();
}

function cmdDigest(args) {
  const sub = args._[1];

  if (!sub || sub === "--help" || args.help) {
    digestHelp();
    return;
  }

  switch (sub) {
    case "fetch":
      digestFetch();
      break;
    case "summarize":
      digestSummarize();
      break;
    case "run":
      digestRun();
      break;
    default:
      console.error(`未知的 digest 子指令：${sub}`);
      digestHelp();
      process.exitCode = 1;
  }
}

module.exports = { cmdDigest, digestFetch, digestSummarize, digestRun };
