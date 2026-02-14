import React from 'react';
import HighFrequencyCard from './HighFrequencyCard';
import { classifyAgentByFrequency } from '../../utils/agent-classifier';

export default function HighFrequencyPanel({ agents, onAgentClick }) {
  const highFreqAgents = agents.filter(a =>
    classifyAgentByFrequency(a.cron) === 'high-frequency'
  );

  if (highFreqAgents.length === 0) return null;

  return (
    <div className="high-frequency-panel">
      <h3>📊 High-Frequency Scheduled Tasks</h3>
      <div className="high-frequency-cards">
        {highFreqAgents.map(agent => (
          <HighFrequencyCard
            key={agent.name}
            agent={agent}
            onAgentClick={onAgentClick}
          />
        ))}
      </div>
    </div>
  );
}
