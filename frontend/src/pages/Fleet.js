import React, { useState, useEffect } from 'react';
import { Printer, Play, AlertTriangle, ExternalLink, Settings as SettingsIcon, RefreshCw, Plus, Loader2 } from 'lucide-react';
import { printerService } from '../services/api';
import { Link } from 'react-router-dom';
import { Modal } from '../components/UI';

const Fleet = ({ addToast }) => {
  const [printers, setPrinters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    model: '',
    mcu_serial: '',
    expected_mcu_serial: '',
    klipper_service_name: '',
    moonraker_service_name: '',
    moonraker_port: 7125,
    config_path: '',
    gcode_path: '',
    webcam_url: '',
    embedded_ui_url: ''
  });

  useEffect(() => {
    fetchPrinters();
    const interval = setInterval(fetchPrinters, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchPrinters = async () => {
    try {
      const res = await printerService.getPrinters();
      setPrinters(Array.isArray(res.data) ? res.data : []);
      setError(null);
    } catch (err) {
      setError("Could not connect to the central server.");
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const newData = { ...prev, [name]: value };
      if (name === 'name' && !prev.slug) {
        newData.slug = value.toLowerCase().replace(/[^a-z0-9]/g, '-');
      }
      return newData;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await printerService.createPrinter(formData);
      addToast(`Printer ${formData.name} added successfully!`, 'success');
      setIsModalOpen(false);
      fetchPrinters();
      setFormData({
        name: '', slug: '', model: '', mcu_serial: '', expected_mcu_serial: '',
        klipper_service_name: '', moonraker_service_name: '', moonraker_port: 7125,
        config_path: '', gcode_path: '', webcam_url: '', embedded_ui_url: ''
      });
    } catch (err) {
      addToast(err.response?.data?.detail || "Failed to create printer", 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusColor = (status) => {
    if (!status) return 'bg-slate-500';
    switch (status.toLowerCase()) {
      case 'printing': return 'bg-blue-500';
      case 'idle': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      case 'offline': return 'bg-slate-500';
      default: return 'bg-slate-400';
    }
  };

  if (loading && printers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <RefreshCw className="text-blue-500 animate-spin" size={32} />
        <div className="text-slate-400 font-medium">Initialising Fleet...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Fleet Overview</h2>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors shadow-lg shadow-blue-900/20"
        >
          <Plus size={18} />
          <span>Add Printer</span>
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {printers.map((printer) => (
          <div key={printer.id} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden flex flex-col sm:flex-row hover:border-slate-600 transition-colors shadow-sm">
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
                    <div className={`w-3 h-3 rounded-full ${getStatusColor(printer.status)} shadow-sm`}></div>
                  </div>
                  <p className="text-xs text-slate-400">Node: {printer.node?.hostname || 'Unassigned'}</p>
                </div>
                <div className="flex space-x-2">
                  <Link to={`/printers/${printer.id}`} className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-slate-300">
                    <SettingsIcon size={16} />
                  </Link>
                  <a href={printer.embedded_ui_url} target="_blank" rel="noopener noreferrer" className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-slate-300">
                    <ExternalLink size={16} />
                  </a>
                </div>
              </div>

              <div className="py-4">
                <div className="flex justify-between items-end mb-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{printer.status || 'offline'}</span>
                </div>
                <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getStatusColor(printer.status)} transition-all duration-500`}
                    style={{ width: printer.status === 'printing' ? '45%' : '0%' }}
                  ></div>
                </div>
              </div>

              <div className="flex space-x-3">
                <button onClick={() => addToast("Emergency Stop not implemented yet", "info")} className="flex-1 bg-slate-700 hover:bg-slate-600 py-2 rounded-lg text-xs font-bold transition-colors text-slate-200">
                  Emergency Stop
                </button>
                <button onClick={() => addToast("Quick Print not implemented yet", "info")} className="px-4 bg-blue-600 hover:bg-blue-700 py-2 rounded-lg transition-colors text-white shadow-md">
                  <Play size={16} fill="currentColor" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Add New Printer"
        footer={
          <div className="flex justify-end space-x-3">
            <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-white transition-colors">Cancel</button>
            <button
              form="printer-form"
              disabled={isSubmitting}
              className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 px-6 py-2 rounded-lg text-sm font-bold transition-colors"
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <span>Add Printer</span>}
            </button>
          </div>
        }
      >
        <form id="printer-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Printer Name</label>
              <input required name="name" value={formData.name} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Slug</label>
              <input required name="slug" value={formData.slug} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Model</label>
            <input name="model" value={formData.model} onChange={handleInputChange} placeholder="e.g. Ender 3 V2" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Expected MCU Serial</label>
              <input name="expected_mcu_serial" value={formData.expected_mcu_serial} onChange={handleInputChange} placeholder="/dev/serial/by-id/..." className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Moonraker Port</label>
              <input type="number" name="moonraker_port" value={formData.moonraker_port} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Embedded UI URL</label>
            <input name="embedded_ui_url" value={formData.embedded_ui_url} onChange={handleInputChange} placeholder="http://pi-ip" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default Fleet;
