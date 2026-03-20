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

// ── Phase 4: Rule-Based SRE 掃描（v2）──────────────────────────────────────
// 5 條新規則 + 去重 + resolved/reopened 狀態 + --push 旗標

const { execSync: _execSync } = require('child_process');

function _repoRoot() {
  try { return _execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim(); }
  catch { return path.join(__dirname, '../../../..'); }
}

const _REPO_ROOT = _repoRoot();
const _ADVISOR_STATE_FILE = path.join(_REPO_ROOT, 'data/runtime/advisor-state.json');
const _METRICS_DIR = path.join(_REPO_ROOT, 'data/pipeline-state');

function _loadAdvisorState() {
  try {
    if (fs.existsSync(_ADVISOR_STATE_FILE)) return JSON.parse(fs.readFileSync(_ADVISOR_STATE_FILE, 'utf8'));
  } catch {
    // 損壞 → backup + 重建
    try { fs.renameSync(_ADVISOR_STATE_FILE, _ADVISOR_STATE_FILE + `.corrupt.${Date.now()}`); } catch {}
  }
  return { dedup: {} };
}

function _saveAdvisorState(state) {
  try {
    const dir = path.dirname(_ADVISOR_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = _ADVISOR_STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, _ADVISOR_STATE_FILE);
  } catch {}
}

function _isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${String(Math.ceil((((d - yearStart) / 86400000) + 1) / 7)).padStart(2, '0')}`;
}

// ── 5 條掃描規則 ──────────────────────────────────────────────────────────────

function _ruleCheckCronFailRate() {
  // 讀最近 7 天 briefing-delivery.jsonl，計算失敗率
  const logPath = path.join(_REPO_ROOT, 'logs/briefing-delivery.jsonl');
  if (!fs.existsSync(logPath)) return null;
  try {
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const recent = lines.map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(e => e && new Date(e.ts).getTime() > sevenDaysAgo);
    if (recent.length === 0) return null;
    const failRate = recent.filter(e => e.status !== 'success').length / recent.length;
    if (failRate > 0.1) {
      return {
        rule_id: 'cron_fail_rate',
        entity: 'morning-briefing',
        priority: 'HIGH',
        problem: `Morning Briefing 近 7 日失敗率 ${(failRate * 100).toFixed(0)}%（共 ${recent.length} 次）`,
        impact: '用戶可能錯過每日站立報告',
        possible_cause: 'LLM API 異常或 collector 讀不到來源檔案',
        action: '檢查 logs/briefing-delivery.jsonl 和 logs/morning-briefing.log',
      };
    }
  } catch {}
  return null;
}

function _ruleCheckPipelineDuration() {
  // 讀最近 3 天 metrics-*.json，檢查 phase4 耗時是否連續上升
  try {
    if (!fs.existsSync(_METRICS_DIR)) return null;
    const files = fs.readdirSync(_METRICS_DIR)
      .filter(f => f.startsWith('metrics-') && f.endsWith('.json'))
      .sort().slice(-3);
    if (files.length < 3) return null;
    const durations = files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(_METRICS_DIR, f), 'utf8')).totalDuration || 0; }
      catch { return 0; }
    });
    if (durations[0] > 0 && durations[1] > durations[0] && durations[2] > durations[1]) {
      return {
        rule_id: 'pipeline_duration_trend',
        entity: 'market-digest',
        priority: 'MEDIUM',
        problem: `Pipeline 耗時連續 3 天上升：${durations.map(d => Math.round(d/1000) + 's').join(' → ')}`,
        impact: 'Pipeline 可能逼近 timeout 門檻，導致失敗',
        possible_cause: '外部 API 變慢或資料量增加',
        action: '查看 data/pipeline-state/metrics-*.json，確認各 phase 耗時分布',
      };
    }
  } catch {}
  return null;
}

function _ruleCheckKnowledgeBacklog() {
  const indexPath = path.join(_REPO_ROOT, 'data/index.json');
  if (!fs.existsSync(indexPath)) return null;
  try {
    const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const pending = idx.pending || 0;
    if (pending > 20) {
      return {
        rule_id: 'knowledge_backlog',
        entity: 'knowledge-digest',
        priority: 'LOW',
        problem: `知識庫積壓 ${pending} 筆待處理`,
        impact: '新知識無法被 RAG 查詢到',
        possible_cause: 'ingest pipeline 未執行或 inbox 累積過多',
        action: '執行 kd-local / brain-ingest 清空積壓',
      };
    }
  } catch {}
  return null;
}

function _ruleCheckMemoryRecovery() {
  // 讀本週 alert-state.json，統計 recovery 次數
  const alertPath = path.join(_REPO_ROOT, 'data/runtime/alert-state.json');
  if (!fs.existsSync(alertPath)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(alertPath, 'utf8'));
    const weekStart = Date.now() - 7 * 24 * 3600 * 1000;
    const recoveries = Object.values(state).filter(e =>
      e.status === 'resolved' && e.resolvedAt && e.resolvedAt > weekStart
    ).length;
    if (recoveries > 2) {
      return {
        rule_id: 'memory_recovery_freq',
        entity: 'alert-system',
        priority: 'MEDIUM',
        problem: `本週已有 ${recoveries} 次告警 resolved（recovery 頻率偏高）`,
        impact: '系統不穩定，重複出問題',
        possible_cause: '某個 pipeline 或服務持續間歇性失敗',
        action: '查看 data/runtime/alert-state.json，找出重複觸發的 key',
      };
    }
  } catch {}
  return null;
}

function _ruleCheckRAM() {
  try {
    const memInfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const match = memInfo.match(/MemAvailable:\s+(\d+)/);
    if (!match) return null;
    const availMB = parseInt(match[1]) / 1024;
    if (availMB < 300) {
      return {
        rule_id: 'ram_threshold',
        entity: 'global',
        priority: 'HIGH',
        problem: `可用 RAM 僅剩 ${Math.round(availMB)}MB（門檻 300MB）`,
        impact: 'Pipeline 或 OpenClaw 可能 OOM 崩潰',
        possible_cause: 'memory leak 或背景進程佔用過多',
        action: '執行 `ps aux --sort=-%mem | head -10` 找出佔用最多記憶體的進程',
      };
    }
  } catch {}
  return null;
}

// ── 主掃描函數（v2）──────────────────────────────────────────────────────────

function scanV2(options = {}) {
  const push = options.push || false;
  const week = _isoWeek();
  const state = _loadAdvisorState();
  if (!state.dedup) state.dedup = {};

  const rawFindings = [
    _ruleCheckCronFailRate(),
    _ruleCheckPipelineDuration(),
    _ruleCheckKnowledgeBacklog(),
    _ruleCheckMemoryRecovery(),
    _ruleCheckRAM(),
  ].filter(Boolean);

  const toNotify = [];

  for (const finding of rawFindings) {
    const dedupKey = `${finding.rule_id}:${finding.entity}:${week}`;
    const existing = state.dedup[dedupKey];

    if (!existing) {
      // 新發現
      state.dedup[dedupKey] = { status: 'new', first_seen: new Date().toISOString(), priority: finding.priority };
      toNotify.push({ ...finding, dedup_status: 'new' });
    } else if (existing.status === 'resolved') {
      // Reopened
      existing.status = 'reopened';
      existing.reopened_at = new Date().toISOString();
      toNotify.push({ ...finding, dedup_status: 'reopened' });
    }
    // 已存在且 active → 不重推
  }

  // 標記本週未觸發的 key 為 resolved
  for (const [key, val] of Object.entries(state.dedup)) {
    if (key.endsWith(`:${week}`) && val.status === 'new') {
      const stillActive = rawFindings.some(f => `${f.rule_id}:${f.entity}:${week}` === key);
      if (!stillActive) val.status = 'resolved';
    }
  }

  // 清理 >4 週的舊 state
  const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 3600 * 1000).toISOString();
  for (const key of Object.keys(state.dedup)) {
    if ((state.dedup[key].first_seen || '') < fourWeeksAgo) delete state.dedup[key];
  }

  _saveAdvisorState(state);

  if (push && toNotify.length > 0) {
    _pushAdvisorReport(toNotify);
  }

  return { total: rawFindings.length, notify: toNotify.length, findings: rawFindings, toNotify };
}

// ── Knowledge-Digest 自動 ingest（HIGH findings）────────────────────────────
// 每次 scanV2 後把 HIGH priority findings 寫入 knowledge-digest
// doc_id: advisor:<rule_id>:<entity>（跨週共用，upsert 自動覆蓋）

async function _ingestHighFindingsToKnowledge(findings) {
  const highFindings = findings.filter(f => f.priority === 'HIGH');
  if (highFindings.length === 0) return;

  const os   = require('os');
  const digestScript = path.join(_REPO_ROOT, 'src/agents/knowledge-digest/scripts/digest.js');
  if (!fs.existsSync(digestScript)) return;

  const chunks = highFindings.map(f => {
    const text = [
      `問題：${f.problem}`,
      `影響：${f.impact}`,
      `可能原因：${f.possible_cause || '未知'}`,
      `建議動作：${f.action}`,
    ].join('\n');
    // chunk 長度 < 100 → skip（無語意）
    if (text.length < 100) return null;
    return { section: `${f.rule_id}:${f.entity}`, text, char_count: text.length };
  }).filter(Boolean);

  if (chunks.length === 0) return;

  const tmpFile = path.join(os.tmpdir(), `advisor-chunks-${Date.now()}.json`);
  const chunksData = {
    document_id: `advisor-sre-findings`,
    title: `SRE Advisor HIGH Findings`,
    parser_version: '1.0',
    metadata: { source_url: '', source_basename: 'advisor.js' },
    chunks,
  };

  try {
    fs.writeFileSync(tmpFile, JSON.stringify(chunksData, null, 2), 'utf8');
    _execSync(
      `node "${digestScript}" ingest "${tmpFile}" --yes --tags=optimization`,
      { encoding: 'utf8', stdio: 'inherit' }
    );
    console.log(`[advisor] knowledge-digest ingest: ${chunks.length} HIGH findings`);
  } catch (err) {
    console.warn(`[advisor] knowledge-digest ingest failed: ${err.message}`);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ── Telegram 推播 ────────────────────────────────────────────────────────────

function _pushAdvisorReport(findings) {
  const https = require('https');
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId   = process.env.TELEGRAM_CHAT_ID   || '';
  if (!botToken || !chatId) {
    console.warn('[advisor] Telegram not configured, skipping push');
    return;
  }

  const priorityIcon = { HIGH: '🔴', MEDIUM: '🟡', LOW: '🟢' };
  const lines = [`📊 週度系統優化建議（${_isoWeek()}）\n`];
  findings.sort((a, b) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[a.priority] - { HIGH: 0, MEDIUM: 1, LOW: 2 }[b.priority]));

  for (const f of findings) {
    const icon = priorityIcon[f.priority] || '⚪';
    const tag  = f.dedup_status === 'reopened' ? ' [重新觸發]' : '';
    lines.push(`${icon} ${f.problem}${tag}`);
    lines.push(`   影響：${f.impact}`);
    lines.push(`   建議動作：${f.action}`);
    lines.push('');
  }

  const text = lines.join('\n').trim();
  const body = JSON.stringify({ chat_id: chatId, text });

  const req = https.request({
    hostname: 'api.telegram.org', port: 443,
    path: `/bot${botToken}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout: 15000,
  }, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try { const j = JSON.parse(data); console.log('[advisor] push', j.ok ? 'ok' : j.description); }
      catch {}
    });
  });
  req.on('error', e => console.error('[advisor] push error:', e.message));
  req.write(body);
  req.end();
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0] || 'scan';

  switch (command) {
    case 'scan': {
      const result = scan();
      if (result.new > 0) {
        const outputDir = path.join(__dirname, '../data');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, 'latest-scan.md');
        const report = generateReport(result.suggestions);
        fs.writeFileSync(outputPath, report, 'utf8');
        console.log(`✅ 扫描完成 | 新建议 ${result.new} 条\n📄 完整报告：${outputPath}`);
      } else {
        console.log('✅ 扫描完成 | 系统运行良好，暂无新建议');
      }
      break;
    }

    case 'scan-v2': {
      // Phase 4 rule-based SRE scan
      try { require('dotenv').config(); } catch {}
      const push = args.includes('--push');
      const result = scanV2({ push });
      console.log(`[advisor-v2] findings=${result.total} notify=${result.notify}`);
      for (const f of result.findings) {
        console.log(`  [${f.priority}] ${f.rule_id}:${f.entity} — ${f.problem}`);
      }
      if (!push && result.toNotify.length > 0) {
        console.log(`\n（加上 --push 可推播到 Telegram）`);
      }
      // 自動 ingest HIGH findings 到 knowledge-digest
      _ingestHighFindingsToKnowledge(result.findings).catch(() => {});
      break;
    }

    default:
      console.log(`
Optimization Advisor

用法：
  node advisor.js scan        # 執行舊版掃描
  node advisor.js scan-v2     # 執行 SRE rule-based 掃描
  node advisor.js scan-v2 --push  # 掃描並推播到 Telegram
      `);
  }
}

module.exports = { scan, generateReport, scanV2, _ingestHighFindingsToKnowledge };
