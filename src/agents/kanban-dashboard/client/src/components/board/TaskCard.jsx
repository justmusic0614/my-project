import React from 'react';
import { formatDistanceToNow, isPast, differenceInDays } from 'date-fns';
import PriorityBadge from '../common/PriorityBadge';
import TagChip from '../common/TagChip';

export default function TaskCard({ task, isDragging, dragHandlers, onClick }) {
  const dueClass = task.dueDate ? getDueClass(task.dueDate) : '';

  return (
    <div
      className={`task-card${isDragging ? ' task-card--dragging' : ''}${task.isPinned ? ' task-card--pinned' : ''}`}
      onClick={() => onClick && onClick(task)}
      {...dragHandlers}
    >
      <div className="task-card-meta">
        <PriorityBadge priority={task.priority} showLabel />
        {task.dueDate && (
          <span className={`task-card-due ${dueClass}`}>
            {formatDue(task.dueDate)}
          </span>
        )}
      </div>
      <div className="task-card-title">{task.title}</div>
      {task.tags && task.tags.length > 0 && (
        <div className="task-card-tags">
          {task.tags.map(tag => <TagChip key={tag} tag={tag} />)}
        </div>
      )}
      <div className="task-card-footer">
        {task.comments && task.comments.length > 0 && (
          <span>{'\u{1F4AC}'} {task.comments.length}</span>
        )}
        {task.attachments && task.attachments.length > 0 && (
          <span>{'\u{1F4CE}'} {task.attachments.length}</span>
        )}
      </div>
    </div>
  );
}

function getDueClass(dueDate) {
  const d = new Date(dueDate);
  if (isPast(d)) return 'task-card-due--overdue';
  if (differenceInDays(d, new Date()) < 3) return 'task-card-due--soon';
  return '';
}

function formatDue(dueDate) {
  const d = new Date(dueDate);
  if (isPast(d)) return 'Overdue';
  return formatDistanceToNow(d, { addSuffix: true });
}
