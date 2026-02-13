import React from 'react';
import { format } from 'date-fns';

// Deterministic color from agent name
const AGENT_COLORS = [
  '#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f85149',
  '#e3b341', '#79c0ff', '#56d364', '#db6d28', '#d2a8ff'
];

function hashColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

export default function ScheduleBlock({ entry, style, onClick }) {
  const color = hashColor(entry.agent);
  const time = format(new Date(entry.start), 'HH:mm');

  return (
    <div
      className="schedule-block"
      style={{
        ...style,
        background: `${color}33`,
        color: color,
        borderLeft: `3px solid ${color}`
      }}
      onClick={() => onClick && onClick(entry)}
      title={`${entry.agent} at ${time}`}
    >
      <span>{entry.agent}</span>
      <br />
      <span className="schedule-block-time">{time}</span>
    </div>
  );
}
