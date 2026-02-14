import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { api } from '../../api/client';

export default function ABTestHistory({ onSelectTest }) {
  const [tests, setTests] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const limit = 20;

  useEffect(() => {
    loadHistory();
  }, [page]);

  async function loadHistory() {
    try {
      setLoading(true);
      const result = await api.getABTestHistory(limit, page * limit);
      setTests(result.tests || []);
      setTotal(result.total || 0);
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading && tests.length === 0) {
    return (
      <div style={styles.loading}>
        <div style={styles.spinner}>⏳</div>
        <div>Loading test history...</div>
      </div>
    );
  }

  if (tests.length === 0) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyIcon}>🔬</div>
        <div style={styles.emptyTitle}>No tests yet</div>
        <div style={styles.emptyMessage}>
          Run your first A/B test to compare models
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Test History</h3>
        <div style={styles.count}>{total} test{total !== 1 ? 's' : ''} total</div>
      </div>

      <div style={styles.list}>
        {tests.map((test) => (
          <HistoryItem
            key={test.id}
            test={test}
            onClick={() => onSelectTest(test)}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{
              ...styles.paginationButton,
              ...(page === 0 ? styles.paginationButtonDisabled : {})
            }}
          >
            ← Previous
          </button>
          <span style={styles.paginationInfo}>
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={{
              ...styles.paginationButton,
              ...(page >= totalPages - 1 ? styles.paginationButtonDisabled : {})
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function HistoryItem({ test, onClick }) {
  const successCount = test.results.filter(r => r.status === 'success').length;
  const ratedCount = test.results.filter(r => r.rating !== null).length;

  return (
    <div style={styles.item} onClick={onClick}>
      <div style={styles.itemHeader}>
        <div style={styles.itemId}>#{test.id.slice(0, 8)}</div>
        <div style={styles.itemTime}>
          {formatDistanceToNow(new Date(test.timestamp), { addSuffix: true })}
        </div>
      </div>

      <div style={styles.itemPrompt}>{test.prompt}</div>

      <div style={styles.itemMeta}>
        <span style={styles.metaBadge}>
          {test.models.length} models
        </span>
        <span style={styles.metaBadge}>
          {successCount}/{test.results.length} successful
        </span>
        {ratedCount > 0 && (
          <span style={styles.metaBadge}>
            ⭐ {ratedCount} rated
          </span>
        )}
        {test.winner && (
          <span style={{ ...styles.metaBadge, background: 'var(--accent-green)', color: 'white' }}>
            🏆 {test.winner.split('-').slice(0, 2).join('-')}
          </span>
        )}
      </div>
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
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px'
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '600',
    color: 'var(--text-primary)'
  },
  count: {
    fontSize: '13px',
    color: 'var(--text-muted)'
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '20px'
  },
  item: {
    padding: '16px',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  itemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  itemId: {
    fontSize: '12px',
    fontFamily: 'monospace',
    fontWeight: '600',
    color: 'var(--text-secondary)'
  },
  itemTime: {
    fontSize: '11px',
    color: 'var(--text-muted)'
  },
  itemPrompt: {
    fontSize: '13px',
    color: 'var(--text-primary)',
    marginBottom: '12px',
    lineHeight: '1.5',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical'
  },
  itemMeta: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap'
  },
  metaBadge: {
    fontSize: '10px',
    padding: '4px 8px',
    background: 'var(--bg-secondary)',
    borderRadius: '12px',
    fontWeight: '600',
    color: 'var(--text-secondary)'
  },
  pagination: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '16px',
    paddingTop: '16px',
    borderTop: '1px solid var(--border)'
  },
  paginationButton: {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  paginationButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed'
  },
  paginationInfo: {
    fontSize: '13px',
    color: 'var(--text-secondary)'
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
    color: 'var(--text-secondary)'
  }
};
