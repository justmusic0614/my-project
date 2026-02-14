import React, { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { formatDistanceToNow } from 'date-fns';
import LLMSelector from './LLMSelector';

const STATUS_COLORS = {
  running: 'var(--accent-green)',
  scheduled: 'var(--accent-blue)',
  stopped: 'var(--accent-red)',
  error: 'var(--accent-red)'
};

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: '12px',
    marginBottom: '24px'
  },
  card: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '16px'
  },
  cardLabel: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  cardValue: {
    fontSize: '28px',
    fontWeight: 700,
    marginTop: '4px'
  },
  section: {
    marginBottom: '24px'
  },
  sectionTitle: {
    fontSize: '15px',
    fontWeight: 600,
    marginBottom: '12px',
    color: 'var(--text-secondary)'
  },
  agentRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 0',
    borderBottom: '1px solid var(--border)',
    fontSize: '13px'
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0
  },
  activityRow: {
    padding: '8px 0',
    borderBottom: '1px solid var(--border)',
    fontSize: '13px'
  },
  activityTime: {
    fontSize: '11px',
    color: 'var(--text-muted)'
  },
  upcomingRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid var(--border)',
    fontSize: '13px'
  }
};

export default function Summary() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.getSummary()
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) {
    return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px' }}>Loading dashboard...</div>;
  }

  const { overview, agentHealth, recentActivity, upcomingSchedule } = data;

  return (
    <div>
      <LLMSelector />

      {/* Overview cards */}
      <div style={styles.grid}>
        <div style={styles.card}>
          <div style={styles.cardLabel}>Total Tasks</div>
          <div style={{ ...styles.cardValue, color: 'var(--text-primary)' }}>{overview.total}</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}>Active</div>
          <div style={{ ...styles.cardValue, color: 'var(--accent-blue)' }}>{overview.active}</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}>Done</div>
          <div style={{ ...styles.cardValue, color: 'var(--accent-green)' }}>{overview.done}</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}>Completion</div>
          <div style={{ ...styles.cardValue, color: 'var(--accent-purple)' }}>{overview.completionRate}%</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}>Overdue</div>
          <div style={{ ...styles.cardValue, color: overview.overdue > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
            {overview.overdue}
          </div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardLabel}>Done Today</div>
          <div style={{ ...styles.cardValue, color: 'var(--accent-green)' }}>{overview.completedToday}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Agent Health */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>
            Agent Health ({agentHealth.running} running / {agentHealth.scheduled} scheduled / {agentHealth.stopped} stopped)
          </div>
          <div style={styles.card}>
            {agentHealth.agents.map(a => (
              <div key={a.name} style={styles.agentRow}>
                <span style={{ ...styles.dot, background: STATUS_COLORS[a.status] || 'var(--text-muted)' }} />
                <span style={{ flex: 1 }}>{a.name}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{a.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming Schedule */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Upcoming Schedule</div>
          <div style={styles.card}>
            {upcomingSchedule.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No upcoming runs</div>
            ) : (
              upcomingSchedule.map((s, i) => (
                <div key={i} style={styles.upcomingRow}>
                  <span>{s.agent}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {new Date(s.nextRun).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Recent Activity</div>
        <div style={styles.card}>
          {recentActivity.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No recent activity</div>
          ) : (
            recentActivity.map((a, i) => (
              <div key={i} style={styles.activityRow}>
                <span>{a.title}</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '8px', textTransform: 'capitalize' }}>
                  [{a.column}]
                </span>
                <div style={styles.activityTime}>
                  {formatDistanceToNow(new Date(a.updatedAt), { addSuffix: true })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
