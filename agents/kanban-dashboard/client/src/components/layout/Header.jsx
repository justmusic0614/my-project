import React from 'react';
import { useLocation } from 'react-router-dom';
import SearchBar from '../common/SearchBar';

const pageTitles = {
  '/': 'Dashboard',
  '/board': 'Kanban Board',
  '/calendar': 'Calendar',
  '/agents': 'Agent Monitor'
};

const styles = {
  header: {
    height: 'var(--header-height)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 20px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-secondary)',
    flexShrink: 0
  },
  title: {
    fontSize: '18px',
    fontWeight: 600
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  bellBtn: {
    position: 'relative',
    fontSize: '18px',
    padding: '6px',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer'
  },
  badge: {
    position: 'absolute',
    top: '2px',
    right: '2px',
    background: 'var(--accent-red)',
    color: '#fff',
    fontSize: '10px',
    borderRadius: '50%',
    width: '16px',
    height: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }
};

export default function Header({ notificationCount = 0, onBellClick }) {
  const location = useLocation();
  const title = pageTitles[location.pathname] || 'Dashboard';

  return (
    <header style={styles.header}>
      <h1 style={styles.title}>{title}</h1>
      <div style={styles.actions}>
        <SearchBar />
        <button style={styles.bellBtn} onClick={onBellClick} title="Notifications">
          {'\u{1F514}'}
          {notificationCount > 0 && (
            <span style={styles.badge}>{notificationCount > 9 ? '9+' : notificationCount}</span>
          )}
        </button>
      </div>
    </header>
  );
}
