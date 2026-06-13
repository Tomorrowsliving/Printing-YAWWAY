import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Server, FileText, Database, Settings, History, FileCode, Scissors, Package } from 'lucide-react';

const Sidebar = () => {
  const navSections = [
    {
      label: 'Print Farm',
      items: [
        { name: 'Printers', helper: 'Fleet overview', icon: LayoutDashboard, path: '/' },
        { name: 'Nodes', helper: 'Pi controllers', icon: Server, path: '/nodes' },
      ],
    },
    {
      label: 'Print Prep',
      items: [
        { name: 'G-code Hub', helper: 'Ready files', icon: FileCode, path: '/gcode' },
        { name: 'Slicer', helper: 'Models to G-code', icon: Scissors, path: '/slicer' },
        { name: 'Filament', helper: 'Spools and usage', icon: Package, path: '/filament' },
      ],
    },
    {
      label: 'Maintenance',
      items: [
        { name: 'Files', helper: 'Configs and logs', icon: FileText, path: '/files' },
        { name: 'Backups', helper: 'Restore points', icon: Database, path: '/backups' },
        { name: 'Events', helper: 'Activity log', icon: History, path: '/events' },
        { name: 'Settings', helper: 'System setup', icon: Settings, path: '/settings' },
      ],
    },
  ];

  return (
    <div className="w-64 bg-slate-800 h-screen fixed left-0 top-0 flex flex-col border-r border-slate-700 z-50">
      <div className="px-6 py-5 border-b border-slate-700/70">
        <h1 className="text-lg font-bold text-blue-300 leading-tight">Klipper Farm</h1>
        <p className="text-[11px] text-slate-400 font-medium">Control Plane</p>
      </div>
      <nav className="flex-1 px-4 py-4 space-y-5 overflow-y-auto">
        {navSections.map((section) => (
          <div key={section.label} className="space-y-1.5">
            <p className="px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">{section.label}</p>
            {section.items.map((item) => (
              <NavLink
                key={item.name}
                to={item.path}
                className={({ isActive }) =>
                  `group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                    isActive ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-slate-300 hover:bg-slate-700/80 hover:text-slate-100'
                  }`
                }
              >
                <item.icon size={19} className="shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-bold leading-tight">{item.name}</span>
                  <span className="block truncate text-[10px] leading-tight text-slate-400 group-hover:text-slate-300">{item.helper}</span>
                </span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
};

const Layout = ({ children }) => {
  const location = useLocation();
  const widePage = location.pathname.startsWith('/printers/') || location.pathname === '/gcode' || location.pathname === '/slicer' || location.pathname === '/filament';

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
