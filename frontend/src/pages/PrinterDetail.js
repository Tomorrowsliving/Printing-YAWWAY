import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Printer, Activity, Settings, FileText, Camera, ShieldAlert, RefreshCw, Power } from 'lucide-react';
import { printerService, agentService } from '../services/api';

const PrinterDetail = () => {
  const { id } = useParams();
  const [printer, setPrinter] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPrinter();
  }, [id]);

  const fetchPrinter = async () => {
    try {
      const res = await printerService.getPrinter(id);
      setPrinter(res.data);
    } catch (err) {
      console.error("Error fetching printer:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="text-slate-400">Loading printer details...</div>;
  if (!printer) return <div className="text-red-500">Printer not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link to="/" className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h2 className="text-2xl font-bold">{printer.name}</h2>
          <p className="text-sm text-slate-400">Slug: {printer.slug} • MCU: {printer.mcu_serial}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Status and Controls */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center space-x-4">
                <div className="p-3 bg-blue-500/10 text-blue-500 rounded-xl">
                  <Activity size={32} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase font-bold">Current Status</p>
                  <p className="text-xl font-bold capitalize">{printer.status}</p>
                </div>
              </div>
              <div className="flex space-x-2">
                <button className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-bold transition-colors">
                  <ShieldAlert size={18} />
                  <span>EMERGENCY STOP</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <button className="flex flex-col items-center justify-center p-4 bg-slate-900 rounded-xl hover:bg-slate-700 transition-colors space-y-2">
                <RefreshCw size={24} className="text-blue-400" />
                <span className="text-xs font-bold">Restart Klipper</span>
              </button>
              <button className="flex flex-col items-center justify-center p-4 bg-slate-900 rounded-xl hover:bg-slate-700 transition-colors space-y-2">
                <RefreshCw size={24} className="text-green-400" />
                <span className="text-xs font-bold">Restart Moonraker</span>
              </button>
              <button className="flex flex-col items-center justify-center p-4 bg-slate-900 rounded-xl hover:bg-slate-700 transition-colors space-y-2">
                <RefreshCw size={24} className="text-orange-400" />
                <span className="text-xs font-bold">Firmware Restart</span>
              </button>
              <button className="flex flex-col items-center justify-center p-4 bg-slate-900 rounded-xl hover:bg-slate-700 transition-colors space-y-2">
                <Power size={24} className="text-red-400" />
                <span className="text-xs font-bold">Power Cycle</span>
              </button>
            </div>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-700 flex justify-between items-center">
              <div className="flex items-center space-x-2">
                <Printer size={18} className="text-blue-400" />
                <h3 className="font-bold">Mainsail / Fluidd View</h3>
              </div>
              <a href={printer.embedded_ui_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline text-sm">Open in new tab</a>
            </div>
            <div className="aspect-video bg-slate-900">
              {printer.embedded_ui_url ? (
                <iframe src={printer.embedded_ui_url} className="w-full h-full border-none" title="Embedded UI"></iframe>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-600">No UI URL configured</div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Sidebar info */}
        <div className="space-y-6">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
            <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
              <Camera size={18} className="text-purple-400" />
              <h3 className="font-bold">Webcam</h3>
            </div>
            <div className="aspect-video bg-slate-900 rounded-lg overflow-hidden">
              {printer.webcam_url ? (
                <img src={printer.webcam_url} alt="Webcam" className="w-full h-full object-cover" />
              ) : (
                <div className="flex items-center justify-center h-full text-slate-600">No Webcam</div>
              )}
            </div>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
            <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
              <FileText size={18} className="text-green-400" />
              <h3 className="font-bold">Configuration</h3>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-slate-500 uppercase text-[10px] font-bold tracking-wider">Config Path</p>
                <p className="truncate font-mono bg-slate-900 p-2 rounded mt-1">{printer.config_path || 'Not set'}</p>
              </div>
              <div>
                <p className="text-slate-500 uppercase text-[10px] font-bold tracking-wider">Moonraker Port</p>
                <p className="font-mono">{printer.moonraker_port || '80'}</p>
              </div>
              <div>
                <p className="text-slate-500 uppercase text-[10px] font-bold tracking-wider">MCU Serial</p>
                <p className="truncate font-mono">{printer.mcu_serial || 'Not set'}</p>
              </div>
            </div>
            <button className="w-full bg-slate-700 hover:bg-slate-600 py-2 rounded-lg text-sm font-bold transition-colors">
              Edit Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrinterDetail;
