import React from 'react';
import { formatDistanceToNow } from 'date-fns';

const TYPE_ICONS = {
  agent_failure: '\u{26A0}\u{FE0F}',
  agent_completed: '\u2705',
  task_overdue: '\u23F0',
  task_moved: '\u{1F4CB}',
  info: '\u{2139}\u{FE0F}'
};

const styles = {
  dropdown: {
    position: 'absolute',
    top: 'calc(var(--header-height) - 4px)',
    right: '20px',
    width: '360px',
    maxHeight: '480px',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    boxShadow: '0 8px 32px var(--shadow)',
    zIndex: 200,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid var(--border)'
  },
  title: { fontSize: '14px', fontWeight: 600 },
  markAll: {
    fontSize: '12px',
    color: 'var(--accent-blue)',
    cursor: 'pointer',
    background: 'none',
    border: 'none'
  },
  list: {
    flex: 1,
    overflow: 'auto'
  },
  item: {
    display: 'flex',
    gap: '10px',
    padding: '10px 16px',
    borderBottom: '1px solid var(--border)',
    cursor: 'pointer',
    transition: 'background 0.1s'
  },
  unread: {
    background: 'var(--bg-tertiary)'
  },
  icon: { fontSize: '16px', flexShrink: 0, marginTop: '2px' },
  content: { flex: 1 },
  ntitle: { fontSize: '13px', fontWeight: 500 },
  msg: { fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' },
  time: { fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' },
  empty: {
    padding: '40px 16px',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '13px'
  }
};

export default function NotificationCenter({ notifications, onMarkRead, onMarkAllRead, onClose }) {
  return (
    <div style={styles.dropdown}>
      <div style={styles.header}>
        <span style={styles.title}>Notifications</span>
        <button style={styles.markAll} onClick={onMarkAllRead}>Mark all read</button>
      </div>
      <div style={styles.list}>
        {notifications.length === 0 ? (
          <div style={styles.empty}>No notifications</div>
        ) : (
          notifications.slice().reverse().slice(0, 50).map(n => (
            <div
              key={n.id}
              style={{ ...styles.item, ...(!n.read ? styles.unread : {}) }}
              onClick={() => { if (!n.read) onMarkRead(n.id); }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = !n.read ? 'var(--bg-tertiary)' : ''}
            >
              <span style={styles.icon}>{TYPE_ICONS[n.type] || TYPE_ICONS.info}</span>
              <div style={styles.content}>
                <div style={styles.ntitle}>{n.title}</div>
                {n.message && <div style={styles.msg}>{n.message}</div>}
                <div style={styles.time}>{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
