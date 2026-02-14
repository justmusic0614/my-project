import { useState, useCallback } from 'react';

export default function useCalendarDragDrop(onDrop) {
  const [draggedEntry, setDraggedEntry] = useState(null);
  const [dragOverCell, setDragOverCell] = useState(null);

  const dragHandlers = useCallback((entry) => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData('application/json', JSON.stringify({
        agent: entry.agent,
        start: entry.start,
        originalStart: entry.originalStart || entry.start
      }));
      e.dataTransfer.effectAllowed = 'move';
      setDraggedEntry(entry);
    },
    onDragEnd: () => {
      setDraggedEntry(null);
      setDragOverCell(null);
    }
  }), []);

  const dropHandlers = useCallback((dayIdx, hour) => ({
    onDragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverCell({ dayIdx, hour });
    },
    onDragLeave: (e) => {
      if (e.currentTarget.contains(e.relatedTarget)) return;
      setDragOverCell(null);
    },
    onDrop: (e) => {
      e.preventDefault();
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'));
        setDragOverCell(null);
        setDraggedEntry(null);
        if (data && onDrop) {
          onDrop(data, dayIdx, hour);
        }
      } catch (err) {
        console.error('Drop parse error:', err);
      }
    }
  }), [onDrop]);

  return { draggedEntry, dragOverCell, dragHandlers, dropHandlers };
}
