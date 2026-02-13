import React from 'react';

const STATUS_COLORS = {
  running: 'var(--accent-green)',
  scheduled: 'var(--accent-blue)',
  stopped: 'var(--accent-red)',
  error: 'var(--accent-red)',
  unknown: 'var(--text-muted)'
};

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '12px',
    marginBottom: '16px'
  },
  card: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '14px',
    cursor: 'pointer',
    transition: 'border-color 0.15s'
  },
  cardActive: {
    borderColor: 'var(--accent-blue)'
  },
  name: {
    fontSize: '14px',
    fontWeight: 600,
    marginBottom: '6px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  status: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0
  },
  meta: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    lineHeight: 1.6
  }
};

export default function AgentList({ agents, selected, onSelect }) {
  return (
    <div style={styles.grid}>
      {agents.map(agent => (
        <div
          key={agent.name}
          style={{
            ...styles.card,
            ...(selected === agent.name ? styles.cardActive : {})
          }}
          onClick={() => onSelect(agent.name)}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-light)'}
          onMouseLeave={e => {
            if (selected !== agent.name) e.currentTarget.style.borderColor = 'var(--border)';
          }}
        >
          <div style={styles.name}>
            <span style={{ ...styles.status, background: STATUS_COLORS[agent.status] || STATUS_COLORS.unknown }} />
            {agent.name}
          </div>
          <div style={styles.meta}>
            <div>Status: {agent.status}</div>
            {agent.human && <div>Schedule: {agent.human}</div>}
            {agent.nextRun && <div>Next: {new Date(agent.nextRun).toLocaleString()}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
