import React, { useState, useEffect } from 'react';
import { Printer, Play, Pause, AlertTriangle, ExternalLink, Settings as SettingsIcon } from 'lucide-react';
import { printerService } from '../services/api';
import { Link } from 'react-router-dom';

const Fleet = () => {
  const [printers, setPrinters] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPrinters();
    const interval = setInterval(fetchPrinters, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchPrinters = async () => {
    try {
      const res = await printerService.getPrinters();
      setPrinters(res.data);
    } catch (err) {
      console.error("Error fetching printers:", err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status.toLowerCase()) {
      case 'printing': return 'bg-blue-500';
      case 'idle': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      case 'offline': return 'bg-slate-500';
      default: return 'bg-slate-400';
    }
  };

  if (loading) return <div className="text-slate-400">Initialising...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Fleet Overview</h2>
        <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition-colors">
          Add Printer
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {printers.map((printer) => (
          <div key={printer.id} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden flex flex-col sm:flex-row">
            <div className="sm:w-48 h-48 bg-slate-900 flex items-center justify-center border-b sm:border-b-0 sm:border-r border-slate-700">
              {printer.webcam_url ? (
                <img src={printer.webcam_url} alt={printer.name} className="w-full h-full object-cover" />
              ) : (
                <Printer size={64} className="text-slate-700" />
              )}
            </div>

            <div className="flex-1 p-5 flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="font-bold text-lg">{printer.name}</h3>
                    <div className={`w-3 h-3 rounded-full ${getStatusColor(printer.status)}`}></div>
                  </div>
                  <p className="text-xs text-slate-400">Node: {printer.node?.hostname || 'Unassigned'}</p>
                </div>
                <div className="flex space-x-2">
                  <Link to={`/printers/${printer.id}`} className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">
                    <SettingsIcon size={16} />
                  </Link>
                  <a href={printer.embedded_ui_url} target="_blank" rel="noopener noreferrer" className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">
                    <ExternalLink size={16} />
                  </a>
                </div>
              </div>

              <div className="py-4">
                <div className="flex justify-between items-end mb-1">
                  <span className="text-xs font-bold text-slate-500 uppercase">{printer.status}</span>
                  {printer.status === 'printing' && <span className="text-xs font-bold">45%</span>}
                </div>
                <div className="w-full bg-slate-700 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getStatusColor(printer.status)} transition-all duration-500`}
                    style={{ width: printer.status === 'printing' ? '45%' : '0%' }}
                  ></div>
                </div>
              </div>

              <div className="flex space-x-3">
                <button className="flex-1 bg-slate-700 hover:bg-slate-600 py-2 rounded-lg text-xs font-bold transition-colors">
                  Emergency Stop
                </button>
                <button className="px-4 bg-blue-600 hover:bg-blue-700 py-2 rounded-lg transition-colors">
                  <Play size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {printers.length === 0 && (
          <div className="col-span-full py-12 text-center bg-slate-800 border border-slate-700 rounded-xl border-dashed">
            <p className="text-slate-400">No printers in the fleet yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Fleet;
