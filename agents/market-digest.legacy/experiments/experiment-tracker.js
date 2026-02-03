// Experiment Tracker
// 實驗追蹤與版本控制系統

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Experiment {
  constructor(id, directory) {
    this.id = id;
    this.directory = directory;
    this.startTime = Date.now();
    this.metrics = {};
    this.logs = [];
  }

  /**
   * 記錄指標
   */
  recordMetric(name, value) {
    this.metrics[name] = value;
    this.log(`Metric: ${name} = ${value}`);
  }

  /**
   * 記錄日誌
   */
  log(message) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${message}`;
    this.logs.push(entry);
    console.log(entry);
  }

  /**
   * 儲存結果
   */
  async save(output) {
    const duration = Date.now() - this.startTime;
    
    const result = {
      id: this.id,
      startTime: new Date(this.startTime).toISOString(),
      endTime: new Date().toISOString(),
      duration,
      metrics: this.metrics,
      output
    };
    
    // 儲存結果
    const resultPath = path.join(this.directory, 'output.json');
    await fs.promises.writeFile(resultPath, JSON.stringify(result, null, 2), 'utf8');
    
    // 儲存指標
    const metricsPath = path.join(this.directory, 'metrics.json');
    await fs.promises.writeFile(metricsPath, JSON.stringify(this.metrics, null, 2), 'utf8');
    
    // 儲存日誌
    const logsPath = path.join(this.directory, 'logs.txt');
    await fs.promises.writeFile(logsPath, this.logs.join('\n'), 'utf8');
    
    this.log(`Experiment saved to ${this.directory}`);
    
    return result;
  }
}

class ExperimentTracker {
  constructor(basePath = null) {
    this.basePath = basePath || path.join(__dirname);
    this.ensureDirectories();
  }

  /**
   * 確保目錄存在
   */
  ensureDirectories() {
    const dirs = ['config', 'runs', 'results'];
    for (const dir of dirs) {
      const fullPath = path.join(this.basePath, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }
  }

  /**
   * 開始新實驗
   */
  async startExperiment(name, config, description = '') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const hash = crypto.createHash('md5').update(JSON.stringify(config)).digest('hex').substr(0, 8);
    const expId = `${timestamp}-${name}-${hash}`;
    const expDir = path.join(this.basePath, 'runs', expId);
    
    await fs.promises.mkdir(expDir, { recursive: true });
    
    // 儲存設定
    const configWithMeta = {
      experiment: {
        id: expId,
        name,
        description,
        timestamp: new Date().toISOString()
      },
      config
    };
    
    await fs.promises.writeFile(
      path.join(expDir, 'config.json'),
      JSON.stringify(configWithMeta, null, 2),
      'utf8'
    );
    
    console.log(`🧪 實驗開始: ${expId}`);
    
    return new Experiment(expId, expDir);
  }

  /**
   * 載入實驗
   */
  async loadExperiment(expId) {
    const expDir = path.join(this.basePath, 'runs', expId);
    
    if (!fs.existsSync(expDir)) {
      throw new Error(`Experiment ${expId} not found`);
    }
    
    const configPath = path.join(expDir, 'config.json');
    const metricsPath = path.join(expDir, 'metrics.json');
    const outputPath = path.join(expDir, 'output.json');
    
    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf8'));
    
    const result = {
      id: expId,
      config
    };
    
    if (fs.existsSync(metricsPath)) {
      result.metrics = JSON.parse(await fs.promises.readFile(metricsPath, 'utf8'));
    }
    
    if (fs.existsSync(outputPath)) {
      result.output = JSON.parse(await fs.promises.readFile(outputPath, 'utf8'));
    }
    
    return result;
  }

  /**
   * 列出所有實驗
   */
  async listExperiments(limit = 20) {
    const runsDir = path.join(this.basePath, 'runs');
    
    if (!fs.existsSync(runsDir)) {
      return [];
    }
    
    const dirs = await fs.promises.readdir(runsDir);
    const experiments = [];
    
    for (const dir of dirs.slice(-limit)) {
      try {
        const exp = await this.loadExperiment(dir);
        experiments.push({
          id: exp.id,
          name: exp.config.experiment.name,
          timestamp: exp.config.experiment.timestamp,
          metrics: exp.metrics || {}
        });
      } catch (err) {
        console.error(`載入實驗 ${dir} 失敗:`, err.message);
      }
    }
    
    return experiments.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );
  }

  /**
   * 比較兩個實驗
   */
  async compareExperiments(expId1, expId2) {
    const exp1 = await this.loadExperiment(expId1);
    const exp2 = await this.loadExperiment(expId2);
    
    const comparison = {
      experiments: {
        baseline: expId1,
        experiment: expId2
      },
      configs: {
        baseline: exp1.config.config,
        experiment: exp2.config.config,
        diff: this.diffObjects(exp1.config.config, exp2.config.config)
      },
      metrics: {}
    };
    
    // 比較指標
    const allMetricKeys = new Set([
      ...Object.keys(exp1.metrics || {}),
      ...Object.keys(exp2.metrics || {})
    ]);
    
    for (const key of allMetricKeys) {
      const val1 = exp1.metrics?.[key];
      const val2 = exp2.metrics?.[key];
      
      if (typeof val1 === 'number' && typeof val2 === 'number') {
        const delta = val2 - val1;
        const improvement = val1 !== 0 ? ((delta / val1) * 100).toFixed(2) + '%' : 'N/A';
        
        comparison.metrics[key] = {
          baseline: val1,
          experiment: val2,
          delta,
          improvement
        };
      } else {
        comparison.metrics[key] = {
          baseline: val1,
          experiment: val2,
          changed: val1 !== val2
        };
      }
    }
    
    return comparison;
  }

  /**
   * 比較物件差異
   */
  diffObjects(obj1, obj2, path = '') {
    const diff = [];
    
    const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);
    
    for (const key of allKeys) {
      const currentPath = path ? `${path}.${key}` : key;
      
      if (!(key in obj2)) {
        diff.push({ path: currentPath, change: 'removed', from: obj1[key] });
      } else if (!(key in obj1)) {
        diff.push({ path: currentPath, change: 'added', to: obj2[key] });
      } else if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object') {
        diff.push(...this.diffObjects(obj1[key], obj2[key], currentPath));
      } else if (obj1[key] !== obj2[key]) {
        diff.push({ path: currentPath, change: 'modified', from: obj1[key], to: obj2[key] });
      }
    }
    
    return diff;
  }

  /**
   * 儲存基線設定
   */
  async saveBaseline(config, name = 'baseline') {
    const configPath = path.join(this.basePath, 'config', `${name}.json`);
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log(`✅ 基線設定已儲存: ${configPath}`);
  }

  /**
   * 載入基線設定
   */
  async loadBaseline(name = 'baseline') {
    const configPath = path.join(this.basePath, 'config', `${name}.json`);
    
    if (!fs.existsSync(configPath)) {
      throw new Error(`Baseline ${name} not found`);
    }
    
    return JSON.parse(await fs.promises.readFile(configPath, 'utf8'));
  }

  /**
   * 取得統計
   */
  async getStats() {
    const experiments = await this.listExperiments(1000);
    
    const stats = {
      total: experiments.length,
      byName: {},
      recentActivity: experiments.slice(0, 10).map(e => ({
        id: e.id,
        name: e.name,
        timestamp: e.timestamp
      }))
    };
    
    for (const exp of experiments) {
      stats.byName[exp.name] = (stats.byName[exp.name] || 0) + 1;
    }
    
    return stats;
  }
}

module.exports = {
  ExperimentTracker,
  Experiment
};
