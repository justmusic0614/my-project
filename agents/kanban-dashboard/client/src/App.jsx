import React, { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import NotificationCenter from './components/dashboard/NotificationCenter';
import useNotifications from './hooks/useNotifications';
import BoardPage from './pages/BoardPage';
import CalendarPage from './pages/CalendarPage';
import AgentsPage from './pages/AgentsPage';
import AnalyticsPage from './pages/AnalyticsPage';

export default function App() {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <>
      <Sidebar />
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        marginLeft: 'var(--sidebar-width)'
      }}>
        <Header
          notificationCount={unreadCount}
          onBellClick={() => setShowNotifications(!showNotifications)}
        />
        {showNotifications && (
          <NotificationCenter
            notifications={notifications}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
            onClose={() => setShowNotifications(false)}
          />
        )}
        <main style={{
          flex: 1,
          overflow: 'auto',
          padding: '20px'
        }}>
          <Routes>
            <Route path="/" element={<AgentsPage />} />
            <Route path="/board" element={<BoardPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            {/* Backward compatibility redirects */}
            <Route path="/agents" element={<Navigate to="/" replace />} />
            <Route path="/ab-test" element={<Navigate to="/analytics" replace />} />
            <Route path="/agent-config" element={<Navigate to="/analytics" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </>
  );
}
