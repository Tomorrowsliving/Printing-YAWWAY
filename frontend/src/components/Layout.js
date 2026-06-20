import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import axios from 'axios';
import {
  Activity,
  Bell,
  ChevronRight,
  Clock3,
  Database,
  FileCode,
  FileText,
  History,
  LayoutDashboard,
  Menu,
  Package,
  Scissors,
  Server,
  Settings,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { StatusPill, ToolbarButton, cn } from './DesignSystem';

const navSections = [
  {
    label: 'Print Farm',
    items: [
      { name: 'Fleet', helper: 'Printer overview', icon: LayoutDashboard, path: '/' },
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
      { name: 'Files', helper: 'Configurations and logs', icon: FileText, path: '/files' },
      { name: 'Backups', helper: 'Restore points', icon: Database, path: '/backups' },
      { name: 'Events', helper: 'Activity log', icon: History, path: '/events' },
      { name: 'Settings', helper: 'System setup', icon: Settings, path: '/settings' },
    ],
  },
];

const routeMeta = [
  { match: (path) => path === '/', section: 'Print Farm', title: 'Fleet', description: 'Live printer states, progress, and safe machine actions.' },
  { match: (path) => path.startsWith('/nodes/assignments'), section: 'Print Farm', title: 'Assignments', description: 'Move printers between suitable nodes with preflight checks.' },
  { match: (path) => path.startsWith('/nodes'), section: 'Print Farm', title: 'Nodes', description: 'Raspberry Pi health, storage, software, and service inventory.' },
  { match: (path) => path.startsWith('/printers/'), section: 'Print Farm', title: 'Printer Detail', description: 'Monitoring, controls, profile, logs, and embedded UI.' },
  { match: (path) => path === '/gcode', section: 'Print Prep', title: 'G-code Hub', description: 'Central ready-to-print files, preview, fit checks, and dispatch.' },
  { match: (path) => path === '/slicer', section: 'Print Prep', title: 'Slicer', description: 'Upload models, choose profiles, and create printer-ready G-code.' },
  { match: (path) => path === '/filament', section: 'Print Prep', title: 'Filament', description: 'Spool inventory and print usage tracking.' },
  { match: (path) => path === '/files', section: 'Maintenance', title: 'Files', description: 'Printer configurations, macros, G-code, logs, and backups.' },
  { match: (path) => path === '/backups', section: 'Maintenance', title: 'Backups', description: 'Manual and scheduled restore points.' },
  { match: (path) => path === '/events', section: 'Maintenance', title: 'Events', description: 'Audit trail and troubleshooting timeline.' },
  { match: (path) => path === '/settings', section: 'Maintenance', title: 'Settings', description: 'Network, storage, slicer, email, and system settings.' },
  { match: (path) => path === '/setup/network', section: 'First run', title: 'Network Setup', description: 'Choose the LAN address Pi nodes should use.' },
];

const eventTone = (severity) => {
  const value = String(severity || '').toLowerCase();
  if (value === 'critical' || value === 'error') return 'red';
  if (value === 'warning') return 'amber';
  return 'blue';
};

const formatEventTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const SidebarContent = ({ onNavigate }) => (
  <div className="flex h-full flex-col">
    <div className="border-b border-slate-800 px-5 py-5 xl:px-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-400/20 bg-blue-500/10 text-blue-200">
          <LayoutDashboard size={20} />
        </div>
        <div className="hidden min-w-0 xl:block">
          <h1 className="truncate text-base font-bold text-slate-50">Klipper Farm</h1>
          <p className="truncate text-[11px] font-medium text-slate-500">Control Plane</p>
        </div>
      </div>
    </div>

    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5 xl:px-4">
      {navSections.map((section) => (
        <div key={section.label} className="space-y-2">
          <p className="hidden px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-600 xl:block">{section.label}</p>
          {section.items.map((item) => (
            <NavLink
              key={item.name}
              to={item.path}
              end={item.path === '/'}
              onClick={onNavigate}
              className={({ isActive }) => cn(
                'group flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-all duration-200',
                isActive
                  ? 'border-blue-500/40 bg-blue-600 text-white shadow-lg shadow-blue-950/20'
                  : 'border-transparent text-slate-400 hover:border-slate-700 hover:bg-slate-850 hover:text-slate-100',
              )}
            >
              <item.icon size={19} className="shrink-0" />
              <span className="hidden min-w-0 xl:block">
                <span className="block truncate text-sm font-bold leading-tight">{item.name}</span>
                <span className="mt-0.5 block truncate text-[10px] leading-tight text-slate-400 group-[.active]:text-slate-200">{item.helper}</span>
              </span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  </div>
);

const ActivityDrawer = ({ open, events, loading, onClose, onRefresh }) => (
  <>
    <div
      className={cn('fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm transition-opacity', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
      onClick={onClose}
    />
    <aside className={cn(
      'fixed right-0 top-0 z-[80] flex h-screen w-full max-w-md flex-col border-l border-slate-700 bg-slate-950 shadow-2xl transition-transform duration-300',
      open ? 'translate-x-0' : 'translate-x-full',
    )}>
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-300">Activity Centre</p>
          <h2 className="mt-1 text-lg font-bold text-slate-50">Recent system activity</h2>
        </div>
        <ToolbarButton size="icon" variant="subtle" icon={X} onClick={onClose} aria-label="Close activity centre" />
      </div>
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
        <p className="text-xs text-slate-500">Latest events and long-running operations appear here.</p>
        <ToolbarButton size="sm" variant="secondary" icon={Activity} busy={loading} onClick={onRefresh}>Refresh</ToolbarButton>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {events.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center">
            <Bell size={30} className="mx-auto mb-3 text-slate-600" />
            <p className="font-bold text-slate-300">No recent activity</p>
            <p className="mt-1 text-sm text-slate-500">New print, slicer, node, backup, and error events will show here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((event) => (
              <div key={event.id} className="rounded-lg border border-slate-800 bg-slate-900/65 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <StatusPill tone={eventTone(event.severity)} icon={false}>{event.severity || 'info'}</StatusPill>
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                    <Clock3 size={12} />
                    {formatEventTime(event.created_at)}
                  </span>
                </div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{event.event_type}</p>
                <p className="mt-1 text-sm leading-5 text-slate-200">{event.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  </>
);

const Layout = ({ children }) => {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [connectionState, setConnectionState] = useState('connecting');

  const meta = useMemo(
    () => routeMeta.find((item) => item.match(location.pathname)) || routeMeta[0],
    [location.pathname],
  );

  const widePage = location.pathname.startsWith('/printers/')
    || location.pathname === '/gcode'
    || location.pathname === '/slicer'
    || location.pathname === '/filament';

  const refreshEvents = async () => {
    setEventsLoading(true);
    try {
      const res = await axios.get('/api/events', { params: { limit: 8 } });
      setEvents(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  };

  useEffect(() => {
    refreshEvents();
    const interval = setInterval(refreshEvents, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let reconnectTimer;
    let ws;
    let closed = false;

    const connect = () => {
      try {
        const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${scheme}://${window.location.host}/ws/status`);
        ws.onopen = () => setConnectionState('live');
        ws.onerror = () => setConnectionState('polling');
        ws.onclose = () => {
          if (closed) return;
          setConnectionState('polling');
          reconnectTimer = setTimeout(connect, 8000);
        };
      } catch (err) {
        setConnectionState('polling');
      }
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);

  return (
    <div className="min-h-screen text-slate-100">
      <div className="fixed left-0 top-0 z-50 hidden h-screen border-r border-slate-800 bg-slate-950/95 backdrop-blur md:block md:w-20 xl:w-72">
        <SidebarContent />
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-[70] md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileNavOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 border-r border-slate-800 bg-slate-950">
            <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="min-h-screen md:pl-20 xl:pl-72">
        <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/88 backdrop-blur-xl">
          <div className="flex min-h-[72px] items-center justify-between gap-4 px-4 py-3 md:px-6 xl:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <ToolbarButton size="icon" variant="subtle" icon={Menu} className="md:hidden" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation" />
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  <span>{meta.section}</span>
                  <ChevronRight size={12} />
                  <span className="truncate text-blue-300">{meta.title}</span>
                </div>
                <p className="truncate text-sm text-slate-400">{meta.description}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusPill
                tone={connectionState === 'live' ? 'green' : 'amber'}
                icon={connectionState === 'live' ? Wifi : WifiOff}
                className="hidden sm:inline-flex"
              >
                {connectionState === 'live' ? 'Live' : 'Polling'}
              </StatusPill>
              <ToolbarButton
                size="md"
                variant="secondary"
                icon={Bell}
                onClick={() => setActivityOpen(true)}
                className="relative"
              >
                <span className="hidden sm:inline">Activity</span>
                {events.length > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-bold text-white">
                    {Math.min(events.length, 9)}
                  </span>
                )}
              </ToolbarButton>
            </div>
          </div>
        </header>

        <main className={cn('min-h-[calc(100vh-72px)] px-4 py-6 md:px-6 xl:px-8', widePage ? 'w-full' : 'mx-auto max-w-7xl')}>
          {children || <div className="text-slate-500">No content available.</div>}
        </main>
      </div>

      <ActivityDrawer
        open={activityOpen}
        events={events}
        loading={eventsLoading}
        onClose={() => setActivityOpen(false)}
        onRefresh={refreshEvents}
      />
    </div>
  );
};

export default Layout;
