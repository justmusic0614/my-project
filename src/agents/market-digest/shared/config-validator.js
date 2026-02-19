#!/usr/bin/env node
/**
 * 配置驗證工具
 * 用途：部署前驗證配置完整性
 * 使用：node shared/config-validator.js [--strict]
 */

const fs = require('fs');
const path = require('path');

// 載入 dotenv（獨立工具需自行處理）
const dotenv = require('dotenv');
const centralEnv = path.join(process.env.HOME || '', 'clawd', '.env');
const localEnv = path.join(__dirname, '../.env');
if (fs.existsSync(centralEnv)) {
  dotenv.config({ path: centralEnv });
} else if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv });
}

const { getConfig, resetConfig } = require('./config-loader');

const strict = process.argv.includes('--strict');

console.log('Config Validator\n');
console.log('='.repeat(60));

let errors = 0;
let warnings = 0;

// 1. 檢查 .env 檔案
console.log('\nCheck 1: .env file');

if (fs.existsSync(centralEnv)) {
  console.log(`  OK  Found VPS central config: ${centralEnv}`);
} else if (fs.existsSync(localEnv)) {
  console.log(`  OK  Found local config: ${localEnv}`);
} else {
  console.log('  WARN  No .env file found (relying on process.env)');
  warnings++;
}

// 2. 載入配置並檢查
console.log('\nCheck 2: Config loading & interpolation');
try {
  resetConfig();
  const config = getConfig();
  console.log('  OK  Config loaded successfully');

  const diagnostics = config.getEnvDiagnostics();
  if (diagnostics.missingVars.length > 0) {
    console.log(`  WARN  ${diagnostics.missingVars.length} env vars not interpolated:`);
    console.log(`         ${diagnostics.missingVars.join(', ')}`);
    warnings += diagnostics.missingVars.length;
  }

  // 3. 驗證 API keys
  console.log('\nCheck 3: API Keys validation');
  const validation = config.validateApiKeys(false);

  if (validation.placeholders && validation.placeholders.length > 0) {
    console.log(`  FAIL  ${validation.placeholders.length} unreplaced placeholder(s):`);
    for (const p of validation.placeholders) {
      console.log(`         - ${p.key}: ${p.placeholder}`);
    }
    errors += validation.placeholders.length;
  }

  if (validation.missing.length > 0) {
    console.log(`  WARN  ${validation.missing.length} missing API key(s):`);
    console.log(`         ${validation.missing.join(', ')}`);
    warnings += validation.missing.length;
  }

  if (validation.valid) {
    console.log('  OK  All API keys configured correctly');
  }
} catch (error) {
  console.log(`  FAIL  Config loading failed: ${error.message}`);
  errors++;
}

// 總結
console.log('\n' + '='.repeat(60));
console.log(`Errors: ${errors}, Warnings: ${warnings}`);

if (errors === 0 && warnings === 0) {
  console.log('\nAll checks passed. Ready to deploy!');
  process.exit(0);
} else if (errors === 0) {
  console.log(`\n${warnings} warning(s). Some features may be degraded.`);
  process.exit(strict ? 1 : 0);
} else {
  console.log(`\n${errors} error(s). System will not function correctly.`);
  console.log('\nSuggested fixes:');
  console.log('1. Check .env file exists and is loaded');
  console.log('2. Verify env vars are set');
  console.log('3. Verify config-loader.js regex uses /\\${ not /${');
  process.exit(1);
}
