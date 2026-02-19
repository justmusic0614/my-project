#!/usr/bin/env node
/**
 * 環境變數替換驗證測試
 * 快速驗證 config-loader.js 的 regex 修復是否正確
 */

const { ConfigLoader, resetConfig } = require('../shared/config-loader');

console.log('Testing environment variable interpolation\n');

const tests = [
  {
    name: '基本替換',
    env: { TEST_VAR: 'test-value' },
    input: '${TEST_VAR}',
    expected: 'test-value'
  },
  {
    name: '預設值（變數存在）',
    env: { TEST_VAR: 'actual-value' },
    input: '${TEST_VAR:-default-value}',
    expected: 'actual-value'
  },
  {
    name: '預設值（變數不存在）',
    env: {},
    input: '${MISSING_VAR:-fallback}',
    expected: 'fallback'
  },
  {
    name: '空字串應使用預設值',
    env: { EMPTY_VAR: '' },
    input: '${EMPTY_VAR:-default}',
    expected: 'default'
  },
  {
    name: '複雜字串中的多個變數',
    env: { API_KEY: 'sk-123', ENDPOINT: 'api.example.com' },
    input: 'https://${ENDPOINT}/v1?key=${API_KEY}',
    expected: 'https://api.example.com/v1?key=sk-123'
  },
  {
    name: '未找到的變數保持原樣',
    env: {},
    input: '${UNDEFINED_VAR}',
    expected: '${UNDEFINED_VAR}'
  },
  {
    name: '普通字串不受影響',
    env: {},
    input: 'hello world',
    expected: 'hello world'
  },
  {
    name: '混合文字與變數',
    env: { PORT: '3000' },
    input: 'http://localhost:${PORT}/api',
    expected: 'http://localhost:3000/api'
  }
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  resetConfig();

  const loader = new ConfigLoader();
  loader.env = test.env;

  const result = loader.replaceEnvVars(test.input);
  const success = result === test.expected;

  if (success) {
    console.log(`  PASS  ${test.name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${test.name}`);
    console.log(`   input:    "${test.input}"`);
    console.log(`   expected: "${test.expected}"`);
    console.log(`   actual:   "${result}"\n`);
    failed++;
  }
}

console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
