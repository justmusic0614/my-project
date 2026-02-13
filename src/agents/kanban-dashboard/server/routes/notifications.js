const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error-handler');
const notificationService = require('../services/notification-service');

// POST /api/notifications
router.post('/', asyncHandler(async (req, res) => {
  const { type, title, message, metadata } = req.body;
  if (!type || !title || !message) {
    return res.status(400).json({ error: true, message: 'type, title, message are required' });
  }
  const notification = notificationService.addNotification(type, title, message, metadata || {});
  res.status(201).json(notification);
}));

// GET /api/notifications
router.get('/', asyncHandler(async (req, res) => {
  const unread = req.query.unread === 'true';
  const notifications = notificationService.getAllNotifications(unread);
  const unreadCount = notificationService.getUnreadCount();
  res.json({ notifications, unreadCount });
}));

// PUT /api/notifications/:id/read
router.put('/:id/read', asyncHandler(async (req, res) => {
  const success = notificationService.markRead(req.params.id);
  if (!success) {
    return res.status(404).json({ error: true, message: 'Notification not found' });
  }
  res.json({ success: true });
}));

// PUT /api/notifications/read-all
router.put('/read-all', asyncHandler(async (req, res) => {
  notificationService.markAllRead();
  res.json({ success: true });
}));

module.exports = router;
