import { useState, useCallback } from 'react';

export default function useDragDrop(onDrop) {
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);

  const dragHandlers = useCallback((taskId) => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData('text/plain', taskId);
      e.dataTransfer.effectAllowed = 'move';
      setDraggedId(taskId);
    },
    onDragEnd: () => {
      setDraggedId(null);
      setDragOverColumn(null);
    }
  }), []);

  const dropHandlers = useCallback((column) => ({
    onDragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverColumn(column);
    },
    onDragLeave: (e) => {
      if (e.currentTarget.contains(e.relatedTarget)) return;
      setDragOverColumn(null);
    },
    onDrop: (e) => {
      e.preventDefault();
      const taskId = e.dataTransfer.getData('text/plain');
      setDragOverColumn(null);
      setDraggedId(null);
      if (taskId && onDrop) {
        onDrop(taskId, column);
      }
    }
  }), [onDrop]);

  return { draggedId, dragOverColumn, dragHandlers, dropHandlers };
}
