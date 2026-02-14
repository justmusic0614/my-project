export default function CostSummaryCards({ summary }) {
  if (!summary) return null;

  const cards = [
    {
      title: 'Total Cost',
      value: `$${summary.totalCost.toFixed(6)}`,
      color: 'var(--accent-red)',
      icon: '💰'
    },
    {
      title: 'Total Calls',
      value: summary.totalCalls.toLocaleString(),
      color: 'var(--accent-blue)',
      icon: '📞'
    },
    {
      title: 'Avg Cost/Call',
      value: summary.totalCalls > 0
        ? `$${(summary.totalCost / summary.totalCalls).toFixed(6)}`
        : '$0',
      color: 'var(--accent-purple)',
      icon: '📊'
    },
    {
      title: 'Last 24h',
      value: `${summary.last24h.calls} calls ($${summary.last24h.cost.toFixed(6)})`,
      color: 'var(--accent-green)',
      icon: '⏰'
    }
  ];

  return (
    <div style={styles.grid}>
      {cards.map((card, index) => (
        <div key={index} style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.icon}>{card.icon}</span>
            <span style={styles.title}>{card.title}</span>
          </div>
          <div style={{ ...styles.value, color: card.color }}>
            {card.value}
          </div>
        </div>
      ))}
    </div>
  );
}

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '16px',
    marginBottom: '24px'
  },
  card: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '16px',
    transition: 'transform 0.2s, box-shadow 0.2s'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
    color: 'var(--text-secondary)',
    fontSize: '13px',
    fontWeight: '500'
  },
  icon: {
    fontSize: '18px'
  },
  title: {
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  value: {
    fontSize: '24px',
    fontWeight: '600',
    fontFamily: 'monospace'
  }
};
