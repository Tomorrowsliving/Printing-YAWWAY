import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Server, FileText, Database, Settings, History, FileCode, Scissors } from 'lucide-react';

const Sidebar = () => {
  const navItems = [
    { name: 'Fleet', icon: LayoutDashboard, path: '/' },
    { name: 'Nodes', icon: Server, path: '/nodes' },
    { name: 'G-code Hub', icon: FileCode, path: '/gcode' },
    { name: 'Slicer', icon: Scissors, path: '/slicer' },
    { name: 'Files', icon: FileText, path: '/files' },
    { name: 'Backups', icon: Database, path: '/backups' },
    { name: 'Events', icon: History, path: '/events' },
    { name: 'Settings', icon: Settings, path: '/settings' },
  ];

  return (
    <div className="w-64 bg-slate-800 h-screen fixed left-0 top-0 flex flex-col border-r border-slate-700 z-50">
      <div className="p-6">
        <h1 className="text-xl font-bold text-blue-400">Klipper Farm</h1>
        <p className="text-xs text-slate-400 font-medium">Control Plane</p>
      </div>
      <nav className="flex-1 px-4 py-4 space-y-2 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors ${
                isActive ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-slate-300 hover:bg-slate-700'
              }`
            }
          >
            <item.icon size={20} />
            <span className="font-medium">{item.name}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
};

const Layout = ({ children }) => {
  const location = useLocation();
  const widePage = location.pathname.startsWith('/printers/') || location.pathname === '/gcode' || location.pathname === '/slicer';

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex">
      <Sidebar />
      <div className="flex-1 pl-64">
        <main className={`min-h-screen p-8 ${widePage ? 'w-full' : 'max-w-7xl mx-auto'}`}>
          {children || <div className="text-slate-500">No content available.</div>}
        </main>
      </div>
    </div>
  );
};

export default Layout;
