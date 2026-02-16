import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client';
import { useWS } from './useWebSocket.jsx';

const POLL_FAST = 30000;
const POLL_SLOW = 120000;

export default function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const wsConnectedRef = useRef(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await api.getNotifications();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch (_) {}
    finally {
      setLoading(false);
    }
  }, []);

  // WebSocket: refresh on notification events
  const wsConnected = useWS('notifications:new', () => fetchNotifications());
  wsConnectedRef.current = wsConnected;

  useEffect(() => {
    fetchNotifications();
    const id = setInterval(() => {
      if (!document.hidden) fetchNotifications();
    }, wsConnectedRef.current ? POLL_SLOW : POLL_FAST);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  const markRead = useCallback(async (id) => {
    await api.markRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    await api.markAllRead();
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  return { notifications, unreadCount, loading, markRead, markAllRead, refresh: fetchNotifications };
}
