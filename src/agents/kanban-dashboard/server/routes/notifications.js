const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error-handler');
const notificationService = require('../services/notification-service');

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
