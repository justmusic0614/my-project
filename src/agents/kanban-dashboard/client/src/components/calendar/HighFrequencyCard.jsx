import React from 'react';
import { formatTaipeiTime } from '../../utils/timezone';
import { getFrequencyDescription } from '../../utils/agent-classifier';

export default function HighFrequencyCard({ agent, onAgentClick }) {
  const frequencyDesc = getFrequencyDescription(agent.cron);
  const nextRunTime = agent.nextRun
    ? formatTaipeiTime(agent.nextRun, 'yyyy/MM/dd HH:mm')
    : 'N/A';

  // 計算每天執行次數
  const dailyCount = agent.cron.startsWith('*/30') ? 48
    : agent.cron.includes('0 * * * *') ? 24
    : agent.cron.includes('/2') ? 12
    : 1;

  return (
    <div
      className="high-frequency-card"
      onClick={() => onAgentClick?.(agent.name)}
    >
      <div className="card-header">
        <span className="agent-name">{agent.name}</span>
      </div>
      <div className="card-body">
        <div className="frequency">
          🔄 {frequencyDesc} ({dailyCount}×/day)
        </div>
        <div className="next-run">
          Next: {nextRunTime} TPE
        </div>
      </div>
    </div>
  );
}
