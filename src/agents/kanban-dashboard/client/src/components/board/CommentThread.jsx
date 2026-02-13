import React, { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

const styles = {
  thread: { marginTop: '16px' },
  title: { fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' },
  commentBox: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px'
  },
  input: {
    flex: 1,
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 12px',
    color: 'var(--text-primary)',
    fontSize: '13px',
    outline: 'none',
    fontFamily: 'inherit'
  },
  sendBtn: {
    padding: '8px 12px',
    background: 'var(--accent-blue)',
    color: '#fff',
    borderRadius: 'var(--radius-sm)',
    fontSize: '13px',
    cursor: 'pointer',
    flexShrink: 0
  },
  comment: {
    padding: '8px 0',
    borderBottom: '1px solid var(--border)',
    fontSize: '13px'
  },
  commentText: { color: 'var(--text-primary)', lineHeight: 1.5 },
  commentMeta: { fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' },
  replyBtn: {
    fontSize: '11px',
    color: 'var(--accent-blue)',
    cursor: 'pointer',
    marginLeft: '8px',
    background: 'none',
    border: 'none'
  },
  indent: { marginLeft: '20px', borderLeft: '2px solid var(--border)', paddingLeft: '12px' }
};

export default function CommentThread({ comments = [], onAddComment, taskId }) {
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    await onAddComment(taskId, text.trim(), replyTo);
    setText('');
    setReplyTo(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Build tree from flat list
  const rootComments = comments.filter(c => !c.parentId);
  const childMap = {};
  for (const c of comments) {
    if (c.parentId) {
      if (!childMap[c.parentId]) childMap[c.parentId] = [];
      childMap[c.parentId].push(c);
    }
  }

  const renderComment = (comment, depth = 0) => (
    <div key={comment.id} style={depth > 0 ? styles.indent : {}}>
      <div style={styles.comment}>
        <div style={styles.commentText}>{comment.text}</div>
        <div style={styles.commentMeta}>
          {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
          {depth < 3 && (
            <button style={styles.replyBtn} onClick={() => setReplyTo(comment.id)}>Reply</button>
          )}
        </div>
      </div>
      {childMap[comment.id] && childMap[comment.id].map(child =>
        renderComment(child, Math.min(depth + 1, 3))
      )}
    </div>
  );

  return (
    <div style={styles.thread}>
      <div style={styles.title}>
        Comments ({comments.length})
        {replyTo && (
          <button style={{ ...styles.replyBtn, marginLeft: '8px' }} onClick={() => setReplyTo(null)}>
            Cancel reply
          </button>
        )}
      </div>
      <div style={styles.commentBox}>
        <input
          style={styles.input}
          placeholder={replyTo ? 'Write a reply...' : 'Add a comment...'}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button style={styles.sendBtn} onClick={handleSubmit}>Send</button>
      </div>
      {rootComments.map(c => renderComment(c))}
    </div>
  );
}
