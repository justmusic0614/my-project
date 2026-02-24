#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const DATA_DIR = path.join(__dirname, '../data');
const SUGGESTIONS_FILE = path.join(DATA_DIR, 'suggestions.jsonl');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// 确保目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 读取配置
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

// 执行命令
function exec(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', ...options }).trim();
  } catch (e) {
    return null;
  }
}

// 生成建议 ID
function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

// 时间戳
function timestamp() {
  return new Date().toISOString();
}

// 读取状态
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
  return {
    last_scan: null,
    last_llm_analysis: null,
    known_suggestions: []
  };
}

// 保存状态
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// 保存建议
function saveSuggestion(suggestion) {
  fs.appendFileSync(SUGGESTIONS_FILE, JSON.stringify(suggestion) + '\n');
}

// 规则引擎检查
class RuleEngine {
  constructor() {
    this.rules = [];
  }
  
  // 日志大小检查
  checkLogSizes() {
    const suggestions = [];
    const logDirs = [
      '/home/clawbot/clawd/logs',
      '/home/clawbot/security-patrol/logs',
      '/home/clawbot/clawd/agents/*/logs'
    ];
    
    logDirs.forEach(pattern => {
      const files = exec(`find ${pattern} -type f -name "*.log" 2>/dev/null`) || '';
      files.split('\n').filter(f => f).forEach(file => {
        const sizeMB = parseInt(exec(`du -m "${file}" | cut -f1`)) || 0;
        
        if (sizeMB > config.rules.log_size_mb) {
          suggestions.push({
            id: generateId(),
            timestamp: timestamp(),
            category: 'performance',
            priority: sizeMB > 500 ? 'high' : 'medium',
            title: `日志文件过大：${path.basename(file)}`,
            description: `日志文件大小：${sizeMB}MB，超过阈值 ${config.rules.log_size_mb}MB`,
            suggestion: '建议启用日志轮转（logrotate）或手动归档',
            impact: '可能影响磁盘空间',
            effort: 'small',
            source: 'rule-engine',
            related_files: [file]
          });
        }
      });
    });
    
    return suggestions;
  }
  
  // Cron 任务冲突检查
  checkCronConflicts() {
    const suggestions = [];
    const crontab = exec('crontab -l') || '';
    const lines = crontab.split('\n').filter(l => l && !l.startsWith('#'));
    
    // 解析时间
    const tasks = lines.map(line => {
      const parts = line.split(/\s+/);
      return {
        minute: parts[0],
        hour: parts[1],
        command: parts.slice(5).join(' ')
      };
    });
    
    // 检查同一时间多个任务
    const timeSlots = {};
    tasks.forEach(task => {
      if (task.minute !== '*' && task.hour !== '*') {
        const key = `${task.hour}:${task.minute}`;
        if (!timeSlots[key]) timeSlots[key] = [];
        timeSlots[key].push(task.command);
      }
    });
    
    Object.entries(timeSlots).forEach(([time, commands]) => {
      if (commands.length > 2) {
        suggestions.push({
          id: generateId(),
          timestamp: timestamp(),
          category: 'performance',
          priority: 'low',
          title: `${commands.length}个cron任务同时执行`,
          description: `时间 ${time} 有多个任务，可能造成资源竞争`,
          suggestion: `建议错开执行时间，例如间隔5-10分钟`,
          impact: '可能导致瞬时资源占用过高',
          effort: 'small',
          source: 'rule-engine'
        });
      }
    });
    
    return suggestions;
  }
  
  // 错误日志分析
  checkErrorLogs() {
    const suggestions = [];
    const logFiles = [
      '/home/clawbot/clawd/logs/*.log',
      '/home/clawbot/security-patrol/logs/*.log'
    ];
    
    logFiles.forEach(pattern => {
      const files = exec(`ls ${pattern} 2>/dev/null`) || '';
      files.split('\n').filter(f => f).forEach(file => {
        const errors = exec(`grep -i "error\\|fail\\|exception" "${file}" | tail -100`) || '';
        const errorCount = errors.split('\n').filter(l => l).length;
        
        if (errorCount > config.rules.error_threshold_per_hour) {
          // 找出最常见的错误
          const errorLines = errors.split('\n').filter(l => l);
          const errorPatterns = {};
          
          errorLines.forEach(line => {
            const match = line.match(/error:?\s*(.{20,80})/i);
            if (match) {
              const msg = match[1].trim();
              errorPatterns[msg] = (errorPatterns[msg] || 0) + 1;
            }
          });
          
          const topError = Object.entries(errorPatterns)
            .sort((a, b) => b[1] - a[1])[0];
          
          if (topError) {
            suggestions.push({
              id: generateId(),
              timestamp: timestamp(),
              category: 'code-quality',
              priority: errorCount > 50 ? 'high' : 'medium',
              title: `${path.basename(file)} 发现重复错误`,
              description: `最近100行中有${errorCount}个错误，最常见：${topError[0]}（${topError[1]}次）`,
              suggestion: '检查并修复错误源，加入错误处理',
              impact: '可能影响服务稳定性',
              effort: 'medium',
              source: 'rule-engine',
              related_files: [file]
            });
          }
        }
      });
    });
    
    return suggestions;
  }
  
  // 磁盘使用趋势
  checkDiskTrend() {
    const suggestions = [];
    const currentUsage = parseInt(exec("df -h / | tail -1 | awk '{print $5}'").replace('%', ''));
    
    // 读取历史数据
    const stateFile = path.join(DATA_DIR, 'disk-history.json');
    let history = [];
    if (fs.existsSync(stateFile)) {
      history = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }
    
    // 记录当前数据
    history.push({ timestamp: timestamp(), usage: currentUsage });
    history = history.slice(-24); // 保留最近24次（48小时）
    fs.writeFileSync(stateFile, JSON.stringify(history, null, 2));
    
    // 分析趋势
    if (history.length >= 12) { // 至少24小时数据
      const oldUsage = history[0].usage;
      const growth = currentUsage - oldUsage;
      
      if (growth > config.rules.disk_growth_percent_daily) {
        suggestions.push({
          id: generateId(),
          timestamp: timestamp(),
          category: 'performance',
          priority: growth > 20 ? 'high' : 'medium',
          title: `磁盘使用持续增长`,
          description: `过去${Math.floor(history.length * 2)}小时增长${growth}%（${oldUsage}% → ${currentUsage}%）`,
          suggestion: '检查日志/备份目录，考虑清理或归档',
          impact: '可能导致磁盘空间不足',
          effort: 'small',
          source: 'rule-engine'
        });
      }
    }
    
    return suggestions;
  }
  
  // 备份策略检查
  checkBackups() {
    const suggestions = [];
    const backupDir = '/home/clawbot/clawd/agents/deploy-monitor/backups';
    
    if (fs.existsSync(backupDir)) {
      const backups = fs.readdirSync(backupDir);
      
      if (backups.length === 0) {
        suggestions.push({
          id: generateId(),
          timestamp: timestamp(),
          category: 'best-practice',
          priority: 'low',
          title: '尚未建立任何备份',
          description: 'deploy-monitor 备份目录为空',
          suggestion: '执行一次部署以建立初始备份',
          impact: '无法快速回滚',
          effort: 'small',
          source: 'rule-engine'
        });
      }
    }
    
    return suggestions;
  }
  
  // 执行所有规则
  runAll() {
    console.log('🔍 执行规则引擎扫描...');
    
    const allSuggestions = [
      ...this.checkLogSizes(),
      ...this.checkCronConflicts(),
      ...this.checkErrorLogs(),
      ...this.checkDiskTrend(),
      ...this.checkBackups()
    ];
    
    console.log(`✅ 规则引擎完成，找到 ${allSuggestions.length} 个建议`);
    return allSuggestions;
  }
}

// 过滤新建议
function filterNewSuggestions(suggestions) {
  const state = loadState();
  const newSuggestions = [];
  
  suggestions.forEach(suggestion => {
    // 检查是否已存在相似建议
    const isDuplicate = state.known_suggestions.some(known => {
      return known.title === suggestion.title &&
             Date.now() - new Date(known.timestamp).getTime() < 24 * 60 * 60 * 1000; // 24小时内
    });
    
    if (!isDuplicate) {
      newSuggestions.push(suggestion);
      state.known_suggestions.push({
        title: suggestion.title,
        timestamp: new Date().toISOString()  // 記錄時間，而非建議生成時間
      });
    }
  });
  
  // 清理旧记录（7天前）
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  state.known_suggestions = state.known_suggestions.filter(s => 
    new Date(s.timestamp).getTime() > sevenDaysAgo
  );
  
  saveState(state);
  return newSuggestions;
}

// 扫描命令
function scan(options = {}) {
  const state = loadState();
  state.last_scan = timestamp();
  
  // 加载功能扩展引擎
  const FeatureExpansionEngine = require('./feature-expansion-rules');
  
  const ruleEngine = new RuleEngine();
  const featureEngine = new FeatureExpansionEngine();
  
  const technicalSuggestions = ruleEngine.runAll();
  const featureSuggestions = featureEngine.runAll();
  
  const allSuggestions = [...technicalSuggestions, ...featureSuggestions];
  
  // 过滤新建议
  const newSuggestions = filterNewSuggestions(allSuggestions);
  
  // 保存所有建议
  newSuggestions.forEach(suggestion => {
    saveSuggestion(suggestion);
  });
  
  // GitHub Issues 集成
  let githubIssues = [];
  if (config.github?.auto_create && newSuggestions.length > 0) {
    const GitHubIntegration = require('./github-integration');
    const github = new GitHubIntegration(config);
    githubIssues = github.createIssuesForSuggestions(newSuggestions);
  }
  
  saveState(state);
  
  // 统计类别
  const byCategory = {
    'feature-expansion': newSuggestions.filter(s => s.category === 'feature-expansion').length,
    'best-practice': newSuggestions.filter(s => s.category === 'best-practice').length,
    'technical-optimization': newSuggestions.filter(s => ['performance', 'code-quality', 'security'].includes(s.category)).length
  };
  
  console.log(`\n📊 扫描结果：`);
  console.log(`  总建议：${allSuggestions.length}`);
  console.log(`  新建议：${newSuggestions.length}`);
  console.log(`  功能扩展：${byCategory['feature-expansion']}`);
  console.log(`  最佳实践：${byCategory['best-practice']}`);
  console.log(`  技术优化：${byCategory['technical-optimization']}`);
  if (githubIssues.length > 0) {
    console.log(`  GitHub Issues：${githubIssues.length}`);
  }
  
  return {
    total: allSuggestions.length,
    new: newSuggestions.length,
    suggestions: newSuggestions,
    by_category: byCategory,
    github_issues: githubIssues
  };
}

// 生成报告
function generateReport(suggestions) {
  if (suggestions.length === 0) {
    return '✅ 系统运行良好，暂无优化建议';
  }
  
  const lines = [`💡 优化建议 (${suggestions.length}条)\n`];
  
  // 按类别分类
  const byCategory = {
    'feature-expansion': suggestions.filter(s => s.category === 'feature-expansion'),
    'best-practice': suggestions.filter(s => s.category === 'best-practice'),
    'technical': suggestions.filter(s => ['performance', 'code-quality', 'security'].includes(s.category))
  };
  
  // 功能扩展（50%权重，优先显示）
  if (byCategory['feature-expansion'].length > 0) {
    lines.push('🚀 功能扩展建议\n');
    byCategory['feature-expansion'].forEach((s, i) => {
      const icon = s.priority === 'high' ? '🔴' : s.priority === 'medium' ? '🟡' : '🟢';
      lines.push(`${i + 1}. ${icon} ${s.title}`);
      lines.push(`   建议：${s.suggestion}`);
      if (s.implementation_hint) {
        lines.push(`   实现提示：${s.implementation_hint}`);
      }
      lines.push('');
    });
  }
  
  // 最佳实践（30%权重）
  if (byCategory['best-practice'].length > 0) {
    lines.push('📋 最佳实践建议\n');
    byCategory['best-practice'].forEach((s, i) => {
      const icon = s.priority === 'high' ? '🔴' : s.priority === 'medium' ? '🟡' : '🟢';
      lines.push(`${i + 1}. ${icon} ${s.title}`);
      lines.push(`   建议：${s.suggestion}\n`);
    });
  }
  
  // 技术优化（20%权重）
  if (byCategory['technical'].length > 0) {
    lines.push('🔧 技术优化建议\n');
    byCategory['technical'].forEach((s, i) => {
      const icon = s.priority === 'high' ? '🔴' : s.priority === 'medium' ? '🟡' : '🟢';
      lines.push(`${i + 1}. ${icon} ${s.title}`);
      lines.push(`   建议：${s.suggestion}\n`);
    });
  }
  
  return lines.join('\n');
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0] || 'scan';
  
  switch (command) {
    case 'scan':
      const result = scan();
      if (result.new > 0) {
        // 写入文件而非直接输出（减少 cache）
        const outputDir = path.join(__dirname, '../data');
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const outputPath = path.join(outputDir, 'latest-scan.md');
        const report = generateReport(result.suggestions);
        fs.writeFileSync(outputPath, report, 'utf8');
        
        console.log(`✅ 扫描完成 | 新建议 ${result.new} 条
📄 完整报告：${outputPath}
📊 大小：${(report.length / 1024).toFixed(1)} KB`);
      } else {
        console.log('✅ 扫描完成 | 系统运行良好，暂无新建议');
      }
      break;
      
    default:
      console.log(`
Optimization Advisor

用法：
  node advisor.js scan    # 执行扫描
      `);
  }
}

module.exports = { scan, generateReport };
