import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';

const AdminShell = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="ldc-shell">
      <Topbar onMenuToggle={() => setSidebarOpen((open) => !open)} />
      <div className="flex flex-1 gap-6 px-4 pb-6 pt-4 md:px-8">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminShell;
