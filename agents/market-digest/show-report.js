// 顯示最新生成的報告（使用 Institutional Renderer）
const fs = require('fs');
const path = require('path');
const { renderReport } = require('./institutional-renderer');

// 讀取 latest.json
const runtimeInputPath = path.join(__dirname, 'data/runtime/latest.json');
const runtimeInput = JSON.parse(fs.readFileSync(runtimeInputPath, 'utf8'));

// 使用 Institutional Renderer
const report = renderReport(runtimeInput);
console.log(report);
