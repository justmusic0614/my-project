// GitHub Issues 集成

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function exec(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', ...options }).trim();
  } catch (e) {
    console.error(`执行失败：${cmd}`);
    console.error(e.message);
    return null;
  }
}

class GitHubIntegration {
  constructor(config) {
    this.config = config;
    this.enabled = config.github?.enabled || false;
    this.repo = config.github?.repo || null;
    this.minPriority = config.github?.min_priority || 'high';
  }
  
  // 检查 gh CLI 是否可用
  isAvailable() {
    const ghPath = exec('which gh');
    if (!ghPath) {
      console.log('⚠️ GitHub CLI 未安装');
      return false;
    }
    
    const authStatus = exec('gh auth status 2>&1');
    if (!authStatus || authStatus.includes('not logged')) {
      console.log('⚠️ GitHub CLI 未授权');
      return false;
    }
    
    return true;
  }
  
  // 创建 Issue
  createIssue(suggestion) {
    if (!this.enabled) {
      return null;
    }
    
    if (!this.isAvailable()) {
      return null;
    }
    
    // 检查优先级
    const priorityWeight = {
      'high': 3,
      'medium': 2,
      'low': 1
    };
    
    const minWeight = priorityWeight[this.minPriority] || 3;
    const suggestionWeight = priorityWeight[suggestion.priority] || 1;
    
    if (suggestionWeight < minWeight) {
      console.log(`跳过低优先级建议：${suggestion.title}`);
      return null;
    }
    
    // 构建 Issue 内容
    const title = `[Optimization] ${suggestion.title}`;
    
    const body = `## 优化建议

**类别**：${this.getCategoryLabel(suggestion.category)}
**优先级**：${this.getPriorityLabel(suggestion.priority)}
**来源**：${suggestion.source}
**时间**：${suggestion.timestamp}

## 问题描述

${suggestion.description}

## 建议方案

${suggestion.suggestion}

${suggestion.implementation_hint ? `## 实现提示

${suggestion.implementation_hint}` : ''}

## 影响评估

${suggestion.impact}

**预估工作量**：${this.getEffortLabel(suggestion.effort)}

---

*此 Issue 由 Optimization Advisor 自动创建*
*建议 ID: ${suggestion.id}*
`;
    
    // 构建标签
    const labels = [
      'optimization',
      `priority-${suggestion.priority}`,
      `category-${suggestion.category}`
    ];
    
    // 创建 Issue
    console.log(`\n📝 创建 GitHub Issue: ${title}`);
    
    const repoFlag = this.repo ? `--repo ${this.repo}` : '';
    const labelsFlag = labels.map(l => `--label "${l}"`).join(' ');
    
    const cmd = `gh issue create ${repoFlag} --title "${title}" --body "${body.replace(/"/g, '\\"')}" ${labelsFlag}`;
    
    const result = exec(cmd);
    
    if (result) {
      console.log(`✅ Issue 已创建：${result}`);
      return result;
    } else {
      console.log(`❌ Issue 创建失败`);
      return null;
    }
  }
  
  // 批量创建 Issues
  createIssuesForSuggestions(suggestions) {
    if (!this.enabled) {
      console.log('GitHub 集成未启用');
      return [];
    }
    
    console.log(`\n🔗 GitHub Issues 集成`);
    console.log(`  目标 Repo: ${this.repo || '默认 repo'}`);
    console.log(`  最低优先级: ${this.minPriority}`);
    
    const created = [];
    
    suggestions.forEach(suggestion => {
      const issueUrl = this.createIssue(suggestion);
      if (issueUrl) {
        created.push({
          suggestion_id: suggestion.id,
          issue_url: issueUrl
        });
      }
    });
    
    console.log(`\n✅ 已创建 ${created.length} 个 GitHub Issues`);
    
    return created;
  }
  
  // 辅助方法：格式化标签
  getCategoryLabel(category) {
    const labels = {
      'feature-expansion': '🚀 功能扩展',
      'best-practice': '📋 最佳实践',
      'performance': '⚡ 性能优化',
      'security': '🔒 安全',
      'code-quality': '✨ 代码质量'
    };
    return labels[category] || category;
  }
  
  getPriorityLabel(priority) {
    const labels = {
      'high': '🔴 高',
      'medium': '🟡 中',
      'low': '🟢 低'
    };
    return labels[priority] || priority;
  }
  
  getEffortLabel(effort) {
    const labels = {
      'small': '小（<1天）',
      'medium': '中（1-3天）',
      'large': '大（>3天）'
    };
    return labels[effort] || effort;
  }
}

module.exports = GitHubIntegration;
