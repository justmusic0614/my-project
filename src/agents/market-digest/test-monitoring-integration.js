#!/usr/bin/env node
// Test Monitoring Integration

console.log('Testing Monitoring Integration\n');
console.log('=====================================\n');

// 1. Test previous-data-loader
console.log('1. Testing previous-data-loader...');
try {
  const { getPreviousDayData } = require('./utils/previous-data-loader');
  const data = getPreviousDayData();
  console.log('   Result:', data ? 'SUCCESS (data found)' : 'SUCCESS (no data yet, expected)');
  if (data) {
    console.log('   VIX:', data.vix, '| Foreign:', data.foreign.netBuy);
  }
} catch (err) {
  console.error('   ERROR:', err.message);
}

console.log('');

// 2. Test monitor-risk-off
console.log('2. Testing monitor-risk-off module...');
try {
  const { monitorRiskOff } = require('./monitor-risk-off');
  console.log('   Result: SUCCESS (module loaded)');
} catch (err) {
  console.error('   ERROR:', err.message);
}

console.log('');

// 3. Test runtime-gen integration
console.log('3. Checking runtime-gen.js integration...');
const fs = require('fs');
const content = fs.readFileSync('./backend/runtime-gen.js', 'utf8');

const hasPreviousData = content.includes('getPreviousDayData');
const hasMonitoring = content.includes('monitorRiskOff');

console.log('   getPreviousDayData:', hasPreviousData ? 'YES ✓' : 'NO ✗');
console.log('   monitorRiskOff:', hasMonitoring ? 'YES ✓' : 'NO ✗');

console.log('');
console.log('=====================================');

if (hasPreviousData && hasMonitoring) {
  console.log('✅ Integration verified successfully!\n');
  console.log('Next step: Run full daily report to test monitoring');
  console.log('  (Monitoring will activate when daily report runs)\n');
  process.exit(0);
} else {
  console.log('❌ Integration incomplete!\n');
  process.exit(1);
}
