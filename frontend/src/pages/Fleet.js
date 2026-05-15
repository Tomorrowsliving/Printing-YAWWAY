import React, { useState, useEffect } from 'react';
import {
  Printer, Play, AlertTriangle, ExternalLink, Settings as SettingsIcon,
  RefreshCw, Plus, Loader2, ChevronRight, ChevronLeft, Server, Usb, Check
} from 'lucide-react';
import { printerService, nodeService } from '../services/api';
import { Link } from 'react-router-dom';
import { Modal } from '../components/UI';
import axios from 'axios';

const Fleet = ({ addToast }) => {
  const [printers, setPrinters] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Wizard state
  const [step, setStep] = useState(1);
  const [mcus, setMcus] = useState({ available: [], used: [] });
  const [mcuLoading, setMcuLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    model: '',
    assigned_node_id: null,
    expected_mcu_serial: '',
    moonraker_port: 7125,
    webcam_url: '',
    embedded_ui_url: ''
  });

  useEffect(() => {
    fetchPrinters();
    fetchNodes();
    const interval = setInterval(() => {
        fetchPrinters();
        fetchNodes();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchPrinters = async () => {
    try {
      const res = await printerService.getPrinters();
      setPrinters(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Fleet fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchNodes = async () => {
    try {
      const res = await nodeService.getNodes();
      setNodes(res.data.filter(n => n.online));
    } catch (err) {}
  };

  const fetchMcus = async (nodeId) => {
    setMcuLoading(true);
    try {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return;

      const res = await axios.get(`http://${node.ip_address}:${node.agent_port}/usb`);
      const available = res.data;

      // In a real app, we'd cross-reference with existing printers
      setMcus({ available, used: [] });
    } catch (err) {
      addToast("Failed to fetch USB devices from node", "error");
    } finally {
      setMcuLoading(false);
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

  const handleNodeSelect = (nodeId) => {
    setFormData(prev => ({ ...prev, assigned_node_id: nodeId }));
    setStep(3);
    fetchMcus(nodeId);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      // 1. Create printer record in central DB
      const res = await printerService.createPrinter({
        ...formData,
        status: 'offline',
        klipper_service_name: `klipper-${formData.slug}`,
        moonraker_service_name: `moonraker-${formData.slug}`,
        config_path: `/srv/klipper-farm/printers/${formData.slug}/config`,
        gcode_path: `/srv/klipper-farm/printers/${formData.slug}/gcodes`,
      });

      // 2. Instruct node agent to create instance
      const node = nodes.find(n => n.id === formData.assigned_node_id);
      await axios.post(`http://${node.ip_address}:${node.agent_port}/instances/create`, {
        printer_slug: formData.slug,
        mcu_serial: formData.expected_mcu_serial,
        moonraker_port: formData.moonraker_port,
        config_path: `/srv/klipper-farm/printers/${formData.slug}/config`,
        gcode_path: `/srv/klipper-farm/printers/${formData.slug}/gcodes`,
        logs_path: `/srv/klipper-farm/printers/${formData.slug}/logs`
      });

      addToast(`Printer ${formData.name} initialised!`, 'success');
      setIsModalOpen(false);
      setStep(1);
      fetchPrinters();
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
          onClick={() => { setStep(1); setIsModalOpen(true); }}
          className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors shadow-lg"
        >
          <Plus size={18} />
          <span>Add Printer</span>
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {printers.map((printer) => (
          <div key={printer.id} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden flex flex-col sm:row hover:border-slate-600 transition-colors shadow-sm">
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
                <button className="flex-1 bg-slate-700 hover:bg-slate-600 py-2 rounded-lg text-xs font-bold transition-colors text-slate-300">Emergency Stop</button>
                <button className="px-4 bg-blue-600 hover:bg-blue-700 py-2 rounded-lg transition-colors text-white"><Play size={16} fill="currentColor" /></button>
              </div>
            </div>
          </div>
        ))}
        {printers.length === 0 && <div className="col-span-full py-16 text-center text-slate-500 italic border border-dashed border-slate-700 rounded-xl">No printers found. Click Add Printer to begin.</div>}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setStep(1); }} title={`Add Printer - Step ${step} of 5`}>
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="font-bold text-slate-300">Printer Profile</h3>
            <div><label className="text-[10px] font-bold text-slate-500 uppercase">Printer Name</label><input name="name" value={formData.name} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none" placeholder="e.g. Ender 3 #1" /></div>
            <div className="grid grid-cols-2 gap-4">
               <div><label className="text-[10px] font-bold text-slate-500 uppercase">Model</label><input name="model" value={formData.model} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none" /></div>
               <div><label className="text-[10px] font-bold text-slate-500 uppercase">Slug</label><input name="slug" value={formData.slug} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none" /></div>
            </div>
            <div className="flex justify-end pt-4"><button onClick={() => setStep(2)} className="bg-blue-600 px-6 py-2 rounded-lg font-bold flex items-center">Next <ChevronRight size={18} /></button></div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 text-left">
            <h3 className="font-bold text-slate-300">Select Target Node</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
               {nodes.map(node => (
                 <button key={node.id} onClick={() => handleNodeSelect(node.id)} className="w-full flex items-center justify-between p-4 bg-slate-900 border border-slate-700 rounded-xl hover:border-blue-500 group transition-all">
                    <div className="flex items-center space-x-3">
                       <Server className="text-blue-500" size={20} />
                       <div className="text-left">
                          <p className="font-bold text-sm text-slate-200">{node.name || node.hostname}</p>
                          <p className="text-[10px] text-slate-500">{node.ip_address}</p>
                       </div>
                    </div>
                    <ChevronRight size={16} className="text-slate-600 group-hover:text-blue-500" />
                 </button>
               ))}
               {nodes.length === 0 && <p className="text-center py-8 text-slate-500">No online/approved nodes available.</p>}
            </div>
            <div className="flex justify-start pt-4"><button onClick={() => setStep(1)} className="text-slate-500 font-bold flex items-center hover:text-white transition-colors"><ChevronLeft size={18} /> Back</button></div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h3 className="font-bold text-slate-300">Select MCU Serial</h3>
            {mcuLoading ? <div className="py-12 flex justify-center"><RefreshCw className="animate-spin text-blue-500" /></div> : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                   {mcus.available.map(dev => (
                     <button key={dev.path} onClick={() => { setFormData(prev => ({ ...prev, expected_mcu_serial: dev.path })); setStep(4); }} className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-left hover:border-blue-500 group">
                        <div className="flex items-center space-x-2"><Usb size={14} className="text-blue-500" /><span className="text-xs font-mono truncate">{dev.id}</span></div>
                        <p className="text-[9px] text-slate-500 mt-1">{dev.path}</p>
                     </button>
                   ))}
                   {mcus.available.length === 0 && <p className="text-[11px] text-slate-500 italic py-4">No unused USB serial devices detected.</p>}
              </div>
            )}
            <div className="flex justify-between pt-4">
               <button onClick={() => setStep(2)} className="text-slate-500 font-bold flex items-center hover:text-white transition-colors"><ChevronLeft size={18} /> Back</button>
               <button onClick={() => fetchMcus(formData.assigned_node_id)} className="p-2 bg-slate-700 rounded-lg text-slate-300"><RefreshCw size={16} /></button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
             <h3 className="font-bold text-slate-300">Instance Configuration</h3>
             <div className="bg-slate-900 p-4 rounded-xl space-y-3">
                <div className="flex items-center space-x-2"><Check size={16} className="text-green-500" /><p className="text-xs text-slate-300 italic">Services: klipper-${formData.slug}.service / moonraker-${formData.slug}.service</p></div>
                <div>
                   <label className="text-[10px] font-bold text-slate-500 uppercase">Moonraker Port</label>
                   <input type="number" name="moonraker_port" value={formData.moonraker_port} onChange={handleInputChange} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none mt-1" />
                </div>
             </div>
             <div className="flex justify-between pt-4">
                <button onClick={() => setStep(3)} className="text-slate-500 font-bold flex items-center hover:text-white transition-colors"><ChevronLeft size={18} /> Back</button>
                <button onClick={() => setStep(5)} className="bg-blue-600 px-6 py-2 rounded-lg font-bold flex items-center">Review <ChevronRight size={18} /></button>
             </div>
          </div>
        )}

        {step === 5 && (
           <div className="space-y-4">
              <h3 className="font-bold text-slate-300">Review & Create</h3>
              <div className="bg-slate-900 rounded-xl divide-y divide-slate-800 text-sm">
                 <div className="p-3 flex justify-between"><span>Printer:</span><span className="font-bold text-blue-400">{formData.name}</span></div>
                 <div className="p-3 flex justify-between"><span>Model:</span><span className="text-slate-300">{formData.model}</span></div>
                 <div className="p-3 flex justify-between"><span>Node:</span><span className="text-slate-300">{nodes.find(n=>n.id === formData.assigned_node_id)?.hostname}</span></div>
                 <div className="p-3">
                    <span className="block text-slate-500 text-[10px] uppercase font-bold mb-1">MCU Serial</span>
                    <span className="font-mono text-[11px] text-slate-400 break-all">{formData.expected_mcu_serial}</span>
                 </div>
              </div>
              <div className="flex justify-between pt-4">
                 <button onClick={() => setStep(4)} className="text-slate-500 font-bold flex items-center hover:text-white transition-colors"><ChevronLeft size={18} /> Back</button>
                 <button disabled={isSubmitting} onClick={handleSubmit} className="bg-green-600 hover:bg-green-700 px-8 py-3 rounded-xl font-bold flex items-center space-x-2 text-white shadow-lg">
                    {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <><Check size={18} /> <span>Initialise Printer</span></>}
                 </button>
              </div>
           </div>
        )}
      </Modal>
    </div>
  );
};

export default Fleet;
