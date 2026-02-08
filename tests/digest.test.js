"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "digest-test-"));
const tmpOutput = path.join(tmpRoot, "output");
const tmpExamples = path.join(tmpRoot, "examples");

process.env.DIGEST_OUTPUT_DIR = tmpOutput;
process.env.DIGEST_EXAMPLES_DIR = tmpExamples;

const { digestFetch, digestSummarize, digestRun } = require("../src/main/js/commands/digest");

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.DIGEST_OUTPUT_DIR;
  delete process.env.DIGEST_EXAMPLES_DIR;
});

describe("digest fetch", () => {
  before(() => {
    digestFetch();
  });

  it("應在 sample_input.txt 不存在時自動建立", () => {
    const sampleInput = path.join(tmpExamples, "sample_input.txt");
    assert.ok(fs.existsSync(sampleInput), "sample_input.txt 應已建立");
  });

  it("應產生 raw.json 且為陣列、長度 >= 10", () => {
    const rawJson = path.join(tmpOutput, "raw.json");
    assert.ok(fs.existsSync(rawJson), "raw.json 應存在");

    const items = JSON.parse(fs.readFileSync(rawJson, "utf-8"));
    assert.ok(Array.isArray(items), "raw.json 應為陣列");
    assert.ok(items.length >= 10, `期望 >= 10 筆，實際 ${items.length} 筆`);
  });

  it("每筆資料應包含必要欄位", () => {
    const rawJson = path.join(tmpOutput, "raw.json");
    const items = JSON.parse(fs.readFileSync(rawJson, "utf-8"));
    const required = ["id", "title", "source", "ts", "raw"];

    for (const item of items) {
      for (const key of required) {
        assert.ok(key in item, `缺少欄位：${key}`);
      }
    }
  });
});

describe("digest summarize", () => {
  before(() => {
    digestSummarize();
  });

  it("應產生 brief.json 且長度為 5", () => {
    const briefJson = path.join(tmpOutput, "brief.json");
    assert.ok(fs.existsSync(briefJson), "brief.json 應存在");

    const items = JSON.parse(fs.readFileSync(briefJson, "utf-8"));
    assert.equal(items.length, 5, `期望 5 筆，實際 ${items.length} 筆`);
  });

  it("brief.json 每筆應有 title 欄位", () => {
    const briefJson = path.join(tmpOutput, "brief.json");
    const items = JSON.parse(fs.readFileSync(briefJson, "utf-8"));

    for (const item of items) {
      assert.ok(typeof item.title === "string" && item.title.length > 0, "title 應為非空字串");
    }
  });

  it("應產生 brief.md", () => {
    const briefMd = path.join(tmpOutput, "brief.md");
    assert.ok(fs.existsSync(briefMd), "brief.md 應存在");

    const content = fs.readFileSync(briefMd, "utf-8");
    assert.ok(content.includes("# 每日新聞摘要"), "brief.md 應包含標題");
  });
});

describe("digest run", () => {
  it("應完整執行 fetch + summarize 不拋錯", () => {
    const runOutput = path.join(tmpRoot, "output-run");
    process.env.DIGEST_OUTPUT_DIR = runOutput;

    const runExamples = path.join(tmpRoot, "examples-run");
    process.env.DIGEST_EXAMPLES_DIR = runExamples;

    assert.doesNotThrow(() => {
      digestRun();
    });

    assert.ok(fs.existsSync(path.join(runOutput, "raw.json")), "run 後 raw.json 應存在");
    assert.ok(fs.existsSync(path.join(runOutput, "brief.json")), "run 後 brief.json 應存在");
    assert.ok(fs.existsSync(path.join(runOutput, "brief.md")), "run 後 brief.md 應存在");

    process.env.DIGEST_OUTPUT_DIR = tmpOutput;
    process.env.DIGEST_EXAMPLES_DIR = tmpExamples;
  });
});
