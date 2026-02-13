import React, { useState, useEffect } from 'react';
import LogViewer from './LogViewer';
import MarkdownViewer from '../common/MarkdownViewer';
import '../../styles/markdown.css';

const STATUS_COLORS = {
  running: 'var(--accent-green)',
  scheduled: 'var(--accent-blue)',
  stopped: 'var(--accent-red)',
  error: 'var(--accent-red)',
  unknown: 'var(--text-muted)'
};

const styles = {
  container: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '20px'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px'
  },
  name: { fontSize: '18px', fontWeight: 600 },
  statusBadge: {
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 500
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '12px',
    marginBottom: '20px'
  },
  infoItem: {
    background: 'var(--bg-tertiary)',
    padding: '10px 14px',
    borderRadius: 'var(--radius-sm)'
  },
  infoLabel: { fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' },
  infoValue: { fontSize: '14px', marginTop: '2px' }
};

export default function AgentDetail({ agentName }) {
  const [detail, setDetail] = useState(null);
  const [spec, setSpec] = useState(null);

  useEffect(() => {
    fetch(`/api/agents/${agentName}`)
      .then(r => r.json())
      .then(data => setDetail(data.agent))
      .catch(() => {});

    // Load agent specification
    fetch(`/api/agents/${agentName}/spec`)
      .then(r => r.json())
      .then(data => setSpec(data.spec))
      .catch(() => setSpec(null)); // Spec is optional
  }, [agentName]);

  if (!detail) {
    return <div style={styles.container}>Loading...</div>;
  }

  const statusColor = STATUS_COLORS[detail.status] || STATUS_COLORS.unknown;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.name}>{detail.name}</span>
        <span style={{
          ...styles.statusBadge,
          background: `${statusColor}22`,
          color: statusColor
        }}>
          {detail.status}
        </span>
      </div>

      <div style={styles.infoGrid}>
        {detail.cron && (
          <div style={styles.infoItem}>
            <div style={styles.infoLabel}>Schedule</div>
            <div style={styles.infoValue}>{detail.human || detail.cron}</div>
          </div>
        )}
        {detail.nextRun && (
          <div style={styles.infoItem}>
            <div style={styles.infoLabel}>Next Run</div>
            <div style={styles.infoValue}>{new Date(detail.nextRun).toLocaleString()}</div>
          </div>
        )}
        {detail.pid && (
          <div style={styles.infoItem}>
            <div style={styles.infoLabel}>PID</div>
            <div style={styles.infoValue}>{detail.pid}</div>
          </div>
        )}
        <div style={styles.infoItem}>
          <div style={styles.infoLabel}>Cron Expression</div>
          <div style={styles.infoValue}>{detail.cron || 'N/A'}</div>
        </div>
      </div>

      <LogViewer agentName={agentName} />

      {spec && <MarkdownViewer content={spec} />}
    </div>
  );
}
