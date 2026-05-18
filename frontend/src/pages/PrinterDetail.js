import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Printer, Activity, FileText, Camera, ShieldAlert, RefreshCw, Power } from 'lucide-react';
import { printerService } from '../services/api';
import axios from 'axios';

const PrinterDetail = ({ addToast }) => {
  const { id } = useParams();
  const [printer, setPrinter] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchPrinter = useCallback(async () => {
    try {
      const res = await printerService.getPrinterDetail(id);
      setPrinter(res.data);
    } catch (err) {
      console.error("Error fetching printer:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchPrinter();
  }, [fetchPrinter]);

  const handleAction = async (name) => {
    const targetMap = {
        'Restart Klipper': 'klipper',
        'Restart Moonraker': 'moonraker',
        'Firmware Restart': 'all',
        'Power Cycle': 'all'
    };

    const target = targetMap[name];
    if (!target) {
        addToast(`${name} not implemented yet`, "info");
        return;
    }

    if (!window.confirm(`Initiate ${name}?`)) return;

    try {
        await axios.post(`/api/printers/${id}/restart`, { target });
        addToast(`${name} initiated`, "success");
    } catch (err) {
        addToast(err.response?.data?.detail || "Action failed", "error");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <RefreshCw className="text-blue-500 animate-spin" size={32} />
        <div className="text-slate-400 font-medium">Loading printer details...</div>
      </div>
    );
  }

  if (!printer) return <div className="text-red-500 font-bold p-8 bg-red-500/10 rounded-xl border border-red-500/20">Printer not found.</div>;

  const nodeIp = printer.node?.ip_address;
  const mainsailUrl = nodeIp ? `http://${nodeIp}` : printer.embedded_ui_url;
  const moonrakerApiUrl = nodeIp && printer.moonraker_port ? `http://${nodeIp}:${printer.moonraker_port}/server/info` : null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center space-x-4">
        <Link to="/" className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h2 className="text-2xl font-bold">{printer.name}</h2>
          <p className="text-xs text-slate-500 font-mono mt-0.5">SLUG: {printer.slug} - MCU: {printer.mcu_serial || 'NOT CONNECTED'}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center space-x-4">
                <div className="p-3 bg-blue-500/10 text-blue-500 rounded-xl shadow-inner">
                  <Activity size={32} />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Current Status</p>
                  <p className="text-xl font-bold capitalize text-slate-200">{printer.status || 'offline'}</p>
                </div>
              </div>
              <button
                onClick={() => handleAction("Emergency Stop")}
                className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-bold transition-colors shadow-lg shadow-red-900/20 text-white"
              >
                <ShieldAlert size={18} />
                <span>EMERGENCY STOP</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { name: 'Restart Klipper', icon: RefreshCw, color: 'text-blue-400' },
                { name: 'Restart Moonraker', icon: RefreshCw, color: 'text-green-400' },
                { name: 'Firmware Restart', icon: RefreshCw, color: 'text-orange-400' },
                { name: 'Power Cycle', icon: Power, color: 'text-red-400' }
              ].map((btn) => (
                <button
                  key={btn.name}
                  onClick={() => handleAction(btn.name)}
                  className="flex flex-col items-center justify-center p-4 bg-slate-900 rounded-xl hover:bg-slate-700 transition-all border border-transparent hover:border-slate-600 group"
                >
                  <btn.icon size={24} className={`${btn.color} mb-2 group-hover:scale-110 transition-transform`} />
                  <span className="text-[10px] font-bold uppercase tracking-tighter text-slate-400 group-hover:text-slate-200">{btn.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
              <div className="flex items-center space-x-2 text-blue-400">
                <Printer size={18} />
                <h3 className="font-bold text-sm">Mainsail</h3>
              </div>
              <div className="flex items-center space-x-3">
                {mainsailUrl && (
                  <a href={mainsailUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs font-bold uppercase tracking-wider">Open Mainsail</a>
                )}
                {moonrakerApiUrl && (
                  <a href={moonrakerApiUrl} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:text-green-300 text-xs font-bold uppercase tracking-wider">Open Moonraker API</a>
                )}
              </div>
            </div>
            <div className="aspect-video bg-slate-900">
              {mainsailUrl ? (
                <iframe src={mainsailUrl} className="w-full h-full border-none" title="Mainsail"></iframe>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-600 space-y-2 italic">
                   <ShieldAlert size={48} className="opacity-10" />
                   <p>No assigned node or UI URL configured for this printer</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
              <Camera size={18} className="text-purple-400" />
              <h3 className="font-bold text-sm">Webcam Stream</h3>
            </div>
            <div className="aspect-video bg-slate-900 rounded-lg overflow-hidden border border-slate-800">
              {printer.webcam_url ? (
                <img src={printer.webcam_url} alt="Webcam" className="w-full h-full object-cover" />
              ) : (
                <div className="flex items-center justify-center h-full text-slate-700 italic text-xs">Stream Unavailable</div>
              )}
            </div>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
              <FileText size={18} className="text-green-400" />
              <h3 className="font-bold text-sm">Configuration</h3>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-slate-500 uppercase text-[9px] font-bold tracking-widest mb-1">Config Path</p>
                <p className="truncate font-mono bg-slate-900 p-2 rounded text-[11px] text-blue-300 border border-slate-700">{printer.config_path || '/mnt/klipper-farm/default/config'}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-slate-500 uppercase text-[9px] font-bold tracking-widest mb-1">Moonraker Port</p>
                  <p className="font-mono text-sm">{printer.moonraker_port || '7125'}</p>
                </div>
                <div>
                  <p className="text-slate-500 uppercase text-[9px] font-bold tracking-widest mb-1">Last Seen</p>
                  <p className="text-xs">{printer.last_seen ? new Date(printer.last_seen).toLocaleTimeString() : 'Never'}</p>
                </div>
              </div>
            </div>
            <Link to="/files" className="block w-full text-center bg-slate-700 hover:bg-slate-600 py-2 rounded-lg text-xs font-bold transition-colors text-slate-300">
              Manage Config Files
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrinterDetail;
