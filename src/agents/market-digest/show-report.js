// 顯示最新生成的報告（使用 Institutional Renderer）
const fs = require('fs');
const path = require('path');
const { renderReport } = require('./institutional-renderer');

// 讀取 latest.json
const runtimeInputPath = path.join(__dirname, 'data/runtime/latest.json');
const runtimeInput = JSON.parse(fs.readFileSync(runtimeInputPath, 'utf8'));

// 使用 Institutional Renderer
const report = renderReport(runtimeInput);

// 寫入檔案而非直接輸出（減少 cache）
const outputDir = path.join(__dirname, 'data/output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const outputPath = path.join(outputDir, 'latest-report.md');
fs.writeFileSync(outputPath, report, 'utf8');

// 顯示摘要資訊
const stats = {
  size: (report.length / 1024).toFixed(1),
  lines: report.split('\n').length,
  date: runtimeInput.date || 'N/A'
};

console.log(`✅ 報告已生成
📄 路徑：${outputPath}
📊 大小：${stats.size} KB
📝 行數：${stats.lines}
📅 日期：${stats.date}`);
