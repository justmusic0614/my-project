import React, { useState } from 'react';
import AgentList from '../components/agents/AgentList';
import AgentDetail from '../components/agents/AgentDetail';
import SystemHealth from '../components/dashboard/SystemHealth';
import Summary from '../components/dashboard/Summary';
import useAgents from '../hooks/useAgents';

export default function AgentsPage() {
  const { agents, loading } = useAgents();
  const [selected, setSelected] = useState(null);

  if (loading) {
    return <div style={{ color: 'var(--text-secondary)', padding: '40px', textAlign: 'center' }}>Loading agents...</div>;
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
