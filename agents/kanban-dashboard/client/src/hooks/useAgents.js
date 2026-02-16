import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client';
import { useWS } from './useWebSocket.jsx';

const POLL_FAST = 30000;
const POLL_SLOW = 120000;

export default function useAgents() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const wsConnectedRef = useRef(false);

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

  // WebSocket: refresh on agent events
  const wsConnected = useWS('agents:schedule-changed', () => fetchAgents());
  wsConnectedRef.current = wsConnected;

  useEffect(() => {
    fetchAgents();
    const id = setInterval(() => {
      if (!document.hidden) fetchAgents();
    }, wsConnectedRef.current ? POLL_SLOW : POLL_FAST);
    return () => clearInterval(id);
  }, [fetchAgents]);

  return { agents, loading, error, refresh: fetchAgents, wsConnected };
}
