import React from 'react';

const TAG_COLORS = {
  urgent: '#f85149',
  bug: '#da3633',
  feature: '#58a6ff',
  documentation: '#8b949e',
  agent: '#bc8cff',
  maintenance: '#d29922'
};

export default function TagChip({ tag, onRemove }) {
  const bgColor = TAG_COLORS[tag.toLowerCase()] || 'var(--border-light)';

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '2px 8px',
      borderRadius: '12px',
      fontSize: '11px',
      background: `${bgColor}22`,
      color: bgColor === 'var(--border-light)' ? 'var(--text-secondary)' : bgColor,
      border: `1px solid ${bgColor}44`
    }}>
      {tag}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(tag); }}
          style={{ fontSize: '10px', color: 'inherit', cursor: 'pointer', padding: 0 }}
        >
          {'\u2715'}
        </button>
      )}
    </span>
  );
}
