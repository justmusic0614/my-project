import React, { useEffect } from 'react';
import { addDays, format } from 'date-fns';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ScheduleOverrideModal({ isOpen, onClose, onConfirm, dropData, weekStart }) {
  useEffect(() => {
    if (!isOpen) return;

    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen || !dropData) return null;

  const { data, dayIdx, hour, newStart } = dropData;
  const dayDate = addDays(weekStart, dayIdx);
  const dayName = DAYS[dayDate.getDay()];
  const dateStr = format(dayDate, 'M/d');
  const timeStr = String((hour + 8) % 24).padStart(2, '0') + ':00';

  // Shorten agent name
  const shortName = data.agent.replace('kanban-', '').replace('knowledge-', 'know-');

  return (
    <div className="schedule-override-modal-backdrop" onClick={onClose}>
      <div className="schedule-override-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Move Schedule</h3>
        <div className="schedule-override-modal-info">
          <p><strong>{data.agent}</strong></p>
          <p>
            to <strong>{dayName} {dateStr} {timeStr}</strong>
          </p>
        </div>
        <div className="schedule-override-modal-actions">
          <button
            className="schedule-override-modal-btn schedule-override-modal-btn-single"
            onClick={() => onConfirm('single')}
          >
            Single
          </button>
          <button
            className="schedule-override-modal-btn schedule-override-modal-btn-recurring"
            onClick={() => onConfirm('recurring')}
          >
            Recurring (4 weeks)
          </button>
        </div>
      </div>
    </div>
  );
}
