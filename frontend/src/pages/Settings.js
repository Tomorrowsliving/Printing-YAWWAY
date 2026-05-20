import React, { useState, useEffect } from 'react';
import { Mail, ShieldCheck, Save, Send, Loader2, HardDrive, Check, X, Copy, Network, AlertTriangle } from 'lucide-react';
import axios from 'axios';

const Settings = ({ addToast }) => {
  const [smtp, setSmtp] = useState({
    host: '',
    port: '587',
    user: '',
    pass: '',
    from: 'noreply@klipperfarm.local'
  });
  const [testEmail, setTestEmail] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [nfsStatus, setNfsStatus] = useState(null);
  const [nfsLoading, setNfsLoading] = useState(true);
  const [networkSettings, setNetworkSettings] = useState(null);
  const [networkHost, setNetworkHost] = useState('');
  const [networkLoading, setNetworkLoading] = useState(true);
  const [isSavingNetwork, setIsSavingNetwork] = useState(false);

  useEffect(() => {
    fetchNetworkSettings();
    fetchNfsStatus();
  }, []);

  const fetchNetworkSettings = async () => {
    try {
      const res = await axios.get('/api/settings/network');
      setNetworkSettings(res.data);
      setNetworkHost(res.data.dashboard_host || res.data.suggested_host || '');
    } catch (err) {
      console.error("Network settings error:", err);
    } finally {
      setNetworkLoading(false);
    }
  };

  const fetchNfsStatus = async () => {
    try {
      const res = await axios.get('/api/storage/nfs-status');
      setNfsStatus(res.data);
    } catch (err) {
      console.error("NFS status error:", err);
    } finally {
      setNfsLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await axios.post(`/api/settings/email`, smtp);
      addToast("Settings saved successfully", "success");
    } catch (err) {
      addToast("Failed to save settings", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveNetworkSettings = async () => {
    setIsSavingNetwork(true);
    try {
      const res = await axios.post('/api/settings/network', { dashboard_host: networkHost });
      setNetworkSettings(res.data);
      setNetworkHost(res.data.dashboard_host || res.data.suggested_host || '');
      await fetchNfsStatus();
      addToast("Network settings saved", "success");
    } catch (err) {
      addToast(err.response?.data?.detail || "Failed to save network settings", "error");
    } finally {
      setIsSavingNetwork(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmail) return addToast("Enter a test email address", "info");
    setIsTesting(true);
    try {
      await axios.post(`/api/notifications/test`, { email: testEmail, config: smtp });
      addToast("Test email sent!", "success");
    } catch (err) {
      addToast("Failed to send test email", "error");
    } finally {
      setIsTesting(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    addToast("Command copied to clipboard", "success");
  };

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h2 className="text-2xl font-bold">Settings</h2>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-5 shadow-sm">
        <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
          <Network size={20} className="text-cyan-400" />
          <h3 className="font-bold text-lg">Network Setup</h3>
        </div>

        {networkSettings && !networkSettings.browser_host_usable && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p className="text-sm">
              The dashboard is open as <span className="font-mono">{networkSettings.browser_host || 'localhost'}</span>. Pi nodes need a LAN address or hostname.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Dashboard LAN Address</label>
            <input
              type="text"
              value={networkHost}
              onChange={(e) => setNetworkHost(e.target.value)}
              placeholder="10.1.8.137 or klipper-farm.local"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm outline-none focus:border-cyan-500 transition-colors"
            />
          </div>
          <button
            onClick={handleSaveNetworkSettings}
            disabled={isSavingNetwork || networkLoading}
            className="flex items-center justify-center space-x-2 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 px-6 py-2 rounded-lg font-bold transition-colors text-sm shadow-lg shadow-cyan-900/20"
          >
            {isSavingNetwork ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
            <span>Save Network</span>
          </button>
        </div>

        {networkSettings && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700/50">
              <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Effective Host</p>
              <p className="font-mono text-slate-300">{networkSettings.effective_host || 'Not set'}</p>
            </div>
            <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700/50">
              <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Browser Host</p>
              <p className="font-mono text-slate-300">{networkSettings.browser_host || '-'}</p>
            </div>
            <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700/50">
              <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Auto Suggestion</p>
              <p className="font-mono text-slate-300">{networkSettings.suggested_host || '-'}</p>
            </div>
          </div>
        )}
      </div>

      {/* NFS Status Section */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-700 pb-3">
          <div className="flex items-center space-x-2">
            <HardDrive size={20} className="text-purple-400" />
            <h3 className="font-bold text-lg">Central Storage (NFS)</h3>
          </div>
          <button onClick={fetchNfsStatus} className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors">
            <RefreshCw size={16} className={nfsLoading ? "animate-spin" : ""} />
          </button>
        </div>

        {nfsStatus && (
          <div className="space-y-4">
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
                   <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Export Path</p>
                   <p className="font-mono text-xs">{nfsStatus.server_export_path}</p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
                   <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Permitted Subnet</p>
                   <p className="font-mono text-xs">{nfsStatus.permitted_subnet}</p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
                   <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Local Root</p>
                   <p className="font-mono text-xs text-slate-400">{nfsStatus.storage_root}</p>
                </div>
             </div>

             <div className="space-y-2">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Required Directories</p>
                <div className="flex flex-wrap gap-2">
                   {Object.entries(nfsStatus.required_directories).map(([dir, exists]) => (
                     <div key={dir} className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-[10px] font-bold border ${exists ? 'bg-green-500/5 border-green-500/20 text-green-400' : 'bg-red-500/5 border-red-500/20 text-red-400'}`}>
                        {exists ? <Check size={10} /> : <X size={10} />}
                        <span className="capitalize">{dir}</span>
                     </div>
                   ))}
                </div>
             </div>

             <div className="space-y-3 pt-2">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Pi Node Mount Commands</p>
                <div className="space-y-2">
                   <div className="group relative">
                      <div className="bg-black/40 rounded-lg p-3 font-mono text-[11px] text-blue-300 break-all border border-slate-700 pr-12 italic">
                         {nfsStatus.mount_command_nfs}
                      </div>
                      <button onClick={() => copyToClipboard(nfsStatus.mount_command_nfs)} className="absolute right-2 top-2 p-2 bg-slate-700 hover:bg-blue-600 rounded-md transition-colors opacity-0 group-hover:opacity-100 shadow-lg">
                         <Copy size={14} />
                      </button>
                   </div>
                   <div className="group relative">
                      <div className="bg-black/40 rounded-lg p-3 font-mono text-[11px] text-purple-300 break-all border border-slate-700 pr-12 italic">
                         {nfsStatus.mount_command_nfs4}
                      </div>
                      <button onClick={() => copyToClipboard(nfsStatus.mount_command_nfs4)} className="absolute right-2 top-2 p-2 bg-slate-700 hover:bg-purple-600 rounded-md transition-colors opacity-0 group-hover:opacity-100 shadow-lg">
                         <Copy size={14} />
                      </button>
                   </div>
                </div>
             </div>
          </div>
        )}
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-6 shadow-sm">
        <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
          <Mail size={20} className="text-blue-400" />
          <h3 className="font-bold text-lg">Email Notifications (SMTP)</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">SMTP Host</label>
            <input
              type="text"
              value={smtp.host}
              onChange={(e) => setSmtp({...smtp, host: e.target.value})}
              placeholder="smtp.gmail.com"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">SMTP Port</label>
            <input
              type="text"
              value={smtp.port}
              onChange={(e) => setSmtp({...smtp, port: e.target.value})}
              placeholder="587"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Username</label>
            <input
              type="text"
              value={smtp.user}
              onChange={(e) => setSmtp({...smtp, user: e.target.value})}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Password / App Key</label>
            <input
              type="password"
              value={smtp.pass}
              onChange={(e) => setSmtp({...smtp, pass: e.target.value})}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-slate-700 flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex-1 space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Send Test To</label>
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="your-email@example.com"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <button
            onClick={handleTestEmail}
            disabled={isTesting}
            className="flex items-center justify-center space-x-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-6 py-2 rounded-lg font-bold transition-colors text-sm"
          >
            {isTesting ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
            <span>Send Test</span>
          </button>
          <button
            onClick={handleSaveSettings}
            disabled={isSaving}
            className="flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-6 py-2 rounded-lg font-bold transition-colors text-sm shadow-lg shadow-blue-900/20"
          >
            {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
            <span>Save Settings</span>
          </button>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4 shadow-sm">
        <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
          <ShieldCheck size={20} className="text-green-400" />
          <h3 className="font-bold text-lg">System Information</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div className="p-3 bg-slate-900/50 rounded-lg">
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Backend Version</p>
            <p className="font-mono text-slate-300">v1.0.0-mvp</p>
          </div>
          <div className="p-3 bg-slate-900/50 rounded-lg">
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Database Status</p>
            <p className="text-green-500 font-bold flex items-center space-x-1">
              <span className="w-2 h-2 bg-green-500 rounded-full inline-block animate-pulse"></span>
              <span>Connected</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const RefreshCw = ({ className, size }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
);

export default Settings;
