import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import ABTestForm from './ABTestForm';
import ABTestResults from './ABTestResults';
import ABTestHistory from './ABTestHistory';
import ModelLeaderboard from './ModelLeaderboard';

export default function ABTest() {
  const [activeTab, setActiveTab] = useState('new'); // 'new', 'history', 'leaderboard'
  const [currentTest, setCurrentTest] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleRunTest(prompt, models, maxTokens) {
    setLoading(true);
    try {
      const result = await api.runABTest(prompt, models, maxTokens);
      setCurrentTest(result);
      setActiveTab('results');
    } catch (error) {
      alert(`Test failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleRate(modelId, rating) {
    if (!currentTest) return;

    try {
      const updated = await api.rateABTest(currentTest.id, modelId, rating);
      setCurrentTest(updated);
    } catch (error) {
      alert(`Rating failed: ${error.message}`);
    }
  }

  function handleNewTest() {
    setCurrentTest(null);
    setActiveTab('new');
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>🔬 A/B Testing</h1>
          <p style={styles.subtitle}>
            Compare multiple LLM models side-by-side and rate their outputs
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'new' ? styles.tabActive : {})
          }}
          onClick={() => setActiveTab('new')}
        >
          New Test
        </button>
        {currentTest && (
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'results' ? styles.tabActive : {})
            }}
            onClick={() => setActiveTab('results')}
          >
            Current Results
          </button>
        )}
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'history' ? styles.tabActive : {})
          }}
          onClick={() => setActiveTab('history')}
        >
          History
        </button>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'leaderboard' ? styles.tabActive : {})
          }}
          onClick={() => setActiveTab('leaderboard')}
        >
          Leaderboard
        </button>
      </div>

      {/* Content */}
      <div style={styles.content}>
        {activeTab === 'new' && (
          <ABTestForm onRun={handleRunTest} loading={loading} />
        )}

        {activeTab === 'results' && currentTest && (
          <ABTestResults
            test={currentTest}
            onRate={handleRate}
            onNewTest={handleNewTest}
          />
        )}

        {activeTab === 'history' && (
          <ABTestHistory onSelectTest={(test) => {
            setCurrentTest(test);
            setActiveTab('results');
          }} />
        )}

        {activeTab === 'leaderboard' && (
          <ModelLeaderboard />
        )}
      </div>
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
    marginBottom: '24px'
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
  tabs: {
    display: 'flex',
    gap: '8px',
    marginBottom: '24px',
    borderBottom: '1px solid var(--border)'
  },
  tab: {
    background: 'none',
    border: 'none',
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: '500',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    transition: 'all 0.2s'
  },
  tabActive: {
    color: 'var(--accent-blue)',
    borderBottomColor: 'var(--accent-blue)'
  },
  content: {
    minHeight: '400px'
  }
};
