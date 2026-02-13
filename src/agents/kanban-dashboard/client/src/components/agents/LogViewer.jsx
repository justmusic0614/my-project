import React, { useState, useEffect, useRef } from 'react';

const styles = {
  container: {
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: '12px',
    lineHeight: 1.6,
    height: '400px',
    overflow: 'auto',
    padding: '12px'
  },
  line: {
    color: 'var(--text-secondary)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all'
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  badge: {
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '12px',
    background: 'var(--accent-green)22',
    color: 'var(--accent-green)'
  }
};

export default function LogViewer({ agentName }) {
  const [logs, setLogs] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const containerRef = useRef(null);
  const autoScroll = useRef(true);

  // Fetch initial logs
  useEffect(() => {
    fetch(`/api/agents/${agentName}/logs?lines=100`)
      .then(r => r.json())
      .then(data => setLogs(data.logs || []))
      .catch(() => {});
  }, [agentName]);

  // SSE streaming
  useEffect(() => {
    if (!streaming) return;

    const source = new EventSource(`/api/agents/${agentName}/logs/stream`);

    // Batch log updates to reduce re-renders
    let buffer = [];
    let timer = null;

    source.onmessage = (e) => {
      buffer.push(e.data);
      if (!timer) {
        timer = setTimeout(() => {
          setLogs(prev => [...prev, ...buffer].slice(-500));
          buffer = [];
          timer = null;
        }, 200); // Batch updates every 200ms
      }
    };

    source.onerror = () => {
      source.close();
      setStreaming(false);
      if (timer) clearTimeout(timer);
    };

    return () => {
      source.close();
      if (timer) clearTimeout(timer);
    };
  }, [agentName, streaming]);

  // Auto scroll
  useEffect(() => {
    if (autoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (el) {
      autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    }
  };

  return (
    <div>
      <div style={styles.toolbar}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Logs ({logs.length} lines)
        </span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {streaming && <span style={styles.badge}>LIVE</span>}
          <button
            className="btn btn-ghost"
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => setStreaming(!streaming)}
          >
            {streaming ? 'Pause' : 'Stream'}
          </button>
        </div>
      </div>
      <div ref={containerRef} style={styles.container} onScroll={handleScroll}>
        {logs.map((line, i) => (
          <div key={i} style={styles.line}>{line}</div>
        ))}
        {logs.length === 0 && (
          <div style={{ color: 'var(--text-muted)' }}>No logs available</div>
        )}
      </div>
    </div>
  );
}
