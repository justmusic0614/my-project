import React, { useState } from 'react';
import Board from '../components/board/Board';
import StatsBar from '../components/layout/StatsBar';
import NewTaskForm from '../components/board/NewTaskForm';
import TaskDetail from '../components/board/TaskDetail';
import useTasks from '../hooks/useTasks';
import '../styles/board.css';

export default function BoardPage() {
  const { tasks, loading, createTask, updateTask, deleteTask, moveTask, addComment } = useTasks();
  const [showNewTask, setShowNewTask] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);

  const handleCreate = async (data) => {
    await createTask(data);
    setShowNewTask(false);
  };

  const handleMove = async (taskId, column) => {
    await moveTask(taskId, column);
  };

  if (loading) {
    return <div style={{ color: 'var(--text-secondary)', padding: '40px', textAlign: 'center' }}>Loading...</div>;
  }

  return (
    <div>
      <StatsBar tasks={tasks} />
      <Board tasks={tasks} onMoveTask={handleMove} onTaskClick={setSelectedTask} />

      <button className="board-fab" onClick={() => setShowNewTask(true)} title="New Task">+</button>

      {showNewTask && (
        <NewTaskForm onSubmit={handleCreate} onClose={() => setShowNewTask(false)} />
      )}

      {selectedTask && (
        <TaskDetail
          task={tasks.find(t => t.id === selectedTask.id) || selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={updateTask}
          onDelete={deleteTask}
          onAddComment={addComment}
        />
      )}
    </div>
  );
}
