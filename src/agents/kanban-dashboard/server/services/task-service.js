const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createMutex } = require('../middleware/file-mutex');

const DATA_DIR = path.join(__dirname, '../../data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const mutex = createMutex(TASKS_FILE);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

function readTasks() {
  ensureDataDir();
  if (!fs.existsSync(TASKS_FILE)) {
    fs.writeFileSync(TASKS_FILE, '[]', 'utf8');
    return [];
  }
  const data = fs.readFileSync(TASKS_FILE, 'utf8');
  return JSON.parse(data);
}

function writeTasks(tasks) {
  ensureDataDir();
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
}

function getAllTasks(filters = {}) {
  const tasks = readTasks();
  let result = tasks;

  if (filters.column) {
    result = result.filter(t => t.column === filters.column);
  }
  if (filters.priority) {
    result = result.filter(t => t.priority === filters.priority);
  }
  if (filters.tag) {
    result = result.filter(t => t.tags && t.tags.includes(filters.tag));
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(t =>
      t.title.toLowerCase().includes(q) ||
      (t.description && t.description.toLowerCase().includes(q))
    );
  }

  return result;
}

function getTaskById(id) {
  const tasks = readTasks();
  return tasks.find(t => t.id === id) || null;
}

function createTask(data) {
  return mutex.withLock(() => {
    const tasks = readTasks();
    const now = new Date().toISOString();
    const column = data.column || 'todo';

    // Compute order: last in column
    const columnTasks = tasks.filter(t => t.column === column);
    const maxOrder = columnTasks.length > 0
      ? Math.max(...columnTasks.map(t => t.order || 0))
      : -1;

    const task = {
      id: generateId(),
      title: data.title,
      description: data.description || '',
      column,
      priority: data.priority || 'medium',
      tags: data.tags || [],
      dueDate: data.dueDate || null,
      isPinned: data.isPinned || false,
      attachments: [],
      comments: [],
      order: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
      createdBy: data.createdBy || 'user'
    };

    tasks.push(task);
    writeTasks(tasks);
    return task;
  });
}

function updateTask(id, patch) {
  return mutex.withLock(() => {
    const tasks = readTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;

    const allowed = ['title', 'description', 'column', 'priority', 'tags', 'dueDate', 'isPinned'];
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        tasks[idx][key] = patch[key];
      }
    }
    tasks[idx].updatedAt = new Date().toISOString();

    writeTasks(tasks);
    return tasks[idx];
  });
}

function deleteTask(id, hard = false) {
  return mutex.withLock(() => {
    const tasks = readTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;

    if (hard) {
      tasks.splice(idx, 1);
    } else {
      tasks[idx].column = 'archive';
      tasks[idx].updatedAt = new Date().toISOString();
    }

    writeTasks(tasks);
    return true;
  });
}

function moveTask(id, column, order) {
  return mutex.withLock(() => {
    const tasks = readTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;

    const oldColumn = tasks[idx].column;
    tasks[idx].column = column;
    tasks[idx].updatedAt = new Date().toISOString();

    if (order !== undefined) {
      tasks[idx].order = order;
      // Recompute order for tasks in target column
      const columnTasks = tasks
        .filter(t => t.column === column && t.id !== id)
        .sort((a, b) => (a.order || 0) - (b.order || 0));

      columnTasks.splice(order, 0, tasks[idx]);
      columnTasks.forEach((t, i) => { t.order = i; });
    } else {
      // Append to end of target column
      const columnTasks = tasks.filter(t => t.column === column && t.id !== id);
      const maxOrder = columnTasks.length > 0
        ? Math.max(...columnTasks.map(t => t.order || 0))
        : -1;
      tasks[idx].order = maxOrder + 1;
    }

    writeTasks(tasks);
    return tasks[idx];
  });
}

function addComment(taskId, text, parentId) {
  return mutex.withLock(() => {
    const tasks = readTasks();
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return null;

    const now = new Date().toISOString();
    const comment = {
      id: generateId(),
      text,
      parentId: parentId || null,
      createdAt: now,
      updatedAt: now
    };

    tasks[idx].comments.push(comment);
    tasks[idx].updatedAt = now;

    writeTasks(tasks);
    return comment;
  });
}

function addAttachment(taskId, attachment) {
  return mutex.withLock(() => {
    const tasks = readTasks();
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return null;

    tasks[idx].attachments.push(attachment);
    tasks[idx].updatedAt = new Date().toISOString();

    writeTasks(tasks);
    return attachment;
  });
}

module.exports = {
  getAllTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  moveTask,
  addComment,
  addAttachment,
  generateId
};
