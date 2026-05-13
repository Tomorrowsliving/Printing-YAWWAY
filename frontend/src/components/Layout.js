import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Server, Printer, FileText, Database, Settings, History, ArrowLeftRight } from 'lucide-react';

const Sidebar = () => {
  const navItems = [
    { name: 'Fleet', icon: LayoutDashboard, path: '/' },
    { name: 'Nodes', icon: Server, path: '/nodes' },
    { name: 'Assignments', icon: ArrowLeftRight, path: '/assignments' },
    { name: 'Files', icon: FileText, path: '/files' },
    { name: 'Backups', icon: Database, path: '/backups' },
    { name: 'Events', icon: History, path: '/events' },
    { name: 'Settings', icon: Settings, path: '/settings' },
  ];

  return (
    <div className="w-64 bg-slate-800 h-screen fixed left-0 top-0 flex flex-col border-r border-slate-700">
      <div className="p-6">
        <h1 className="text-xl font-bold text-blue-400">Klipper Farm</h1>
        <p className="text-xs text-slate-400">Control Plane</p>
      </div>
      <nav className="flex-1 px-4 py-4 space-y-2">
        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors ${
                isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'
              }`
            }
          >
            <item.icon size={20} />
            <span>{item.name}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
};

const Layout = ({ children }) => {
  return (
    <div className="min-h-screen pl-64">
      <Sidebar />
      <main className="p-8">
        {children}
      </main>
    </div>
  );
};

export default Layout;
