import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

const POLL_INTERVAL = 30000;

export default function useAgents() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAgents = useCallback(async () => {
    try {
      const data = await api.getAgentsStatus();
      setAgents(data.agents);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    const id = setInterval(fetchAgents, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchAgents]);

  return { agents, loading, error, refresh: fetchAgents };
}
