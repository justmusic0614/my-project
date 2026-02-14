import React, { useState, useEffect, useCallback } from 'react';
import { format, addDays, startOfWeek } from 'date-fns';
import ScheduleBlock from './ScheduleBlock';
import HighFrequencyPanel from './HighFrequencyPanel';
import MemoryAnalysisPanel from './MemoryAnalysisPanel';
import { api } from '../../api/client';
import { classifyAgentByFrequency } from '../../utils/agent-classifier';
import useCalendarDragDrop from '../../hooks/useCalendarDragDrop';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function WeeklyCalendar({ onAgentClick }) {
  const [weekStart, setWeekStart] = useState(() => {
    const now = new Date();
    return startOfWeek(now, { weekStartsOn: 1 });
  });
  const [schedule, setSchedule] = useState([]);
  const [agents, setAgents] = useState([]);
  const [showEmptyHours, setShowEmptyHours] = useState(false);

  const fetchData = useCallback(() => {
    const weekStr = format(weekStart, 'yyyy-MM-dd');
    Promise.all([
      api.getAgentSchedule(weekStr),
      api.getAgentsStatus()
    ])
      .then(([scheduleData, agentsData]) => {
        setSchedule(scheduleData.schedule || []);
        setAgents(agentsData.agents || []);
      })
      .catch(err => {
        console.error('Failed to load calendar data:', err);
        setSchedule([]);
        setAgents([]);
      });
  }, [weekStart]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Drag-drop handler
  const handleScheduleDrop = useCallback((data, dayIdx, hour) => {
    const newDay = addDays(weekStart, dayIdx);
    const newStart = new Date(newDay);
    newStart.setHours(hour, 0, 0, 0);

    const originalStart = data.originalStart || data.start;

    // Skip if dropped to same position
    if (new Date(originalStart).getTime() === newStart.getTime()) return;

    // Optimistic update
    setSchedule(prev => prev.map(entry => {
      if (entry.agent === data.agent && entry.start === data.start) {
        return {
          ...entry,
          start: newStart.toISOString(),
          originalStart: originalStart,
          type: 'override'
        };
      }
      return entry;
    }));

    // Persist to backend
    api.createScheduleOverride({
      agent: data.agent,
      originalStart: originalStart,
      newStart: newStart.toISOString()
    }).catch(() => {
      // Rollback on failure
      fetchData();
    });
  }, [weekStart, fetchData]);

  const { draggedEntry, dragOverCell, dragHandlers, dropHandlers } = useCalendarDragDrop(handleScheduleDrop);

  const prevWeek = () => setWeekStart(prev => addDays(prev, -7));
  const nextWeek = () => setWeekStart(prev => addDays(prev, 7));
  const today = () => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));

  const weekEnd = addDays(weekStart, 6);
  const weekLabel = `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;

  // Get low-frequency agent names for filtering
  const lowFreqAgentNames = agents
    .filter(a => classifyAgentByFrequency(a.cron) === 'low-frequency')
    .map(a => a.name);

  // Group schedule by day and hour (only low-frequency tasks)
  const getBlocksForCell = (dayIdx, hour) => {
    const dayDate = addDays(weekStart, dayIdx);
    return schedule.filter(entry => {
      const d = new Date(entry.start);

      // Only show low-frequency tasks in main calendar
      if (!lowFreqAgentNames.includes(entry.agent)) {
        return false;
      }

      return d.getDate() === dayDate.getDate() &&
             d.getMonth() === dayDate.getMonth() &&
             d.getHours() === hour;
    });
  };

  // Check if an hour has no tasks for the entire week
  const isHourEmpty = (hour) => {
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      if (getBlocksForCell(dayIdx, hour).length > 0) {
        return false; // Has tasks on at least one day
      }
    }
    return true; // No tasks for the entire week
  };

  // Filter hours and check for empty hours
  const visibleHours = showEmptyHours
    ? HOURS
    : HOURS.filter(hour => !isHourEmpty(hour));
  const hasEmptyHours = HOURS.some(hour => isHourEmpty(hour));

  return (
    <div>
      <div className="calendar-nav">
        <button className="calendar-nav-btn" onClick={prevWeek}>{'\u2190'}</button>
        <button className="calendar-nav-btn" onClick={today}>Today</button>
        <button className="calendar-nav-btn" onClick={nextWeek}>{'\u2192'}</button>
        <span className="calendar-week-label">{weekLabel}</span>

        {/* Toggle empty hours button */}
        {hasEmptyHours && (
          <button
            className="calendar-nav-btn calendar-toggle-empty"
            onClick={() => setShowEmptyHours(!showEmptyHours)}
            title={showEmptyHours ? 'Hide empty hours' : 'Show all hours'}
          >
            {showEmptyHours ? '\uD83D\uDDDC\uFE0F Compact' : '\uD83D\uDCC5 Expand'}
          </button>
        )}
      </div>

      <div className="calendar-grid" style={{ maxHeight: 'calc(100vh - 200px)', overflow: 'auto' }}>
        {/* Header row */}
        <div className="calendar-corner" />
        {DAYS.map((day, i) => {
          const d = addDays(weekStart, i);
          return (
            <div key={day} className="calendar-day-header">
              <div>{day}</div>
              <div className="calendar-day-header-date">{format(d, 'M/d')}</div>
            </div>
          );
        })}

        {/* Time rows */}
        {visibleHours.map(hour => (
          <React.Fragment key={hour}>
            {(() => {
              // Calculate max blocks in this hour across all days
              const maxBlocks = Math.max(1, ...Array.from({ length: 7 }, (_, dayIdx) =>
                getBlocksForCell(dayIdx, hour).length
              ));
              const rowHeight = Math.max(40, maxBlocks * 24);

              return (
                <div
                  className="calendar-time-label"
                  style={{ height: `${rowHeight}px` }}
                >
                  {String((hour + 8) % 24).padStart(2, '0')}:00
                </div>
              );
            })()}
            {Array.from({ length: 7 }, (_, dayIdx) => {
              const blocks = getBlocksForCell(dayIdx, hour);
              const cellHeight = Math.max(40, blocks.length * 24);
              const isDropTarget = dragOverCell &&
                dragOverCell.dayIdx === dayIdx &&
                dragOverCell.hour === hour;

              return (
                <div
                  key={dayIdx}
                  className={`calendar-cell${isDropTarget ? ' calendar-cell--drop-target' : ''}`}
                  style={{
                    height: `${cellHeight}px`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    padding: '2px'
                  }}
                  {...dropHandlers(dayIdx, hour)}
                >
                  {blocks.map((entry, bi) => (
                    <ScheduleBlock
                      key={`${entry.agent}-${bi}`}
                      entry={entry}
                      onClick={() => onAgentClick && onAgentClick(entry.agent)}
                      dragProps={dragHandlers(entry)}
                      isDragging={draggedEntry && draggedEntry.agent === entry.agent && draggedEntry.start === entry.start}
                    />
                  ))}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* Empty state: shown when no tasks this week */}
      {visibleHours.length === 0 && !showEmptyHours && (
        <div className="calendar-empty-state">
          <p>{'\uD83D\uDCED'} No scheduled tasks this week</p>
          <p className="calendar-empty-hint">
            Click "{'\uD83D\uDCC5'} Expand" to view full calendar
          </p>
        </div>
      )}

      {/* High-Frequency Tasks Panel */}
      <HighFrequencyPanel
        agents={agents}
        onAgentClick={onAgentClick}
      />

      {/* Memory OOM Analysis Panel */}
      <MemoryAnalysisPanel
        schedule={schedule}
        agents={agents}
        highlightCell={dragOverCell}
        weekStart={weekStart}
      />
    </div>
  );
}
