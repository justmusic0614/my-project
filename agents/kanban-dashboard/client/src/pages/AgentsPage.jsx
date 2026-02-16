import React, { useState } from 'react';
import AgentList from '../components/agents/AgentList';
import AgentDetail from '../components/agents/AgentDetail';
import SystemHealth from '../components/dashboard/SystemHealth';
import Summary from '../components/dashboard/Summary';
import ABTest from '../components/analytics/ABTest';
import AgentModelConfig from '../components/analytics/AgentModelConfig';
import useAgents from '../hooks/useAgents';

// Overview 子組件 - 封裝原有邏輯
function AgentsOverview() {
  const { agents, loading } = useAgents();
  const [selected, setSelected] = useState(null);

  if (loading) {
    return (
      <div style={{ color: 'var(--text-secondary)', padding: '40px', textAlign: 'center' }}>
        Loading agents...
      </div>
    );
  }

  return (
    <div>
      <SystemHealth />
      <Summary />
      <div style={{ marginTop: '20px' }}>
        <AgentList agents={agents} selected={selected} onSelect={setSelected} />
        {selected && <AgentDetail agentName={selected} />}
      </div>
    </div>
  );
}

// 標籤配置
const tabs = [
  { id: 'overview', label: '📊 Overview', component: AgentsOverview },
  { id: 'ab-test', label: '🧪 A/B Test', component: ABTest },
  { id: 'config', label: '⚙️ Agent Config', component: AgentModelConfig }
];

export default function AgentsPage() {
  const [activeTab, setActiveTab] = useState('overview');

  const ActiveComponent = tabs.find(t => t.id === activeTab)?.component || AgentsOverview;

  return (
    <div>
      {/* 標籤導航 */}
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

      {/* 標籤內容 */}
      <ActiveComponent />
    </div>
  );
}
