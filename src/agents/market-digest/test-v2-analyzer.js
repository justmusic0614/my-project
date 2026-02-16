#!/usr/bin/env node
// V2 Analyzer Test Script

const { analyzeRiskOff } = require("./analyzers/risk-off-analyzer");

console.log("Testing V2 Risk-off Analyzer\n");
console.log("=====================================\n");

// Test Case 1: HIGH Risk-off (should be >= 65 now, was >= 75 in V1)
console.log("Test 1: HIGH Risk-off Scenario");
const highRiskData = {
  vix: 28.5,
  gold: { change: 2.1 },
  foreign: { netBuy: -12000 },
  stockIndex: { change: -2.5 },
  usd_jpy: { change: -1.2 }
};
const highRiskNews = [
  { title: "市場恐慌情緒升溫" },
  { title: "外資大舉賣超" }
];

const result1 = analyzeRiskOff(highRiskData, highRiskNews);
console.log("  Score:", result1.score);
console.log("  Level:", result1.level, result1.signal);
console.log("  Expected: HIGH (score >= 65)");
console.log("  PASS:", result1.level === "HIGH" && result1.score >= 65 ? "YES" : "NO");
console.log("");

// Test Case 2: Trend Acceleration (previousData support)
console.log("Test 2: Trend Acceleration Feature");
const currentData = {
  vix: 22.5,
  gold: { change: 1.0 },
  foreign: { netBuy: -8000 },
  stockIndex: { change: -1.8 }
};
const previousData = {
  vix: 20.0,
  foreign: { netBuy: -5000 }
};

const result2a = analyzeRiskOff(currentData, [], null);
const result2b = analyzeRiskOff(currentData, [], previousData);

console.log("  Without previousData:", result2a.score);
console.log("  With previousData:", result2b.score);
console.log("  Acceleration bonus:", result2b.score - result2a.score);
console.log("  Expected: >0 (foreign acceleration -5000 -> -8000)");
console.log("  PASS:", result2b.score > result2a.score ? "YES" : "NO");
console.log("");

// Test Case 3: Threshold Change (score 69 should be MEDIUM now, not HIGH)
console.log("Test 3: Threshold Adjustment Verification");
const mediumData = {
  vix: 22.5,
  gold: { change: 1.5 },
  foreign: { netBuy: -8000 },
  stockIndex: { change: -2.2 }
};

const result3 = analyzeRiskOff(mediumData, []);
console.log("  Score:", result3.score);
console.log("  Level:", result3.level, result3.signal);
console.log("  Expected:");
console.log("    - If score < 65: MEDIUM or below");
console.log("    - If score >= 65: HIGH");
console.log("  PASS:", (result3.score >= 65 && result3.level === "HIGH") || (result3.score < 65 && result3.level !== "HIGH") ? "YES" : "NO");
console.log("");

console.log("=====================================");
console.log("V2 Features Validation Complete");
console.log("");
console.log("Summary:");
console.log("  Threshold: HIGH >= 65 (V1 was >= 75)");
console.log("  Weights: Foreign Flow 25% (V1 was 20%)");
console.log("  New: Trend acceleration factors");
