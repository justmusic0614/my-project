import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function DailyUsageChart({ dailyData }) {
  if (!dailyData || dailyData.length === 0) {
    return <div style={styles.empty}>No daily data yet</div>;
  }

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div style={styles.tooltip}>
          <div style={styles.tooltipTitle}>{label}</div>
          <div style={styles.tooltipValue}>
            Calls: {payload[0].value}
          </div>
          <div style={styles.tooltipValue}>
            Cost: ${payload[1].value.toFixed(6)}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.heading}>Daily Usage Trend</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={dailyData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            stroke="var(--text-secondary)"
            style={{ fontSize: '11px' }}
          />
          <YAxis
            yAxisId="left"
            stroke="var(--accent-blue)"
            style={{ fontSize: '11px' }}
            label={{ value: 'Calls', angle: -90, position: 'insideLeft', style: { fill: 'var(--accent-blue)' } }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="var(--accent-red)"
            style={{ fontSize: '11px' }}
            label={{ value: 'Cost ($)', angle: 90, position: 'insideRight', style: { fill: 'var(--accent-red)' } }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="calls"
            stroke="var(--accent-blue)"
            strokeWidth={2}
            dot={{ fill: 'var(--accent-blue)' }}
            name="Calls"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="cost"
            stroke="var(--accent-red)"
            strokeWidth={2}
            dot={{ fill: 'var(--accent-red)' }}
            name="Cost"
          />
        </LineChart>
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
