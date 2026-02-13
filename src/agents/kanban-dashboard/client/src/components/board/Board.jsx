import React, { useMemo } from 'react';
import Column from './Column';
import useDragDrop from '../../hooks/useDragDrop';

const COLUMNS = ['todo', 'ongoing', 'pending', 'review', 'done', 'archive'];

export default function Board({ tasks, onMoveTask, onTaskClick }) {
  const { draggedId, dragOverColumn, dragHandlers, dropHandlers } = useDragDrop(
    (taskId, column) => {
      const task = tasks.find(t => t.id === taskId);
      if (task && task.column !== column) {
        onMoveTask(taskId, column);
      }
    }
  );

  const grouped = useMemo(() => {
    const result = {};
    for (const col of COLUMNS) {
      result[col] = [];
    }
    for (const task of tasks) {
      if (result[task.column]) {
        result[task.column].push(task);
      }
    }
    return result;
  }, [tasks]);

  return (
    <div className="board">
      {COLUMNS.map(col => (
        <Column
          key={col}
          column={col}
          tasks={grouped[col]}
          isDragOver={dragOverColumn === col}
          dropHandlers={dropHandlers(col)}
          dragHandlers={dragHandlers}
          draggedId={draggedId}
          onTaskClick={onTaskClick}
        />
      ))}
    </div>
  );
}
