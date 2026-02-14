import { formatDistanceToNow } from 'date-fns';

export default function RecentCallsLog({ calls }) {
  if (!calls || calls.length === 0) {
    return <div style={styles.empty}>No recent calls</div>;
  }

  return (
    <div style={styles.container}>
      <h3 style={styles.heading}>Recent API Calls</h3>
      <div style={styles.list}>
        {calls.map((call) => (
          <div key={call.id} style={styles.item}>
            <div style={styles.itemHeader}>
              <code style={styles.model}>{call.model}</code>
              <span style={{
                ...styles.status,
                background: call.status === 'success' ? 'var(--accent-green)' : 'var(--accent-red)'
              }}>
                {call.status}
              </span>
            </div>
            <div style={styles.itemDetails}>
              <span style={styles.detail}>
                <span style={styles.label}>Source:</span> {call.source}
              </span>
              <span style={styles.detail}>
                <span style={styles.label}>Tokens:</span> {call.usage.inputTokens}→{call.usage.outputTokens}
              </span>
              <span style={styles.detail}>
                <span style={styles.label}>Cost:</span> ${call.cost.total.toFixed(6)}
              </span>
              <span style={styles.detail}>
                <span style={styles.label}>Latency:</span> {call.latency}ms
              </span>
              <span style={styles.detail}>
                <span style={styles.label}>Time:</span> {formatDistanceToNow(new Date(call.timestamp), { addSuffix: true })}
              </span>
            </div>
          </div>
        ))}
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
  heading: {
    margin: '0 0 16px 0',
    fontSize: '16px',
    fontWeight: '600',
    color: 'var(--text-primary)'
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    maxHeight: '400px',
    overflowY: 'auto'
  },
  item: {
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '12px',
    transition: 'transform 0.1s'
  },
  itemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  model: {
    fontSize: '12px',
    fontFamily: 'monospace',
    color: 'var(--text-primary)',
    fontWeight: '600'
  },
  status: {
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '10px',
    fontWeight: '600',
    color: 'white',
    textTransform: 'uppercase'
  },
  itemDetails: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    fontSize: '11px',
    color: 'var(--text-secondary)'
  },
  detail: {
    fontFamily: 'monospace'
  },
  label: {
    color: 'var(--text-muted)',
    marginRight: '4px'
  },
  empty: {
    padding: '40px',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '14px',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)'
  }
};
