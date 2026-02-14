import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

export default function CostByModelChart({ byModel }) {
  if (!byModel || Object.keys(byModel).length === 0) {
    return <div style={styles.empty}>No cost data yet</div>;
  }

  const chartData = Object.entries(byModel).map(([model, stats]) => ({
    name: model.split('-').slice(0, 2).join('-'), // Shorten model names
    fullName: model,
    value: stats.cost
  }));

  const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#a4de6c', '#8dd1e1'];

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload[0]) {
      const data = payload[0].payload;
      return (
        <div style={styles.tooltip}>
          <div style={styles.tooltipTitle}>{data.fullName}</div>
          <div style={styles.tooltipValue}>
            Cost: ${data.value.toFixed(6)}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.heading}>Cost Distribution by Model</h3>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={80}
            label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
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
  tooltip: {
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '8px 12px',
    boxShadow: 'var(--shadow)'
  },
  tooltipTitle: {
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    marginBottom: '4px'
  },
  tooltipValue: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    fontFamily: 'monospace'
  },
  empty: {
    padding: '100px 20px',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '14px',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)'
  }
};
