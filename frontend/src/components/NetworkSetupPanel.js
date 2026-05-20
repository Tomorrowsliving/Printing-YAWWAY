import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Network, Save } from 'lucide-react';
import axios from 'axios';

const NetworkSetupPanel = ({ addToast, onSaved, title = 'Network Setup', className = '' }) => {
  const [networkSettings, setNetworkSettings] = useState(null);
  const [networkHost, setNetworkHost] = useState('');
  const [networkLoading, setNetworkLoading] = useState(true);
  const [isSavingNetwork, setIsSavingNetwork] = useState(false);

  const fetchNetworkSettings = useCallback(async () => {
    setNetworkLoading(true);
    try {
      const res = await axios.get('/api/settings/network');
      setNetworkSettings(res.data);
      setNetworkHost(res.data.dashboard_host || res.data.suggested_host || '');
    } catch (err) {
      console.error("Network settings error:", err);
      addToast?.("Failed to load network settings", "error");
    } finally {
      setNetworkLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchNetworkSettings();
  }, [fetchNetworkSettings]);

  const handleSaveNetworkSettings = async () => {
    if (!networkHost.trim()) {
      addToast?.("Enter a LAN address or hostname", "info");
      return;
    }

    setIsSavingNetwork(true);
    try {
      const res = await axios.post('/api/settings/network', { dashboard_host: networkHost });
      setNetworkSettings(res.data);
      setNetworkHost(res.data.dashboard_host || res.data.suggested_host || '');
      addToast?.("Network settings saved", "success");
      onSaved?.(res.data);
    } catch (err) {
      addToast?.(err.response?.data?.detail || "Failed to save network settings", "error");
    } finally {
      setIsSavingNetwork(false);
    }
  };

  const showSetupWarning = Boolean(networkSettings && (networkSettings.requires_setup || !networkSettings.browser_host_usable));

  return (
    <div className={`bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-5 shadow-sm ${className}`}>
      <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
        <Network size={20} className="text-cyan-400" />
        <h3 className="font-bold text-lg">{title}</h3>
      </div>

      {networkSettings?.saved_host_usable && (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-100">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <p className="text-sm">
            Pi nodes will connect to <span className="font-mono">{networkSettings.effective_host}</span>.
          </p>
        </div>
      )}

      {showSetupWarning && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p className="text-sm">
            Pi nodes need the LAN address or hostname of this dashboard. Current browser host:
            {' '}
            <span className="font-mono">{networkSettings?.browser_host || 'localhost'}</span>.
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
  );
};

export default NetworkSetupPanel;
