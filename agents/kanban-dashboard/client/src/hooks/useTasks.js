import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client';
import { useWS } from './useWebSocket.jsx';

const POLL_FAST = 30000;
const POLL_SLOW = 120000;

export default function useTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const wsConnectedRef = useRef(false);

  const fetchTasks = useCallback(async () => {
    try {
      const data = await api.getTasks();
      setTasks(data.tasks);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // WebSocket: handle task events in real-time
  const wsConnected1 = useWS('tasks:created', (task) => {
    setTasks(prev => [...prev, task]);
  });
  useWS('tasks:updated', (task) => {
    setTasks(prev => prev.map(t => t.id === task.id ? task : t));
  });
  useWS('tasks:deleted', ({ id, hard }) => {
    if (hard) {
      setTasks(prev => prev.filter(t => t.id !== id));
    } else {
      setTasks(prev => prev.map(t => t.id === id ? { ...t, column: 'archive' } : t));
    }
  });
  useWS('tasks:moved', (task) => {
    setTasks(prev => prev.map(t => t.id === task.id ? task : t));
  });
  useWS('tasks:comment', ({ taskId, comment }) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, comments: [...(t.comments || []), comment] } : t
    ));
  });
  wsConnectedRef.current = wsConnected1;

  useEffect(() => {
    fetchTasks();
    const id = setInterval(() => {
      if (!document.hidden) fetchTasks();
    }, wsConnectedRef.current ? POLL_SLOW : POLL_FAST);
    return () => clearInterval(id);
  }, [fetchTasks]);

  const createTask = useCallback(async (data) => {
    const res = await api.createTask(data);
    // WS will handle the update, but also set locally for instant feedback
    setTasks(prev => [...prev, res.task]);
    return res.task;
  }, []);

  const updateTask = useCallback(async (id, data) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...data } : t));
    try {
      const res = await api.updateTask(id, data);
      setTasks(prev => prev.map(t => t.id === id ? res.task : t));
      return res.task;
    } catch (err) {
      fetchTasks();
      throw err;
    }
  }, [fetchTasks]);

  const deleteTask = useCallback(async (id, hard = false) => {
    setTasks(prev => hard ? prev.filter(t => t.id !== id) : prev.map(t => t.id === id ? { ...t, column: 'archive' } : t));
    try {
      await api.deleteTask(id, hard);
    } catch (err) {
      fetchTasks();
      throw err;
    }
  }, [fetchTasks]);

  const moveTask = useCallback(async (id, column, order) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, column, order: order ?? t.order } : t));
    try {
      const res = await api.moveTask(id, column, order);
      setTasks(prev => prev.map(t => t.id === id ? res.task : t));
      return res.task;
    } catch (err) {
      fetchTasks();
      throw err;
    }
  }, [fetchTasks]);

  const addComment = useCallback(async (taskId, text, parentId) => {
    const res = await api.addComment(taskId, text, parentId);
    setTasks(prev => prev.map(t =>
      t.id === taskId
        ? { ...t, comments: [...(t.comments || []), res.comment] }
        : t
    ));
    return res.comment;
  }, []);

  return { tasks, loading, error, createTask, updateTask, deleteTask, moveTask, addComment, refresh: fetchTasks, wsConnected: wsConnected1 };
}
