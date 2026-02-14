const express = require('express');
const router = express.Router();
const { execSync } = require('child_process');
const { asyncHandler } = require('../middleware/error-handler');
const taskService = require('../services/task-service');
const notificationService = require('../services/notification-service');

// Environment variables
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || 'REDACTED_SECRET';

/**
 * Send reply message to Telegram via clawdbot
 */
function sendTelegramReply(chatId, text) {
  try {
    const escapedText = text.replace(/"/g, '\\"');
    execSync(`clawdbot message send --channel telegram --target ${chatId} --message "${escapedText}"`, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    console.log(`[Telegram] Sent reply to ${chatId}: ${text.substring(0, 50)}...`);
  } catch (err) {
    console.error(`[Telegram] Failed to send reply:`, err.message);
  }
}

/**
 * Parse task command
 * Formats:
 *   /task add <title>
 *   /task add <title> @high #tag1 #tag2
 *   /task list
 *   /task done <id>
 */
function parseTaskCommand(text) {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 3 || parts[0] !== '/task') {
    return null;
  }

  const action = parts[1];

  if (action === 'add') {
    // Extract title, priority, tags
    const restText = parts.slice(2).join(' ');

    // Extract priority (@high, @medium, @low)
    const priorityMatch = restText.match(/@(high|medium|low)/i);
    const priority = priorityMatch ? priorityMatch[1].toLowerCase() : 'medium';

    // Extract tags (#tag1 #tag2)
    const tagMatches = restText.match(/#(\w+)/g);
    const tags = tagMatches ? tagMatches.map(t => t.substring(1)) : [];
    tags.push('telegram'); // Always add telegram tag

    // Remove priority and tags from title
    let title = restText.replace(/@(high|medium|low)/gi, '').replace(/#\w+/g, '').trim();

    if (!title) return null;

    return {
      action: 'add',
      title,
      priority,
      tags
    };
  }

  if (action === 'list') {
    return { action: 'list' };
  }

  if (action === 'done' && parts[2]) {
    return {
      action: 'done',
      taskId: parts[2]
    };
  }

  return null;
}

/**
 * Handle /task add command
 */
async function handleTaskAdd(chatId, username, parsed) {
  try {
    const task = taskService.createTask({
      title: parsed.title,
      column: 'ongoing',
      priority: parsed.priority,
      tags: parsed.tags,
      createdBy: `telegram:${username || 'unknown'}`
    });

    // Create notification
    notificationService.addNotification(
      'task',
      '新任務已建立',
      `來自 Telegram：${task.title}`,
      { taskId: task.id, source: 'telegram' }
    );

    const tagStr = parsed.tags.length > 0 ? ` #${parsed.tags.join(' #')}` : '';
    sendTelegramReply(
      chatId,
      `✅ Task 已建立\n\nID: ${task.id}\n標題: ${task.title}\n優先度: ${parsed.priority}${tagStr}`
    );
  } catch (err) {
    console.error('[Telegram] Task add error:', err);
    sendTelegramReply(chatId, `❌ 建立失敗：${err.message}`);
  }
}

/**
 * Handle /task list command
 */
async function handleTaskList(chatId) {
  try {
    const tasks = taskService.getAllTasks({ column: 'ongoing' });

    if (tasks.length === 0) {
      sendTelegramReply(chatId, '📋 目前沒有進行中的任務');
      return;
    }

    const taskList = tasks
      .slice(0, 10) // Limit to 10 tasks
      .map((t, i) => {
        const priority = { high: '🔴', medium: '🟡', low: '🟢' }[t.priority] || '⚪';
        return `${i + 1}. ${priority} ${t.title} (${t.id})`;
      })
      .join('\n');

    const total = tasks.length;
    const more = total > 10 ? `\n\n還有 ${total - 10} 個任務...` : '';
    sendTelegramReply(chatId, `📋 進行中的任務 (${total}):\n\n${taskList}${more}`);
  } catch (err) {
    console.error('[Telegram] Task list error:', err);
    sendTelegramReply(chatId, `❌ 查詢失敗：${err.message}`);
  }
}

/**
 * Handle /task done command
 */
async function handleTaskDone(chatId, username, taskId) {
  try {
    const task = taskService.getTaskById(taskId);
    if (!task) {
      sendTelegramReply(chatId, `❌ 找不到任務 ID: ${taskId}`);
      return;
    }

    taskService.updateTask(taskId, { column: 'done' });

    // Create notification
    notificationService.addNotification(
      'task',
      '任務已完成',
      `來自 Telegram：${task.title}`,
      { taskId: task.id, source: 'telegram' }
    );

    sendTelegramReply(chatId, `✅ 任務已完成\n\n${task.title}`);
  } catch (err) {
    console.error('[Telegram] Task done error:', err);
    sendTelegramReply(chatId, `❌ 更新失敗：${err.message}`);
  }
}

/**
 * POST /api/telegram/webhook
 *
 * Telegram webhook handler
 * Accepts messages from Telegram bot and creates tasks
 */
router.post('/webhook', asyncHandler(async (req, res) => {
  // Verify webhook secret (optional but recommended)
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (secret && secret !== WEBHOOK_SECRET) {
    console.warn('[Telegram] Invalid webhook secret');
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { message, edited_message } = req.body;
  const msg = message || edited_message;

  if (!msg || !msg.text) {
    return res.json({ ok: true });
  }

  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  const text = msg.text.trim();

  console.log('[Telegram Webhook]', {
    chatId,
    username,
    text: text.substring(0, 100)
  });

  // Parse /task command
  if (text.startsWith('/task ')) {
    const parsed = parseTaskCommand(text);

    if (!parsed) {
      sendTelegramReply(
        chatId,
        '❌ 指令格式錯誤\n\n' +
        '使用方式:\n' +
        '/task add <標題> [@優先度] [#標籤]\n' +
        '/task list\n' +
        '/task done <ID>\n\n' +
        '範例:\n' +
        '/task add 買牛奶 @high #購物'
      );
      return res.json({ ok: true });
    }

    // Handle commands
    if (parsed.action === 'add') {
      await handleTaskAdd(chatId, username, parsed);
    } else if (parsed.action === 'list') {
      await handleTaskList(chatId);
    } else if (parsed.action === 'done') {
      await handleTaskDone(chatId, username, parsed.taskId);
    }
  } else if (text === '/task' || text === '/task help') {
    // Help message
    sendTelegramReply(
      chatId,
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

  res.json({ ok: true });
}));

module.exports = router;
