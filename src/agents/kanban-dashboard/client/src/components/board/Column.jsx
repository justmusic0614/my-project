import React from 'react';
import TaskCard from './TaskCard';

const COLUMN_LABELS = {
  todo: { icon: '\u{1F4CB}', label: 'Todo' },
  ongoing: { icon: '\u{1F504}', label: 'Ongoing' },
  pending: { icon: '\u23F3', label: 'Pending' },
  review: { icon: '\u{1F440}', label: 'Review' },
  done: { icon: '\u2705', label: 'Done' },
  archive: { icon: '\u{1F4E6}', label: 'Archive' }
};

export default function Column({ column, tasks, isDragOver, dropHandlers, dragHandlers, draggedId, onTaskClick }) {
  const info = COLUMN_LABELS[column] || { icon: '', label: column };
  const sorted = [...tasks].sort((a, b) => {
    // Pinned first
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return (a.order || 0) - (b.order || 0);
  });

  return (
    <div className={`column${isDragOver ? ' column--drag-over' : ''}`} {...dropHandlers}>
      <div className="column-header">
        <span className="column-title">{info.icon} {info.label}</span>
        <span className="column-count">{tasks.length}</span>
      </div>
      <div className="column-body">
        {sorted.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            isDragging={task.id === draggedId}
            dragHandlers={dragHandlers(task.id)}
            onClick={onTaskClick}
          />
        ))}
      </div>
    </div>
  );
}
