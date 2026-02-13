import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

const POLL_INTERVAL = 30000; // Reduced from 10s to 30s

export default function useTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  useEffect(() => {
    fetchTasks();

    // Only poll when window is visible
    const id = setInterval(() => {
      if (!document.hidden) {
        fetchTasks();
      }
    }, POLL_INTERVAL);

    return () => clearInterval(id);
  }, [fetchTasks]);

  const createTask = useCallback(async (data) => {
    const res = await api.createTask(data);
    setTasks(prev => [...prev, res.task]);
    return res.task;
  }, []);

  const updateTask = useCallback(async (id, data) => {
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...data } : t));
    try {
      const res = await api.updateTask(id, data);
      setTasks(prev => prev.map(t => t.id === id ? res.task : t));
      return res.task;
    } catch (err) {
      fetchTasks(); // revert on error
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
    // Optimistic update
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

  return { tasks, loading, error, createTask, updateTask, deleteTask, moveTask, addComment, refresh: fetchTasks };
}
