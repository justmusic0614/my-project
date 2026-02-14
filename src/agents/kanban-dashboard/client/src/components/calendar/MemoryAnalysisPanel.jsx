import React, { useMemo, useEffect, useState } from 'react';
import { addDays } from 'date-fns';
import { api } from '../../api/client';

const DEFAULT_ESTIMATES = {
  'knowledge-digest': 120,
  'market-digest': 100,
  'deploy-monitor': 50,
  'security-patrol': 80,
  'optimization-advisor': 150
};

const DEFAULT_SYSTEM = {
  baseMB: 400,
  kanbanMB: 150,
  totalRamMB: 2048,
  availableMB: 1100
};

function getAgentMemory(agentName, estimates) {
  return estimates[agentName] || 80; // default 80MB for unknown agents
}

export default function MemoryAnalysisPanel({ schedule, agents, highlightCell, weekStart }) {
  const [estimates, setEstimates] = useState(DEFAULT_ESTIMATES);
  const [system, setSystem] = useState(DEFAULT_SYSTEM);

  useEffect(() => {
    api.getMemoryEstimates()
      .then(data => {
        if (data.agents) setEstimates(data.agents);
        if (data.system) setSystem(data.system);
      })
      .catch(() => {}); // Use defaults on error
  }, []);

  // Helper: get agents running at a specific day+hour
  const getAgentsAtSlot = (dayIdx, hour) => {
    const dayDate = addDays(weekStart, dayIdx);
    return schedule.filter(entry => {
      const d = new Date(entry.start);
      return d.getDate() === dayDate.getDate() &&
             d.getMonth() === dayDate.getMonth() &&
             d.getHours() === hour;
    });
  };

  // Static: weekly peak analysis
  const peakAnalysis = useMemo(() => {
    let peak = { totalMB: 0, agents: [], dayIdx: 0, hour: 0 };

    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      for (let hour = 0; hour < 24; hour++) {
        const slotAgents = getAgentsAtSlot(dayIdx, hour);
        if (slotAgents.length === 0) continue;

        const agentMemory = slotAgents.reduce(
          (sum, e) => sum + getAgentMemory(e.agent, estimates), 0
        );
        const totalMB = system.baseMB + system.kanbanMB + agentMemory;

        if (totalMB > peak.totalMB) {
          peak = { totalMB, agents: slotAgents, dayIdx, hour };
        }
      }
    }

    return peak;
  }, [schedule, estimates, system, weekStart]);

  // Dynamic: analysis for drag-over cell
  const dynamicAnalysis = useMemo(() => {
    if (!highlightCell) return null;

    const { dayIdx, hour } = highlightCell;
    const slotAgents = getAgentsAtSlot(dayIdx, hour);

    const agentDetails = slotAgents.map(e => ({
      name: e.agent,
      mb: getAgentMemory(e.agent, estimates)
    }));

    const agentMemory = agentDetails.reduce((sum, a) => sum + a.mb, 0);
    const totalMB = system.baseMB + system.kanbanMB + agentMemory;
    const pct = Math.round((totalMB / system.totalRamMB) * 100);
    const overflowMB = totalMB > system.totalRamMB ? totalMB - system.totalRamMB : 0;

    return { totalMB, pct, agentDetails, overflowMB, dayIdx, hour };
  }, [highlightCell, schedule, estimates, system, weekStart]);

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const peakPct = Math.round((peakAnalysis.totalMB / system.totalRamMB) * 100);
  const peakStatus = peakPct >= 100 ? 'danger' : peakPct >= 80 ? 'warning' : 'safe';

  return (
    <div className="memory-analysis-panel">
      <h3>Memory Analysis</h3>

      {/* Static: Weekly Peak */}
      <div className="memory-section">
        <div className="memory-section-title">Weekly Peak</div>
        {peakAnalysis.totalMB === 0 ? (
          <div className="memory-no-data">No scheduled tasks this week</div>
        ) : (
          <>
            <div className="memory-bar-container">
              <div
                className={`memory-bar-fill memory-${peakStatus}`}
                style={{ width: `${Math.min(pctBar(peakPct), 100)}%` }}
              />
              <span className="memory-bar-label">{peakPct}%</span>
            </div>
            <div className="memory-detail">
              {peakAnalysis.totalMB} MB / {system.totalRamMB} MB
              {' \u2014 '}
              {DAYS[peakAnalysis.dayIdx]} {String((peakAnalysis.hour + 8) % 24).padStart(2, '0')}:00
              {' \u2014 '}
              {peakAnalysis.agents.length} agent{peakAnalysis.agents.length > 1 ? 's' : ''}
            </div>
          </>
        )}
      </div>

      {/* Dynamic: Drag-over analysis */}
      {dynamicAnalysis && (
        <div className="memory-section memory-dynamic">
          <div className="memory-section-title">
            Drop Target: {DAYS[dynamicAnalysis.dayIdx]} {String((dynamicAnalysis.hour + 8) % 24).padStart(2, '0')}:00
          </div>
          <div className="memory-bar-container">
            <div
              className={`memory-bar-fill memory-${dynamicAnalysis.pct >= 100 ? 'danger' : dynamicAnalysis.pct >= 80 ? 'warning' : 'safe'}`}
              style={{ width: `${Math.min(pctBar(dynamicAnalysis.pct), 100)}%` }}
            />
            <span className="memory-bar-label">{dynamicAnalysis.pct}%</span>
          </div>
          <div className="memory-detail">
            {dynamicAnalysis.totalMB} MB / {system.totalRamMB} MB
          </div>

          {/* Agent breakdown */}
          <div className="memory-breakdown">
            <div className="memory-breakdown-row memory-breakdown-system">
              <span>System + Kanban</span>
              <span>{system.baseMB + system.kanbanMB} MB</span>
            </div>
            {dynamicAnalysis.agentDetails.map(a => (
              <div key={a.name} className="memory-breakdown-row">
                <span>{a.name}</span>
                <span>{a.mb} MB</span>
              </div>
            ))}
          </div>

          {/* OOM Warning */}
          {dynamicAnalysis.overflowMB > 0 && (
            <div className="memory-oom-warning">
              OOM Risk! Exceeds RAM by {dynamicAnalysis.overflowMB} MB.
              PM2 will restart processes when memory limit (150MB) is hit.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function pctBar(pct) {
  return Math.max(5, pct); // minimum 5% width for visibility
}
