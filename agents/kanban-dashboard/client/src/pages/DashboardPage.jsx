import React from 'react';
import Summary from '../components/dashboard/Summary';
import SystemHealth from '../components/dashboard/SystemHealth';

export default function DashboardPage() {
  return (
    <div>
      <SystemHealth />
      <Summary />
    </div>
  );
}
