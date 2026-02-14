/**
 * Kanban Handler - 包裝現有 /task 邏輯
 * 重用 telegram.js 中的 parseTaskCommand / handleTaskAdd / handleTaskList / handleTaskDone
 */

const taskService = require('../../kanban-dashboard/server/services/task-service');
const notificationService = require('../../kanban-dashboard/server/services/notification-service');

/**
 * 解析 task 子指令
 * 支援格式：
 *   add <title> [@priority] [#tag]
 *   list
 *   done <id>
 *   help (或無子指令)
 */
function parseSubcommand(text) {
  if (!text || text === 'help') {
    return { action: 'help' };
  }

  const parts = text.trim().split(/\s+/);
  const action = parts[0];

  if (action === 'add' && parts.length >= 2) {
    const restText = parts.slice(1).join(' ');
    const priorityMatch = restText.match(/@(high|medium|low)/i);
    const priority = priorityMatch ? priorityMatch[1].toLowerCase() : 'medium';
    const tagMatches = restText.match(/#(\w+)/g);
    const tags = tagMatches ? tagMatches.map(t => t.substring(1)) : [];
    tags.push('telegram');
    const title = restText.replace(/@(high|medium|low)/gi, '').replace(/#\w+/g, '').trim();
    if (!title) return { action: 'help' };
    return { action: 'add', title, priority, tags };
  }

  if (action === 'list') {
    return { action: 'list' };
  }

  if (action === 'done' && parts[1]) {
    return { action: 'done', taskId: parts[1] };
  }

  // 沒有子指令 → 預設為 add（整段文字當標題）
  const priorityMatch = text.match(/@(high|medium|low)/i);
  const priority = priorityMatch ? priorityMatch[1].toLowerCase() : 'medium';
  const tagMatches = text.match(/#(\w+)/g);
  const tags = tagMatches ? tagMatches.map(t => t.substring(1)) : [];
  tags.push('telegram');
  const title = text.replace(/@(high|medium|low)/gi, '').replace(/#\w+/g, '').trim();
  if (!title) return { action: 'help' };
  return { action: 'add', title, priority, tags };
}

async function handle(text, context) {
  const { chatId, username } = context;
  const parsed = parseSubcommand(text);

  if (parsed.action === 'help') {
    return (
      '📋 Task 指令說明\n\n' +
      '/task add <標題> - 建立新任務\n' +
      '/task list - 列出進行中的任務\n' +
      '/task done <ID> - 完成任務\n\n' +
      '進階參數:\n' +
      '@high / @medium / @low - 設定優先度\n' +
      '#標籤 - 加入標籤（可多個）\n\n' +
      '範例:\n' +
      '/task add 買牛奶 @high #購物\n' +
      '/task add 讀書 @medium #學習 #每日'
    );
  }

  if (parsed.action === 'add') {
    const task = taskService.createTask({
      title: parsed.title,
      column: 'ongoing',
      priority: parsed.priority,
      tags: parsed.tags,
      createdBy: `telegram:${username || 'unknown'}`
    });
    notificationService.addNotification(
      'task', '新任務已建立',
      `來自 Telegram：${task.title}`,
      { taskId: task.id, source: 'telegram' }
    );
    const tagStr = parsed.tags.length > 0 ? ` #${parsed.tags.join(' #')}` : '';
    return `✅ Task 已建立\n\nID: ${task.id}\n標題: ${task.title}\n優先度: ${parsed.priority}${tagStr}`;
  }

  if (parsed.action === 'list') {
    const tasks = taskService.getAllTasks({ column: 'ongoing' });
    if (tasks.length === 0) return '📋 目前沒有進行中的任務';
    const taskList = tasks.slice(0, 10).map((t, i) => {
      const icon = { high: '🔴', medium: '🟡', low: '🟢' }[t.priority] || '⚪';
      return `${i + 1}. ${icon} ${t.title} (${t.id})`;
    }).join('\n');
    const more = tasks.length > 10 ? `\n\n還有 ${tasks.length - 10} 個任務...` : '';
    return `📋 進行中的任務 (${tasks.length}):\n\n${taskList}${more}`;
  }

  if (parsed.action === 'done') {
    const task = taskService.getTaskById(parsed.taskId);
    if (!task) return `❌ 找不到任務 ID: ${parsed.taskId}`;
    taskService.updateTask(parsed.taskId, { column: 'done' });
    notificationService.addNotification(
      'task', '任務已完成',
      `來自 Telegram：${task.title}`,
      { taskId: task.id, source: 'telegram' }
    );
    return `✅ 任務已完成\n\n${task.title}`;
  }

  return '❌ 無法辨識的 task 指令';
}

module.exports = { handle };
