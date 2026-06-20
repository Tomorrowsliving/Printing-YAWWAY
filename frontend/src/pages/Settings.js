import React, { useState, useEffect } from 'react';
import { Mail, ShieldCheck, Save, Send, Loader2, HardDrive, Check, X, Copy, Scissors, RefreshCw } from 'lucide-react';
import axios from 'axios';
import NetworkSetupPanel from '../components/NetworkSetupPanel';
import { HelpText, PageHeader, StatusPill, ToolbarButton } from '../components/DesignSystem';
import { explainApiError } from '../utils/operator';

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
  const [nfsTesting, setNfsTesting] = useState(false);
  const [slicerSettings, setSlicerSettings] = useState({ orca_binary_path: '' });
  const [slicerSaving, setSlicerSaving] = useState(false);

  useEffect(() => {
    fetchNfsStatus();
    fetchSlicerSettings();
  }, []);

  const fetchNfsStatus = async () => {
    setNfsLoading(true);
    try {
      const res = await axios.get('/api/storage/nfs-status');
      setNfsStatus(res.data);
    } catch (err) {
      console.error("NFS status error:", err);
    } finally {
      setNfsLoading(false);
    }
  };

  const fetchSlicerSettings = async () => {
    try {
      const res = await axios.get('/api/slicer/settings');
      setSlicerSettings(res.data || { orca_binary_path: '' });
    } catch (err) {}
  };

  const saveSlicerSettings = async () => {
    setSlicerSaving(true);
    try {
      await axios.post('/api/slicer/settings', slicerSettings);
      addToast('Slicer settings saved', 'success');
    } catch (err) {
      addToast(explainApiError(err, {
        what: 'Slicer settings failed to save',
        cause: 'The backend could not persist the slicer binary path.',
        fix: 'Check the path and try again.',
      }), 'error');
    } finally {
      setSlicerSaving(false);
    }
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await axios.post(`/api/settings/email`, {
        host: smtp.host,
        port: Number(smtp.port) || 587,
        user: smtp.user,
        password: smtp.pass,
        from_email: smtp.from
      });
      addToast("Settings saved successfully", "success");
    } catch (err) {
      addToast(explainApiError(err, {
        what: 'Email settings failed to save',
        cause: 'The SMTP settings request did not complete.',
        fix: 'Check the host, port, username, and app key.',
      }), "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmail) return addToast("Enter a test email address", "info");
    setIsTesting(true);
    try {
      await axios.post(`/api/notifications/test`, {
        email: testEmail,
        config: { host: smtp.host, port: Number(smtp.port) || 587, user: smtp.user, password: smtp.pass, from_email: smtp.from }
      });
      addToast("Test email sent!", "success");
    } catch (err) {
      addToast(explainApiError(err, {
        what: 'Test email failed',
        cause: 'The notification service could not send with the current SMTP settings.',
        fix: 'Check credentials, app password, TLS port, and firewall access.',
      }), "error");
    } finally {
      setIsTesting(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    addToast("Command copied to clipboard", "success");
  };

  const testNfsConnection = async () => {
    setNfsTesting(true);
    try {
      const res = await axios.post('/api/storage/nfs-test');
      setNfsStatus(res.data);
      addToast(res.data?.writable ? 'NFS read/write test passed' : 'NFS test needs attention', res.data?.writable ? 'success' : 'error');
    } catch (err) {
      addToast(explainApiError(err, {
        what: 'NFS connection test failed',
        cause: 'The backend could not read and write central storage.',
        fix: 'Check the export, mount path, permissions, and free space.',
      }), 'error');
    } finally {
      setNfsTesting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        eyebrow="Maintenance"
        title="Settings"
        description="Network, NFS storage, slicer engine, email notifications, and system status."
      />

      <NetworkSetupPanel addToast={addToast} onSaved={fetchNfsStatus} />

      {/* NFS Status Section */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-700 pb-3">
          <div className="flex items-center space-x-2">
            <HardDrive size={20} className="text-purple-400" />
            <h3 className="font-bold text-lg">Central Storage (NFS)</h3>
          </div>
          <div className="flex items-center gap-2">
            {nfsStatus && <StatusPill tone={nfsStatus.writable ? 'green' : nfsStatus.mounted ? 'amber' : 'red'}>{nfsStatus.writable ? 'Writable' : nfsStatus.mounted ? 'Mounted' : 'Not Mounted'}</StatusPill>}
            <ToolbarButton onClick={testNfsConnection} icon={HardDrive} variant="warning" busy={nfsTesting}>Test NFS Connection</ToolbarButton>
            <ToolbarButton onClick={fetchNfsStatus} icon={RefreshCw} variant="secondary" size="icon" busy={nfsLoading} title="Refresh NFS status" />
          </div>
        </div>
        <HelpText>NFS is the central storage mount used by nodes for printer configs, G-code, logs, and backups. A passing read/write test means the dashboard can create and restore managed files.</HelpText>

        {nfsStatus && (
          <div className="space-y-4">
             <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
                   <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Free Space</p>
                   <p className="font-mono text-xs text-slate-300">{nfsStatus.free_space || 'Unknown'}</p>
                </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
                  <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Mount Status</p>
                  <p className={`text-sm font-bold ${nfsStatus.mounted ? 'text-green-400' : 'text-red-300'}`}>{nfsStatus.mounted ? 'Mounted' : 'Not mounted'}</p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
                  <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Read Test</p>
                  <p className={`text-sm font-bold ${nfsStatus.readable ? 'text-green-400' : 'text-red-300'}`}>{nfsStatus.readable ? 'Passed' : 'Needs attention'}</p>
                </div>
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
                  <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Write Test</p>
                  <p className={`text-sm font-bold ${nfsStatus.writable ? 'text-green-400' : 'text-red-300'}`}>{nfsStatus.writable ? 'Passed' : 'Needs attention'}</p>
                  {nfsStatus.write_error && <p className="mt-1 text-[10px] text-red-200/70">{nfsStatus.write_error}</p>}
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

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-5 shadow-sm">
        <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
          <Scissors size={20} className="text-orange-300" />
          <h3 className="font-bold text-lg">Local Slicer</h3>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">OrcaSlicer Binary Path</label>
          <input
            type="text"
            value={slicerSettings.orca_binary_path || ''}
            onChange={(e) => setSlicerSettings({ ...slicerSettings, orca_binary_path: e.target.value })}
            placeholder="/usr/local/bin/orca-slicer"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm font-mono outline-none focus:border-blue-500 transition-colors"
          />
        </div>
        <div className="flex justify-end">
          <button
            onClick={saveSlicerSettings}
            disabled={slicerSaving}
            className="flex items-center justify-center space-x-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 px-6 py-2 rounded-lg font-bold transition-colors text-sm shadow-lg shadow-orange-900/20"
          >
            {slicerSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
            <span>Save Slicer</span>
          </button>
        </div>
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

export default Settings;
