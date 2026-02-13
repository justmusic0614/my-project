import React from 'react';

const styles = {
  bar: {
    display: 'flex',
    gap: '16px',
    marginBottom: '16px',
    flexWrap: 'wrap'
  },
  stat: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '12px 20px',
    minWidth: '140px',
    flex: '1 1 0'
  },
  label: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  value: {
    fontSize: '24px',
    fontWeight: 700,
    marginTop: '4px'
  }
};

export default function StatsBar({ tasks = [] }) {
  const total = tasks.length;
  const active = tasks.filter(t => ['todo', 'ongoing', 'pending', 'review'].includes(t.column)).length;
  const done = tasks.filter(t => t.column === 'done').length;
  const rate = total > 0 ? Math.round((done / total) * 100) : 0;

  const stats = [
    { label: 'Total', value: total, color: 'var(--text-primary)' },
    { label: 'Active', value: active, color: 'var(--accent-blue)' },
    { label: 'Done', value: done, color: 'var(--accent-green)' },
    { label: 'Completion', value: `${rate}%`, color: 'var(--accent-purple)' }
  ];

  return (
    <div style={styles.bar}>
      {stats.map(s => (
        <div key={s.label} style={styles.stat}>
          <div style={styles.label}>{s.label}</div>
          <div style={{ ...styles.value, color: s.color }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}
