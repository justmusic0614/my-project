import React, { useState } from 'react';
import Modal from '../common/Modal';
import PriorityBadge from '../common/PriorityBadge';
import TagChip from '../common/TagChip';
import CommentThread from './CommentThread';
import { format } from 'date-fns';

const COLUMNS = ['todo', 'ongoing', 'pending', 'review', 'done', 'archive'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

export default function TaskDetail({ task, onClose, onUpdate, onDelete, onAddComment }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    title: task.title,
    description: task.description || '',
    column: task.column,
    priority: task.priority,
    tagsInput: (task.tags || []).join(', '),
    dueDate: task.dueDate ? task.dueDate.split('T')[0] : ''
  });

  const handleSave = async () => {
    const tags = form.tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    await onUpdate(task.id, {
      title: form.title.trim(),
      description: form.description.trim(),
      column: form.column,
      priority: form.priority,
      tags,
      dueDate: form.dueDate || null
    });
    setEditing(false);
  };

  const handleDelete = async () => {
    if (confirm('Delete this task?')) {
      await onDelete(task.id, true);
      onClose();
    }
  };

  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }));

  return (
    <Modal title={editing ? 'Edit Task' : task.title} onClose={onClose}>
      {editing ? (
        <div>
          <div className="form-group">
            <label className="form-label">Title</label>
            <input className="form-input" value={form.title} onChange={set('title')} />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="form-input" rows={4} value={form.description} onChange={set('description')} />
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
              <label className="form-label">Tags</label>
              <input className="form-input" value={form.tagsInput} onChange={set('tagsInput')} />
            </div>
            <div className="form-group">
              <label className="form-label">Due Date</label>
              <input className="form-input" type="date" value={form.dueDate} onChange={set('dueDate')} />
            </div>
          </div>
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave}>Save</button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
            <PriorityBadge priority={task.priority} showLabel />
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{task.column}</span>
            {task.dueDate && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Due: {format(new Date(task.dueDate), 'yyyy-MM-dd')}
              </span>
            )}
          </div>

          {task.description && (
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: 1.6 }}>
              {task.description}
            </div>
          )}

          {task.tags && task.tags.length > 0 && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '12px' }}>
              {task.tags.map(tag => <TagChip key={tag} tag={tag} />)}
            </div>
          )}

          {task.attachments && task.attachments.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Attachments ({task.attachments.length})
              </div>
              {task.attachments.map(att => (
                <a
                  key={att.id}
                  href={att.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    padding: '4px 0',
                    color: 'var(--accent-blue)'
                  }}
                >
                  {'\u{1F4CE}'} {att.originalName || att.filename} ({(att.size / 1024).toFixed(1)}KB)
                </a>
              ))}
            </div>
          )}

          <div className="form-actions" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
            <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
            <button className="btn btn-primary" onClick={() => setEditing(true)}>Edit</button>
          </div>

          <CommentThread
            comments={task.comments || []}
            onAddComment={onAddComment}
            taskId={task.id}
          />

          <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
            Created: {format(new Date(task.createdAt), 'yyyy-MM-dd HH:mm')}
            {' | '}
            Updated: {format(new Date(task.updatedAt), 'yyyy-MM-dd HH:mm')}
          </div>
        </div>
      )}
    </Modal>
  );
}
