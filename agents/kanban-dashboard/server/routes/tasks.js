const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error-handler');
const taskService = require('../services/task-service');
const { broadcast } = require('../websocket');

const VALID_COLUMNS = ['todo', 'ongoing', 'pending', 'review', 'done', 'archive'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];

// GET /api/tasks - List all tasks
router.get('/', asyncHandler(async (req, res) => {
  const { column, priority, tag, search } = req.query;
  const tasks = taskService.getAllTasks({ column, priority, tag, search });
  res.json({ tasks });
}));

// POST /api/tasks - Create task
router.post('/', asyncHandler(async (req, res) => {
  const { title, description, column, priority, tags, dueDate, createdBy } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: true, message: 'title is required' });
  }
  if (column && !VALID_COLUMNS.includes(column)) {
    return res.status(400).json({ error: true, message: `Invalid column. Must be one of: ${VALID_COLUMNS.join(', ')}` });
  }
  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: true, message: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` });
  }

  const task = taskService.createTask({ title: title.trim(), description, column, priority, tags, dueDate, createdBy });
  broadcast('tasks:created', task);
  res.status(201).json({ task });
}));

// GET /api/tasks/:id - Get single task
router.get('/:id', asyncHandler(async (req, res) => {
  const task = taskService.getTaskById(req.params.id);
  if (!task) {
    return res.status(404).json({ error: true, message: 'Task not found' });
  }
  res.json({ task });
}));

// PUT /api/tasks/:id - Update task
router.put('/:id', asyncHandler(async (req, res) => {
  const { column, priority } = req.body;

  if (column && !VALID_COLUMNS.includes(column)) {
    return res.status(400).json({ error: true, message: `Invalid column. Must be one of: ${VALID_COLUMNS.join(', ')}` });
  }
  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: true, message: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` });
  }

  const task = taskService.updateTask(req.params.id, req.body);
  if (!task) {
    return res.status(404).json({ error: true, message: 'Task not found' });
  }
  broadcast('tasks:updated', task);
  res.json({ task });
}));

// DELETE /api/tasks/:id - Delete task
router.delete('/:id', asyncHandler(async (req, res) => {
  const hard = req.query.hard === 'true';
  const success = taskService.deleteTask(req.params.id, hard);
  if (!success) {
    return res.status(404).json({ error: true, message: 'Task not found' });
  }
  broadcast('tasks:deleted', { id: req.params.id, hard });
  res.json({ success: true });
}));

// POST /api/tasks/:id/move - Move task to column
router.post('/:id/move', asyncHandler(async (req, res) => {
  const { column, order } = req.body;

  if (!column || !VALID_COLUMNS.includes(column)) {
    return res.status(400).json({ error: true, message: `column is required. Must be one of: ${VALID_COLUMNS.join(', ')}` });
  }

  const task = taskService.moveTask(req.params.id, column, order);
  if (!task) {
    return res.status(404).json({ error: true, message: 'Task not found' });
  }
  broadcast('tasks:moved', task);
  res.json({ task });
}));

// POST /api/tasks/:id/comments - Add comment
router.post('/:id/comments', asyncHandler(async (req, res) => {
  const { text, parentId } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: true, message: 'text is required' });
  }

  const comment = taskService.addComment(req.params.id, text.trim(), parentId);
  if (!comment) {
    return res.status(404).json({ error: true, message: 'Task not found' });
  }
  broadcast('tasks:comment', { taskId: req.params.id, comment });
  res.status(201).json({ comment });
}));

module.exports = router;
