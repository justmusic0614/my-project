import { useState, useEffect } from 'react';
import { api } from '../../api/client';

export default function ModelLeaderboard() {
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLeaderboard();
  }, []);

  async function loadLeaderboard() {
    try {
      setLoading(true);
      const data = await api.getLeaderboard();
      setLeaderboard(data || []);
    } catch (error) {
      console.error('Failed to load leaderboard:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={styles.loading}>
        <div style={styles.spinner}>⏳</div>
        <div>Loading leaderboard...</div>
      </div>
    );
  }

  if (leaderboard.length === 0) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyIcon}>🏆</div>
        <div style={styles.emptyTitle}>No rankings yet</div>
        <div style={styles.emptyMessage}>
          Complete some A/B tests and rate the results to see model rankings
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Model Leaderboard</h3>
        <p style={styles.subtitle}>
          Rankings based on average user ratings and performance metrics
        </p>
      </div>

      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Rank</th>
              <th style={styles.th}>Model</th>
              <th style={styles.th}>Avg Rating</th>
              <th style={styles.th}>Win Rate</th>
              <th style={styles.th}>Success Rate</th>
              <th style={styles.th}>Avg Cost</th>
              <th style={styles.th}>Avg Latency</th>
              <th style={styles.th}>Total Tests</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((model, index) => (
              <tr key={model.model} style={styles.tr}>
                <td style={styles.td}>
                  <div style={styles.rank}>
                    {index === 0 && '🥇'}
                    {index === 1 && '🥈'}
                    {index === 2 && '🥉'}
                    {index > 2 && `#${index + 1}`}
                  </div>
                </td>
                <td style={styles.td}>
                  <code style={styles.modelId}>{model.model}</code>
                </td>
                <td style={styles.td}>
                  {model.avgRating !== 'N/A' ? (
                    <div style={styles.rating}>
                      <span style={styles.ratingStars}>
                        {'★'.repeat(Math.round(parseFloat(model.avgRating)))}
                      </span>
                      <span style={styles.ratingValue}>{model.avgRating}</span>
                    </div>
                  ) : (
                    <span style={styles.na}>N/A</span>
                  )}
                </td>
                <td style={styles.td}>
                  <span style={{
                    ...styles.badge,
                    background: parseFloat(model.winRate) >= 50 ? 'var(--accent-green)' : 'var(--accent-yellow)'
                  }}>
                    {model.winRate}%
                  </span>
                </td>
                <td style={styles.td}>
                  <span style={{
                    ...styles.badge,
                    background: parseFloat(model.successRate) >= 95 ? 'var(--accent-green)' : 'var(--accent-yellow)'
                  }}>
                    {model.successRate}%
                  </span>
                </td>
                <td style={{ ...styles.td, color: 'var(--accent-red)', fontWeight: '600' }}>
                  ${model.avgCost}
                </td>
                <td style={styles.td}>
                  {model.avgLatency}ms
                </td>
                <td style={styles.td}>
                  {model.totalTests}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button onClick={loadLeaderboard} style={styles.refreshButton}>
        🔄 Refresh
      </button>
    </div>
  );
}

const styles = {
  container: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '20px'
  },
  header: {
    marginBottom: '20px'
  },
  title: {
    margin: '0 0 8px 0',
    fontSize: '18px',
    fontWeight: '600',
    color: 'var(--text-primary)'
  },
  subtitle: {
    margin: 0,
    fontSize: '13px',
    color: 'var(--text-secondary)'
  },
  tableWrapper: {
    overflowX: 'auto',
    marginBottom: '16px'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px'
  },
  th: {
    textAlign: 'left',
    padding: '12px',
    borderBottom: '2px solid var(--border)',
    color: 'var(--text-secondary)',
    fontWeight: '600',
    textTransform: 'uppercase',
    fontSize: '11px',
    letterSpacing: '0.5px'
  },
  tr: {
    borderBottom: '1px solid var(--border)'
  },
  td: {
    padding: '12px',
    color: 'var(--text-primary)'
  },
  rank: {
    fontSize: '16px',
    fontWeight: '700'
  },
  modelId: {
    background: 'var(--bg-tertiary)',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontFamily: 'monospace'
  },
  rating: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  ratingStars: {
    color: 'var(--accent-yellow)',
    fontSize: '14px'
  },
  ratingValue: {
    fontSize: '13px',
    fontWeight: '600',
    color: 'var(--text-primary)'
  },
  badge: {
    padding: '4px 8px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: '600',
    color: 'white'
  },
  na: {
    color: 'var(--text-muted)',
    fontSize: '12px',
    fontStyle: 'italic'
  },
  refreshButton: {
    width: '100%',
    padding: '10px',
    fontSize: '13px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '300px',
    gap: '16px',
    color: 'var(--text-secondary)'
  },
  spinner: {
    fontSize: '48px'
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '300px',
    gap: '12px'
  },
  emptyIcon: {
    fontSize: '64px'
  },
  emptyTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: 'var(--text-primary)'
  },
  emptyMessage: {
    fontSize: '14px',
    color: 'var(--text-secondary)',
    textAlign: 'center',
    maxWidth: '400px'
  }
};
