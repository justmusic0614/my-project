import React from 'react';
import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/', icon: '\u{1F4CA}', label: 'Dashboard' },
  { to: '/board', icon: '\u{1F4CB}', label: 'Kanban' },
  { to: '/calendar', icon: '\u{1F4C5}', label: 'Calendar' },
  { to: '/agents', icon: '\u{1F916}', label: 'Agents' }
];

const styles = {
  sidebar: {
    position: 'fixed',
    left: 0,
    top: 0,
    bottom: 0,
    width: 'var(--sidebar-width)',
    background: 'var(--bg-secondary)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 100
  },
  logo: {
    padding: '20px 16px',
    fontSize: '16px',
    fontWeight: 700,
    borderBottom: '1px solid var(--border)',
    color: 'var(--text-primary)'
  },
  nav: {
    flex: 1,
    padding: '12px 8px'
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    borderRadius: 'var(--radius)',
    color: 'var(--text-secondary)',
    fontSize: '14px',
    textDecoration: 'none',
    marginBottom: '2px',
    transition: 'background 0.15s, color 0.15s'
  },
  activeLink: {
    background: 'var(--bg-tertiary)',
    color: 'var(--text-primary)'
  }
};

export default function Sidebar() {
  return (
    <aside style={styles.sidebar}>
      <div style={styles.logo}>Kanban Dashboard</div>
      <nav style={styles.nav}>
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            style={({ isActive }) => ({
              ...styles.link,
              ...(isActive ? styles.activeLink : {})
            })}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
