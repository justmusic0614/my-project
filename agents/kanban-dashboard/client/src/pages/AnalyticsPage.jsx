import React, { useState } from 'react';
import CostDashboard from '../components/analytics/CostDashboard';
import ABTest from '../components/analytics/ABTest';
import AgentModelConfig from '../components/analytics/AgentModelConfig';

const tabs = [
  { id: 'cost', label: '💰 Cost Dashboard', component: CostDashboard },
  { id: 'ab-test', label: '🧪 A/B Test', component: ABTest },
  { id: 'config', label: '⚙️ Agent Config', component: AgentModelConfig }
];

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState('cost');

  const ActiveComponent = tabs.find(t => t.id === activeTab)?.component || CostDashboard;

  return (
    <div>
      <div style={{
        display: 'flex',
        gap: '8px',
        borderBottom: '1px solid var(--border)',
        marginBottom: '20px',
        padding: '0 4px'
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 20px',
              background: activeTab === tab.id ? 'var(--bg-primary)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent-blue)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: activeTab === tab.id ? 600 : 400,
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all 0.2s'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <ActiveComponent />
    </div>
  );
}
