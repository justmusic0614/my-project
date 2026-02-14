import React, { useState, useEffect } from 'react';
import { format, addDays, startOfWeek } from 'date-fns';
import ScheduleBlock from './ScheduleBlock';
import HighFrequencyPanel from './HighFrequencyPanel';
import { api } from '../../api/client';
import { classifyAgentByFrequency } from '../../utils/agent-classifier';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function WeeklyCalendar({ onAgentClick }) {
  const [weekStart, setWeekStart] = useState(() => {
    const now = new Date();
    return startOfWeek(now, { weekStartsOn: 1 });
  });
  const [schedule, setSchedule] = useState([]);
  const [agents, setAgents] = useState([]);

  useEffect(() => {
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

  return (
    <div>
      <div className="calendar-nav">
        <button className="calendar-nav-btn" onClick={prevWeek}>{'\u2190'}</button>
        <button className="calendar-nav-btn" onClick={today}>Today</button>
        <button className="calendar-nav-btn" onClick={nextWeek}>{'\u2192'}</button>
        <span className="calendar-week-label">{weekLabel}</span>
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
        {HOURS.map(hour => (
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
              const cellHeight = Math.max(40, blocks.length * 24); // Dynamic height

              return (
                <div
                  key={dayIdx}
                  className="calendar-cell"
                  style={{
                    height: `${cellHeight}px`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    padding: '2px'
                  }}
                >
                  {blocks.map((entry, bi) => (
                    <ScheduleBlock
                      key={`${entry.agent}-${bi}`}
                      entry={entry}
                      onClick={() => onAgentClick && onAgentClick(entry.agent)}
                    />
                  ))}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* High-Frequency Tasks Panel */}
      <HighFrequencyPanel
        agents={agents}
        onAgentClick={onAgentClick}
      />
    </div>
  );
}
