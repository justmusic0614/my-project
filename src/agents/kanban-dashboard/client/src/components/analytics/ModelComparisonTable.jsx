export default function ModelComparisonTable({ data }) {
  if (!data || data.length === 0) {
    return <div style={styles.empty}>No usage data yet</div>;
  }

  return (
    <div style={styles.container}>
      <h3 style={styles.heading}>Model Comparison</h3>
      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Model</th>
              <th style={styles.th}>Calls</th>
              <th style={styles.th}>Cost</th>
              <th style={styles.th}>Avg Latency</th>
              <th style={styles.th}>Success Rate</th>
            </tr>
          </thead>
          <tbody>
            {data.map((model, index) => (
              <tr key={index} style={styles.tr}>
                <td style={styles.td}>
                  <code style={styles.modelId}>{model.model}</code>
                </td>
                <td style={styles.td}>{model.calls}</td>
                <td style={{ ...styles.td, color: 'var(--accent-red)', fontWeight: '600' }}>
                  ${model.cost.toFixed(6)}
                </td>
                <td style={styles.td}>{model.avgLatency}ms</td>
                <td style={styles.td}>
                  <span style={{
                    ...styles.badge,
                    background: parseFloat(model.successRate) >= 95
                      ? 'var(--accent-green)'
                      : 'var(--accent-yellow)'
                  }}>
                    {model.successRate}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const styles = {
  container: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '20px',
    marginBottom: '24px'
  },
  heading: {
    margin: '0 0 16px 0',
    fontSize: '16px',
    fontWeight: '600',
    color: 'var(--text-primary)'
  },
  tableWrapper: {
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px'
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
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
  modelId: {
    background: 'var(--bg-tertiary)',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontFamily: 'monospace'
  },
  badge: {
    padding: '4px 8px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: '600',
    color: 'white'
  },
  empty: {
    padding: '40px',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '14px'
  }
};
