import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import CostSummaryCards from './CostSummaryCards';
import CostByModelChart from './CostByModelChart';
import DailyUsageChart from './DailyUsageChart';
import ModelComparisonTable from './ModelComparisonTable';
import RecentCallsLog from './RecentCallsLog';

export default function CostDashboard() {
  const [summary, setSummary] = useState(null);
  const [dailyData, setDailyData] = useState([]);
  const [modelComparison, setModelComparison] = useState([]);
  const [recentCalls, setRecentCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [daysRange, setDaysRange] = useState(7);

  useEffect(() => {
    loadData();
  }, [daysRange]);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);

      const [summaryData, dailyUsage, comparison, calls] = await Promise.all([
        api.getUsageSummary(),
        api.getDailyUsage(daysRange),
        api.getModelComparison(),
        api.getRecentCalls(20, 0)
      ]);

      setSummary(summaryData);
      setDailyData(dailyUsage);
      setModelComparison(comparison);
      setRecentCalls(calls.calls || []);
    } catch (err) {
      setError(err.message);
      console.error('Failed to load cost dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={styles.loading}>
        <div style={styles.spinner}>⏳</div>
        <div>Loading cost analytics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.error}>
        <div style={styles.errorIcon}>⚠️</div>
        <div style={styles.errorTitle}>Failed to load data</div>
        <div style={styles.errorMessage}>{error}</div>
        <button style={styles.retryButton} onClick={loadData}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>💰 Cost Analytics</h1>
          <p style={styles.subtitle}>
            Track API usage and costs across all LLM providers
          </p>
        </div>
        <div style={styles.controls}>
          <label style={styles.label}>
            Time Range:
            <select
              value={daysRange}
              onChange={(e) => setDaysRange(Number(e.target.value))}
              style={styles.select}
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
          <button onClick={loadData} style={styles.refreshButton}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <CostSummaryCards summary={summary} />

      {/* Charts Row */}
      <div style={styles.chartsRow}>
        <CostByModelChart byModel={summary?.byModel} />
        <DailyUsageChart dailyData={dailyData} />
      </div>

      {/* Model Comparison Table */}
      <ModelComparisonTable data={modelComparison} />

      {/* Recent Calls Log */}
      <RecentCallsLog calls={recentCalls} />
    </div>
  );
}

const styles = {
  container: {
    padding: '24px',
    maxWidth: '1400px',
    margin: '0 auto'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '32px',
    flexWrap: 'wrap',
    gap: '16px'
  },
  title: {
    margin: '0 0 8px 0',
    fontSize: '28px',
    fontWeight: '700',
    color: 'var(--text-primary)'
  },
  subtitle: {
    margin: 0,
    fontSize: '14px',
    color: 'var(--text-secondary)'
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    color: 'var(--text-secondary)'
  },
  select: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '6px 12px',
    color: 'var(--text-primary)',
    fontSize: '13px',
    cursor: 'pointer'
  },
  refreshButton: {
    background: 'var(--accent-blue)',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'opacity 0.2s'
  },
  chartsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
    gap: '24px',
    marginBottom: '24px'
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '400px',
    gap: '16px',
    color: 'var(--text-secondary)'
  },
  spinner: {
    fontSize: '48px',
    animation: 'spin 2s linear infinite'
  },
  error: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '400px',
    gap: '12px',
    padding: '40px'
  },
  errorIcon: {
    fontSize: '48px'
  },
  errorTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: 'var(--text-primary)'
  },
  errorMessage: {
    fontSize: '14px',
    color: 'var(--text-secondary)',
    textAlign: 'center'
  },
  retryButton: {
    background: 'var(--accent-blue)',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '8px'
  }
};
