const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../../data');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');
const MAX_NOTIFICATIONS = 200;

function readNotifications() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(NOTIFICATIONS_FILE)) {
    fs.writeFileSync(NOTIFICATIONS_FILE, '[]', 'utf8');
    return [];
  }
  return JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE, 'utf8'));
}

function writeNotifications(notifications) {
  // Keep only last MAX_NOTIFICATIONS
  const trimmed = notifications.slice(-MAX_NOTIFICATIONS);
  fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
}

function getAllNotifications(unreadOnly = false) {
  const all = readNotifications();
  if (unreadOnly) {
    return all.filter(n => !n.read);
  }
  return all;
}

function getUnreadCount() {
  return readNotifications().filter(n => !n.read).length;
}

function addNotification(type, title, message, metadata = {}) {
  const notifications = readNotifications();
  const notification = {
    id: 'n_' + crypto.randomBytes(6).toString('hex'),
    type,
    title,
    message,
    read: false,
    createdAt: new Date().toISOString(),
    metadata
  };
  notifications.push(notification);
  writeNotifications(notifications);
  return notification;
}

function markRead(id) {
  const notifications = readNotifications();
  const idx = notifications.findIndex(n => n.id === id);
  if (idx === -1) return false;
  notifications[idx].read = true;
  writeNotifications(notifications);
  return true;
}

function markAllRead() {
  const notifications = readNotifications();
  for (const n of notifications) {
    n.read = true;
  }
  writeNotifications(notifications);
  return true;
}

module.exports = {
  getAllNotifications,
  getUnreadCount,
  addNotification,
  markRead,
  markAllRead
};
