import React, { useState } from 'react';
import Modal from '../common/Modal';

const COLUMNS = ['todo', 'ongoing', 'pending', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

export default function NewTaskForm({ onSubmit, onClose }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    column: 'todo',
    priority: 'medium',
    tagsInput: '',
    dueDate: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;

    const tags = form.tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    onSubmit({
      title: form.title.trim(),
      description: form.description.trim(),
      column: form.column,
      priority: form.priority,
      tags,
      dueDate: form.dueDate || undefined
    });
  };

  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }));

  return (
    <Modal title="New Task" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Title *</label>
          <input className="form-input" value={form.title} onChange={set('title')} autoFocus />
        </div>

        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-input" rows={3} value={form.description} onChange={set('description')} />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Column</label>
            <select className="form-input" value={form.column} onChange={set('column')}>
              {COLUMNS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Priority</label>
            <select className="form-input" value={form.priority} onChange={set('priority')}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Tags (comma separated)</label>
            <input className="form-input" value={form.tagsInput} onChange={set('tagsInput')} placeholder="feature, bug, urgent" />
          </div>
          <div className="form-group">
            <label className="form-label">Due Date</label>
            <input className="form-input" type="date" value={form.dueDate} onChange={set('dueDate')} />
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Create Task</button>
        </div>
      </form>
    </Modal>
  );
}
