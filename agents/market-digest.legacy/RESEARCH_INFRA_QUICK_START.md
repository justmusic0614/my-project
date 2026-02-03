# Research Infra - 快速開始

## 🚀 立即使用

### 1. 查詢歷史報告

```bash
cd ~/clawd/agents/market-digest

# 查詢今天的報告
node -e "
const TimeSeriesStorage = require('./backend/timeseries-storage');
(async () => {
  const ts = new TimeSeriesStorage();
  const today = new Date().toISOString().split('T')[0];
  const report = await ts.loadReport(today, 'txt');
  console.log(report);
})();
"

# 查詢台股數據
node -e "
const TimeSeriesStorage = require('./backend/timeseries-storage');
(async () => {
  const ts = new TimeSeriesStorage();
  const today = new Date().toISOString().split('T')[0];
  const data = await ts.loadMarketData(today, 'TWII');
  console.log(JSON.stringify(data, null, 2));
})();
"
```

### 2. 開始實驗

```bash
# 儲存目前設定為基線
node -e "
const { ExperimentTracker } = require('./experiments/experiment-tracker');
const config = require('./config.json');
(async () => {
  const tracker = new ExperimentTracker();
  await tracker.saveBaseline(config, 'baseline-v1');
  console.log('✅ 基線已儲存');
})();
"

# 列出所有實驗
node -e "
const { ExperimentTracker } = require('./experiments/experiment-tracker');
(async () => {
  const tracker = new ExperimentTracker();
  const experiments = await tracker.listExperiments(10);
  console.log(JSON.stringify(experiments, null, 2));
})();
"
```

### 3. 管理 Plugins

```bash
# 列出所有 plugins
node -e "
const PluginManager = require('./backend/sources/plugin-manager');
const pm = new PluginManager();
const plugins = pm.listPlugins();
console.log(plugins);
"

# 停用某個 plugin
node -e "
const PluginManager = require('./backend/sources/plugin-manager');
const pm = new PluginManager();
pm.disablePlugin('bloomberg');
console.log('✅ bloomberg plugin 已停用');
"
```

---

## 📊 常用查詢

### 計算統計指標

```javascript
const TimeSeriesStorage = require('./backend/timeseries-storage');

(async () => {
  const ts = new TimeSeriesStorage();
  
  // 計算過去 30 天的統計
  const stats = await ts.calculateStats(
    'TWII',
    '2026-01-01',
    '2026-02-02'
  );
  
  console.log('台股 30 天統計:');
  console.log('  平均:', stats.mean);
  console.log('  標準差:', stats.stdDev);
  console.log('  最大值:', stats.max);
  console.log('  最小值:', stats.min);
  console.log('  最新:', stats.latest);
})();
```

### 查詢日期範圍

```javascript
const TimeSeriesStorage = require('./backend/timeseries-storage');

(async () => {
  const ts = new TimeSeriesStorage();
  
  // 查詢 2 月所有報告
  const reports = await ts.queryDateRange(
    'reports',
    '2026-02-01',
    '2026-02-28'
  );
  
  console.log(`找到 ${reports.length} 份報告`);
  
  reports.forEach(r => {
    console.log(`- ${r.date}: ${r.data.report.length} 字元`);
  });
})();
```

---

## 🧪 實驗範例

### 完整實驗流程

```javascript
const { ExperimentTracker } = require('./experiments/experiment-tracker');
const RuntimeInputGenerator = require('./backend/runtime-gen');
const config = require('./config.json');

(async () => {
  const tracker = new ExperimentTracker();
  
  // 1. 開始實驗
  const exp = await tracker.startExperiment(
    'new-filter-threshold',
    { filter_threshold: 0.9 },
    '測試提高過濾門檻的效果'
  );
  
  // 2. 執行實驗
  const generator = new RuntimeInputGenerator(config);
  const startTime = Date.now();
  const output = await generator.generate();
  const duration = Date.now() - startTime;
  
  // 3. 記錄指標
  exp.recordMetric('duration_ms', duration);
  exp.recordMetric('news_count', output.raw_news?.length || 0);
  exp.recordMetric('primary_signals', output.primary_signals?.length || 0);
  
  // 4. 儲存結果
  await exp.save({
    runtimeInput: output,
    timestamp: new Date().toISOString()
  });
  
  console.log('✅ 實驗完成:', exp.id);
})();
```

---

## 🔧 維護指令

```bash
# 檢查系統狀態
node test-upgrades.js

# 檢查時間序列資料量
du -sh data/timeseries/

# 檢查實驗數量
ls experiments/runs/ | wc -l

# 清理舊實驗（保留最近 50 個）
cd experiments/runs && ls -t | tail -n +51 | xargs rm -rf
```

---

## 📚 完整文件

詳見 `UPGRADE_REPORT.md`
