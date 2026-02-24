// 功能扩展规则引擎

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function exec(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', ...options }).trim();
  } catch (e) {
    return null;
  }
}

function generateId() {
  return require('crypto').randomBytes(8).toString('hex');
}

function timestamp() {
  return new Date().toISOString();
}

class FeatureExpansionEngine {
  constructor() {
    this.suggestions = [];
  }
  
  // 检查可整合的 skills
  checkAvailableSkills() {
    const suggestions = [];
    
    // 检查 Notion skill 整合机会
    const notionSkillExists = fs.existsSync('/home/clawbot/.nvm/versions/node/v22.22.0/lib/node_modules/clawdbot/skills/notion');
    const knowledgeDigestExists = fs.existsSync('/home/clawbot/clawd/agents/knowledge-digest');
    
    if (notionSkillExists && knowledgeDigestExists) {
      suggestions.push({
        id: generateId(),
        timestamp: timestamp(),
        category: 'feature-expansion',
        priority: 'medium',
        title: '可整合 Notion 实现知识库同步',
        description: '检测到 Notion skill 和 Knowledge Digest 都已安装',
        suggestion: '建议实现双向同步：自动将知识笔记同步到 Notion 数据库，便于跨平台访问',
        impact: '提升知识管理效率，支持团队协作',
        effort: 'medium',
        source: 'feature-expansion-engine',
        implementation_hint: '使用 Notion API 创建页面，利用 Knowledge Digest 的标签映射到 Notion 属性'
      });
    }
    
    // 检查 GitHub skill 整合机会
    const githubConfigured = exec('which gh') !== null;
    const deployMonitorExists = fs.existsSync('/home/clawbot/clawd/agents/deploy-monitor');
    
    if (githubConfigured && deployMonitorExists) {
      suggestions.push({
        id: generateId(),
        timestamp: timestamp(),
        category: 'feature-expansion',
        priority: 'low',
        title: '可自动建立 GitHub Issues 记录优化建议',
        description: 'GitHub CLI 已配置，Deploy Monitor 已安装',
        suggestion: '建议将高优先级优化建议自动建立为 GitHub Issue，便于追踪与管理',
        impact: '系统化管理改进任务，可视化进度',
        effort: 'small',
        source: 'feature-expansion-engine',
        implementation_hint: '使用 gh issue create，自动添加标签（optimization, priority-high）'
      });
    }
    
    return suggestions;
  }
  
  // 检查重复性操作
  checkRepetitiveOperations() {
    const suggestions = [];
    
    // 检查手动执行频率高的命令
    const historyFile = '/home/clawbot/.bash_history';
    if (fs.existsSync(historyFile)) {
      const history = fs.readFileSync(historyFile, 'utf8').split('\n').slice(-1000);
      
      // 统计命令频率
      const commandFreq = {};
      history.forEach(cmd => {
        const normalized = cmd.trim().split(/\s+/)[0];
        if (normalized && normalized.length > 2) {
          commandFreq[normalized] = (commandFreq[normalized] || 0) + 1;
        }
      });
      
      // 找出频繁手动执行的命令
      Object.entries(commandFreq).forEach(([cmd, count]) => {
        if (count > 10 && !['ls', 'cd', 'cat', 'echo', 'grep'].includes(cmd)) {
          suggestions.push({
            id: generateId(),
            timestamp: timestamp(),
            category: 'feature-expansion',
            priority: 'low',
            title: `高频命令可自动化：${cmd}`,
            description: `最近1000条历史中执行了 ${count} 次`,
            suggestion: '考虑建立脚本或添加到 cron 实现自动化',
            impact: '减少重复性手动操作',
            effort: 'small',
            source: 'feature-expansion-engine'
          });
        }
      });
    }
    
    return suggestions.slice(0, 2); // 最多返回2个
  }
  
  // 检查数据利用机会
  checkDataOpportunities() {
    const suggestions = [];
    
    // 检查 Knowledge Digest 数据
    // 改讀標準介面（data/runtime/latest.json）而非內部 JSONL
    const knowledgeLatestFile = '/home/clawbot/clawd/agents/knowledge-digest/data/runtime/latest.json';
    if (fs.existsSync(knowledgeLatestFile)) {
      const latest = JSON.parse(fs.readFileSync(knowledgeLatestFile, 'utf8'));
      const totalEntries = latest.total_entries || 0;
      const tagDistribution = latest.tag_distribution || {};

      if (totalEntries >= 10) {
        const topTags = Object.entries(tagDistribution).sort((a, b) => b[1] - a[1]).slice(0, 5);

        suggestions.push({
          id: generateId(),
          timestamp: timestamp(),
          category: 'feature-expansion',
          priority: 'medium',
          title: '可建立知识库统计仪表盘',
          description: `已累积 ${totalEntries} 条知识，前5标签：${topTags.map(t => t[0]).join(', ')}`,
          suggestion: '建议实现可视化仪表盘：标签分布、时间趋势、热门主题',
          impact: '更好地利用累积的知识数据，发现知识模式',
          effort: 'medium',
          source: 'feature-expansion-engine',
          implementation_hint: '可使用 Chart.js 生成图表，定期推送摘要'
        });
      }

      if (totalEntries >= 20) {
        suggestions.push({
          id: generateId(),
          timestamp: timestamp(),
          category: 'feature-expansion',
          priority: 'medium',
          title: '可实现智能标签推荐',
          description: `知识库已有 ${totalEntries} 条数据，标签系统已成型`,
          suggestion: '使用 LLM 分析内容自动推荐标签，提升分类准确性',
          impact: '减少手动标签工作，提升检索精度',
          effort: 'small',
          source: 'feature-expansion-engine',
          implementation_hint: '在 add-note 时调用 Claude API 分析内容并建议标签'
        });
      }
    }
    
    // 检查 Security Patrol 数据
    const securityHistoryDir = '/home/clawbot/security-patrol/data/history';
    if (fs.existsSync(securityHistoryDir)) {
      const files = fs.readdirSync(securityHistoryDir);
      
      if (files.length >= 7) {
        suggestions.push({
          id: generateId(),
          timestamp: timestamp(),
          category: 'feature-expansion',
          priority: 'low',
          title: '可实现安全趋势分析',
          description: `已收集 ${files.length} 天的巡逻数据`,
          suggestion: '建议分析历史数据：资源使用趋势、异常模式、预测性维护',
          impact: '从被动监控转为主动预测',
          effort: 'medium',
          source: 'feature-expansion-engine'
        });
      }
    }
    
    return suggestions;
  }
  
  // 检查现有功能扩展机会
  checkExistingFeatures() {
    const suggestions = [];
    
    // 检查 Market Digest
    const marketDigestExists = fs.existsSync('/home/clawbot/clawd/skills/market-digest');
    if (marketDigestExists) {
      suggestions.push({
        id: generateId(),
        timestamp: timestamp(),
        category: 'feature-expansion',
        priority: 'medium',
        title: 'Market Digest 可加入价格提醒功能',
        description: '当前只有新闻摘要，缺少实时价格监控',
        suggestion: '建议整合股票 API，实现价格异动提醒（例如：单日涨跌超过5%）',
        impact: '提升投资决策时效性',
        effort: 'medium',
        source: 'feature-expansion-engine',
        implementation_hint: '可使用 Yahoo Finance API 或台股 API，每小时检查一次'
      });
      
      suggestions.push({
        id: generateId(),
        timestamp: timestamp(),
        category: 'feature-expansion',
        priority: 'low',
        title: 'Market Digest 可生成周报/月报',
        description: '当前只有每日报告',
        suggestion: '建议实现自动化周报与月报：汇总重要事件、统计分析、趋势观察',
        impact: '更好的长期视角，发现市场规律',
        effort: 'small',
        source: 'feature-expansion-engine'
      });
    }
    
    // 检查 Deploy Monitor
    const deployMonitorExists = fs.existsSync('/home/clawbot/clawd/agents/deploy-monitor');
    if (deployMonitorExists) {
      suggestions.push({
        id: generateId(),
        timestamp: timestamp(),
        category: 'feature-expansion',
        priority: 'low',
        title: 'Deploy Monitor 可加入性能基准测试',
        description: '当前只有健康检查，缺少性能指标',
        suggestion: '建议在部署前后运行基准测试，比较性能变化',
        impact: '及早发现性能回退',
        effort: 'medium',
        source: 'feature-expansion-engine'
      });
    }
    
    return suggestions;
  }
  
  // 检查自动化改进空间
  checkAutomationOpportunities() {
    const suggestions = [];
    
    // 检查是否有手动推播的脚本
    const scriptsDir = '/home/clawbot/clawd';
    const manualPushPatterns = exec(`grep -r "clawdbot message send" ${scriptsDir} 2>/dev/null | wc -l`) || '0';
    const manualPushCount = parseInt(manualPushPatterns);
    
    if (manualPushCount > 5) {
      suggestions.push({
        id: generateId(),
        timestamp: timestamp(),
        category: 'feature-expansion',
        priority: 'low',
        title: '可统一推播格式与模板',
        description: `检测到 ${manualPushCount} 处使用推播功能`,
        suggestion: '建议建立统一的推播模板系统，减少重复代码',
        impact: '提升代码可维护性',
        effort: 'small',
        source: 'feature-expansion-engine'
      });
    }
    
    // 检查备份自动化
    const backupScripts = exec('crontab -l | grep -i backup | wc -l') || '0';
    if (parseInt(backupScripts) === 0) {
      suggestions.push({
        id: generateId(),
        timestamp: timestamp(),
        category: 'feature-expansion',
        priority: 'medium',
        title: '可实现自动备份策略',
        description: '未检测到定期备份任务',
        suggestion: '建议建立自动备份：每日备份重要数据，每周完整备份',
        impact: '数据安全保障',
        effort: 'small',
        source: 'feature-expansion-engine',
        implementation_hint: '使用 rsync + tar.gz，保留最近7天备份'
      });
    }
    
    return suggestions;
  }
  
  // 执行所有功能扩展检查
  runAll() {
    console.log('🚀 执行功能扩展扫描...');
    
    const allSuggestions = [
      ...this.checkAvailableSkills(),
      ...this.checkRepetitiveOperations(),
      ...this.checkDataOpportunities(),
      ...this.checkExistingFeatures(),
      ...this.checkAutomationOpportunities()
    ];
    
    console.log(`✅ 功能扩展扫描完成，找到 ${allSuggestions.length} 个建议`);
    return allSuggestions;
  }
}

module.exports = FeatureExpansionEngine;
