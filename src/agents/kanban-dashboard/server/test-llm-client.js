#!/usr/bin/env node

/**
 * LLM Client 測試腳本
 * 測試所有 provider 和成本追蹤功能
 */

require('dotenv').config({ path: '/Users/suweicheng/projects/my-project/.env' });

const llmClient = require('./services/llm-client');
const apiUsageService = require('./services/api-usage-service');

const TEST_PROMPT = 'Say hello in one word';
const MAX_TOKENS = 10;

// 測試結果收集
const results = {
  passed: [],
  failed: [],
  skipped: []
};

// 顏色輸出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// ============================================================
// 測試函數
// ============================================================

async function testProvider(modelId, providerName) {
  const testName = `${providerName} Provider (${modelId})`;
  log(`\n🧪 Testing ${testName}...`, 'cyan');

  try {
    const startTime = Date.now();
    const result = await llmClient.callLLM(TEST_PROMPT, {
      model: modelId,
      maxTokens: MAX_TOKENS,
      source: 'test-script'
    });
    const duration = Date.now() - startTime;

    if (result && result.text) {
      log(`✅ ${testName} - SUCCESS`, 'green');
      log(`   Response: "${result.text.trim()}"`, 'gray');
      log(`   Tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`, 'gray');
      log(`   Cost: $${result.cost.total.toFixed(6)}`, 'gray');
      log(`   Duration: ${duration}ms`, 'gray');
      results.passed.push(testName);
      return true;
    } else {
      throw new Error('No response text received');
    }
  } catch (error) {
    log(`❌ ${testName} - FAILED`, 'red');
    log(`   Error: ${error.message}`, 'gray');
    results.failed.push({ name: testName, error: error.message });
    return false;
  }
}

async function testCostCalculation() {
  const testName = 'Cost Calculation';
  log(`\n🧪 Testing ${testName}...`, 'cyan');

  try {
    const testUsage = {
      inputTokens: 1000000,  // 1M tokens
      outputTokens: 1000000  // 1M tokens
    };

    // 測試 Claude Haiku ($1 input / $5 output per million)
    const haikuCost = llmClient.calculateCost('claude-haiku-4-5-20251001', testUsage);
    if (haikuCost.input === 1.0 && haikuCost.output === 5.0 && haikuCost.total === 6.0) {
      log(`✅ ${testName} - Haiku pricing correct`, 'green');
      log(`   1M + 1M tokens = $${haikuCost.total.toFixed(2)}`, 'gray');
    } else {
      throw new Error(`Haiku cost mismatch: expected $6.00, got $${haikuCost.total.toFixed(2)}`);
    }

    // 測試 Ollama (應該是 $0)
    const ollamaCost = llmClient.calculateCost('llama3.2', testUsage);
    if (ollamaCost.total === 0) {
      log(`✅ ${testName} - Ollama free pricing correct`, 'green');
    } else {
      throw new Error(`Ollama cost should be $0, got $${ollamaCost.total}`);
    }

    results.passed.push(testName);
    return true;
  } catch (error) {
    log(`❌ ${testName} - FAILED`, 'red');
    log(`   Error: ${error.message}`, 'gray');
    results.failed.push({ name: testName, error: error.message });
    return false;
  }
}

async function testUsageTracking() {
  const testName = 'Usage Tracking';
  log(`\n🧪 Testing ${testName}...`, 'cyan');

  try {
    // 取得測試前的調用數量
    const beforeSummary = apiUsageService.getSummary();
    const beforeCount = beforeSummary.totalCalls;

    // 執行一次 LLM 調用（使用最便宜的模型）
    await llmClient.callLLM('Test tracking', {
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 5,
      source: 'tracking-test'
    });

    // 檢查調用是否被記錄
    const afterSummary = apiUsageService.getSummary();
    const afterCount = afterSummary.totalCalls;

    if (afterCount === beforeCount + 1) {
      log(`✅ ${testName} - Call recorded successfully`, 'green');
      log(`   Calls: ${beforeCount} → ${afterCount}`, 'gray');
      log(`   Total cost: $${afterSummary.totalCost.toFixed(6)}`, 'gray');
      results.passed.push(testName);
      return true;
    } else {
      throw new Error(`Call count mismatch: expected ${beforeCount + 1}, got ${afterCount}`);
    }
  } catch (error) {
    log(`❌ ${testName} - FAILED`, 'red');
    log(`   Error: ${error.message}`, 'gray');
    results.failed.push({ name: testName, error: error.message });
    return false;
  }
}

async function checkOllamaAvailability() {
  try {
    const res = await fetch('http://localhost:11434/api/version', {
      signal: AbortSignal.timeout(2000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ============================================================
// 主測試流程
// ============================================================

async function runTests() {
  log('═══════════════════════════════════════════════════', 'cyan');
  log('   LLM Client & Cost Tracking - Test Suite', 'cyan');
  log('═══════════════════════════════════════════════════', 'cyan');

  // 檢查環境變數
  log('\n📋 Environment Check:', 'cyan');
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  const ollamaAvailable = await checkOllamaAvailability();

  log(`   Anthropic API Key: ${hasAnthropicKey ? '✓' : '✗'}`, hasAnthropicKey ? 'green' : 'yellow');
  log(`   OpenAI API Key: ${hasOpenAIKey ? '✓' : '✗'}`, hasOpenAIKey ? 'green' : 'yellow');
  log(`   Ollama: ${ollamaAvailable ? '✓ Running' : '✗ Not running'}`, ollamaAvailable ? 'green' : 'yellow');

  // 測試 1: 成本計算
  await testCostCalculation();

  // 測試 2: Anthropic Provider
  if (hasAnthropicKey) {
    await testProvider('claude-haiku-4-5-20251001', 'Anthropic');
  } else {
    log('\n⏭️  Skipping Anthropic test (no API key)', 'yellow');
    results.skipped.push('Anthropic Provider');
  }

  // 測試 3: OpenAI Provider
  if (hasOpenAIKey) {
    await testProvider('gpt-4o-mini', 'OpenAI');
  } else {
    log('\n⏭️  Skipping OpenAI test (no API key)', 'yellow');
    results.skipped.push('OpenAI Provider');
  }

  // 測試 4: Ollama Provider
  if (ollamaAvailable) {
    await testProvider('llama3.2', 'Ollama');
  } else {
    log('\n⏭️  Skipping Ollama test (not running)', 'yellow');
    results.skipped.push('Ollama Provider');
  }

  // 測試 5: 使用追蹤
  if (hasAnthropicKey || hasOpenAIKey || ollamaAvailable) {
    await testUsageTracking();
  } else {
    log('\n⏭️  Skipping usage tracking test (no providers available)', 'yellow');
    results.skipped.push('Usage Tracking');
  }

  // 顯示測試統計
  log('\n═══════════════════════════════════════════════════', 'cyan');
  log('   Test Results', 'cyan');
  log('═══════════════════════════════════════════════════', 'cyan');

  if (results.passed.length > 0) {
    log(`\n✅ Passed (${results.passed.length}):`, 'green');
    results.passed.forEach(test => log(`   - ${test}`, 'gray'));
  }

  if (results.failed.length > 0) {
    log(`\n❌ Failed (${results.failed.length}):`, 'red');
    results.failed.forEach(({ name, error }) => {
      log(`   - ${name}`, 'gray');
      log(`     ${error}`, 'red');
    });
  }

  if (results.skipped.length > 0) {
    log(`\n⏭️  Skipped (${results.skipped.length}):`, 'yellow');
    results.skipped.forEach(test => log(`   - ${test}`, 'gray'));
  }

  const totalTests = results.passed.length + results.failed.length;
  const successRate = totalTests > 0 ? (results.passed.length / totalTests * 100).toFixed(1) : 0;

  log(`\n📊 Success Rate: ${successRate}% (${results.passed.length}/${totalTests})`,
    results.failed.length === 0 ? 'green' : 'yellow');

  // 顯示 API 使用摘要
  if (hasAnthropicKey || hasOpenAIKey || ollamaAvailable) {
    log('\n═══════════════════════════════════════════════════', 'cyan');
    log('   API Usage Summary', 'cyan');
    log('═══════════════════════════════════════════════════', 'cyan');

    const summary = apiUsageService.getSummary();
    log(`\nTotal Calls: ${summary.totalCalls}`, 'gray');
    log(`Total Cost: $${summary.totalCost.toFixed(6)}`, 'gray');
    log(`Last 24h: ${summary.last24h.calls} calls, $${summary.last24h.cost.toFixed(6)}`, 'gray');

    if (Object.keys(summary.byModel).length > 0) {
      log('\nBy Model:', 'gray');
      Object.entries(summary.byModel).forEach(([model, stats]) => {
        log(`  ${model}:`, 'gray');
        log(`    Calls: ${stats.calls}`, 'gray');
        log(`    Cost: $${stats.cost.toFixed(6)}`, 'gray');
        log(`    Avg Latency: ${stats.avgLatency}ms`, 'gray');
      });
    }
  }

  log('\n═══════════════════════════════════════════════════\n', 'cyan');

  // 退出碼
  process.exit(results.failed.length > 0 ? 1 : 0);
}

// 執行測試
runTests().catch(error => {
  log(`\n💥 Test suite crashed: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
