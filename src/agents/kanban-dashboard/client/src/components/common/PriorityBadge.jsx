import React from 'react';

const PRIORITY_COLORS = {
  critical: 'var(--accent-red)',
  high: 'var(--accent-orange)',
  medium: 'var(--accent-blue)',
  low: 'var(--text-muted)'
};

const PRIORITY_LABELS = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low'
};

export default function PriorityBadge({ priority, showLabel = false }) {
  const color = PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium;

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      fontSize: '11px',
      color
    }}>
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: color,
        flexShrink: 0
      }} />
      {showLabel && <span>{PRIORITY_LABELS[priority] || priority}</span>}
    </span>
  );
}

export { PRIORITY_COLORS };
