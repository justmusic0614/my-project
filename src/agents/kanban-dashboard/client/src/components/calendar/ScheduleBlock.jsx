import React from 'react';
import { formatTaipeiTime } from '../../utils/timezone';

// HSL color wheel for better distinction (9 agents = 40° apart)
function hashColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }

  // Use HSL: hue varies, saturation/lightness fixed for dark theme
  const hue = Math.abs(hash) % 360;
  const saturation = 70; // Rich colors
  const lightness = 60;  // Bright enough on dark bg

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export default function ScheduleBlock({ entry, onClick, dragProps, isDragging }) {
  const color = hashColor(entry.agent);
  const time = formatTaipeiTime(entry.start, 'HH:mm');
  const isOverride = entry.type === 'override';

  // Shorten agent name for display
  const shortName = entry.agent.replace('kanban-', '').replace('knowledge-', 'know-');

  const className = [
    'schedule-block',
    isDragging && 'schedule-block--dragging',
    isOverride && 'schedule-block--overridden'
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      style={{
        background: `${color}22`,
        borderLeft: `3px solid ${color}`,
        color: color
      }}
      onClick={() => onClick && onClick(entry.agent)}
      title={`${entry.agent}\n${time}${isOverride ? ' (moved)' : ''}`}
      {...(dragProps || {})}
    >
      <span className="schedule-block-name">
        {isOverride && '\u21C4 '}{shortName}
      </span>
    </div>
  );
}
