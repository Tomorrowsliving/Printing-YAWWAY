import React, { useState, useEffect } from 'react';
import {
  Printer, Play, AlertTriangle, ExternalLink, Settings as SettingsIcon,
  RefreshCw, Plus, Loader2, ChevronRight, ChevronLeft, Server, Usb, Check, ShieldAlert, Upload, Book, FileCode
} from 'lucide-react';
import { printerService, nodeService } from '../services/api';
import { Link } from 'react-router-dom';
import { Modal } from '../components/UI';
import axios from 'axios';

const Fleet = ({ addToast }) => {
  const [printers, setPrinters] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Wizard state
  const [step, setStep] = useState(1);
  const [mcus, setMcus] = useState({ available: [], used: [] });
  const [mcuLoading, setMcuLoading] = useState(false);
  const [softwareStatus, setSoftwareStatus] = useState(null);
  const [softwareLoading, setSoftwareLoading] = useState(false);
  const [advancedInstallOpen, setAdvancedInstallOpen] = useState(false);
  const [storageCheck, setStorageCheck] = useState(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [examples, setExamples] = useState([]);
  const [examplesLoading, setExamplesLoading] = useState(false);
  const [selectedExample, setSelectedNodeExample] = useState(null);

  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    model: '',
    assigned_node_id: null,
    expected_mcu_serial: '',
    moonraker_port: 7125,
    webcam_url: '',
    embedded_ui_url: '',
    printer_cfg_content: '',
    config_source: 'minimal' // upload, example, minimal
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

  useEffect(() => {
    if (printers.length === 0 || nodes.length === 0) return;

    let cancelled = false;

    const hydrateRuntimeStatuses = async () => {
      const updatedPrinters = await Promise.all(printers.map(async (printer) => {
        if (printer.status && printer.status !== 'offline') return printer;

        const node = printer.node || nodes.find(n => n.id === printer.assigned_node_id);
        if (!node?.ip_address || !node?.agent_port || !printer.slug) return printer;

        try {
          const res = await axios.get(`http://${node.ip_address}:${node.agent_port}/instances`, { timeout: 4000 });
          const instances = Array.isArray(res.data) ? res.data : [];
          const moonrakerService = instances.find(instance => instance.name === `moonraker-${printer.slug}.service`);
          const klipperService = instances.find(instance => instance.name === `klipper-${printer.slug}.service`);
          const moonrakerRunning = moonrakerService?.active === 'active' || moonrakerService?.status === 'running';
          const klipperRunning = klipperService?.active === 'active' || klipperService?.status === 'running';

          if (moonrakerRunning && klipperRunning) {
            return { ...printer, status: 'online' };
          }
        } catch (err) {}

        return printer;
      }));

      if (cancelled) return;
      const changed = updatedPrinters.some((printer, index) => printer.status !== printers[index]?.status);
      if (changed) setPrinters(updatedPrinters);
    };

    hydrateRuntimeStatuses();

    return () => {
      cancelled = true;
    };
  }, [printers, nodes]);

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
      setNodes(Array.isArray(res.data) ? res.data : []);
    } catch (err) {}
  };

  const checkSoftware = async (nodeId) => {
    setSoftwareLoading(true);
    try {
      const res = await axios.get(`/api/nodes/${nodeId}/software/status`);
      setSoftwareStatus(res.data);
    } catch (err) {
      addToast("Failed to check software status on node", "error");
    } finally {
      setSoftwareLoading(false);
    }
  };

  const installSoftware = async (nodeId, type) => {
    if (!nodeId) return;
    setSoftwareLoading(true);
    const labels = {
      runtime: 'Printer runtime',
      klipper: 'Klipper',
      moonraker: 'Moonraker',
      mainsail: 'Mainsail'
    };
    try {
      const res = await axios.post(`/api/nodes/${nodeId}/software/install/${type}`);
      if (res.data?.status) {
        setSoftwareStatus(res.data.status);
      } else {
        await checkSoftware(nodeId);
      }
      if (res.data?.success === false) {
        addToast(res.data.message || `${labels[type]} install failed`, "error");
      } else {
        addToast(`${labels[type]} installed successfully`, "success");
      }
    } catch (err) {
      addToast(err.response?.data?.detail || `Failed to install ${labels[type]}`, "error");
      setSoftwareLoading(false);
    } finally {
      setSoftwareLoading(false);
    }
  };

  const fetchMcus = async (nodeId) => {
    setMcuLoading(true);
    try {
      const res = await nodeService.getNodeUsb(nodeId);
      const available = res.data;

      // In a real app, we'd cross-reference with existing printers
      setMcus({ available, used: [] });
    } catch (err) {
      addToast(err.response?.data?.detail || "Failed to fetch USB devices from node", "error");
    } finally {
      setMcuLoading(false);
    }
  };

  const fetchExamples = async () => {
    setExamplesLoading(true);
    try {
      const res = await axios.get('/api/files/examples/klipper');
      setExamples(res.data);
    } catch (err) {
      addToast("Failed to fetch Klipper example configs", "error");
    } finally {
      setExamplesLoading(false);
    }
  };

  const selectExample = async (example) => {
    try {
      const res = await axios.get(`/api/files/examples/klipper/content?path=${encodeURIComponent(example.download_url)}`);
      setFormData(prev => ({
        ...prev,
        printer_cfg_content: res.data.content,
        config_source: 'example'
      }));
      setSelectedNodeExample(example.name);
      setStep(5);
    } catch (err) {
      addToast("Failed to fetch example content", "error");
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
    setAdvancedInstallOpen(false);
    setStep(3);
    checkSoftware(nodeId);
    checkStorage(nodeId);
    fetchMcus(nodeId);
  };

  const checkStorage = async (nodeId) => {
    setStorageLoading(true);
    try {
      const res = await axios.get(`/api/nodes/${nodeId}/storage/check`);
      setStorageCheck(res.data);
    } catch (err) {
      addToast("Failed to check storage status on node", "error");
    } finally {
      setStorageLoading(false);
    }
  };

  const handlePrinterRestart = async (printerId, target) => {
    if (!window.confirm(`Restart ${target} for this printer?`)) return;
    try {
        await axios.post(`/api/printers/${printerId}/restart`, { target });
        addToast(`${target} restart initiated`, "success");
    } catch (err) {
        addToast(err.response?.data?.detail || "Restart failed", "error");
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const selectedNode = nodes.find(n => n.id === formData.assigned_node_id);
      const mainsailUrl = selectedNode?.ip_address ? `http://${selectedNode.ip_address}` : formData.embedded_ui_url;
      // 1. Create printer record in central DB
      await printerService.createPrinter({
        ...formData,
        status: 'offline',
        klipper_service_name: `klipper-${formData.slug}`,
        moonraker_service_name: `moonraker-${formData.slug}`,
        config_path: `/mnt/klipper-farm/printers/${formData.slug}/config`,
        gcode_path: `/mnt/klipper-farm/printers/${formData.slug}/gcodes`,
        embedded_ui_url: formData.embedded_ui_url || mainsailUrl,
      });

      // 2. Instruct node agent to create instance
      await nodeService.createNodeInstance(formData.assigned_node_id, {
        printer_slug: formData.slug,
        mcu_serial: formData.expected_mcu_serial,
        moonraker_port: formData.moonraker_port,
        config_path: `/mnt/klipper-farm/printers/${formData.slug}/config`,
        gcode_path: `/mnt/klipper-farm/printers/${formData.slug}/gcodes`,
        logs_path: `/mnt/klipper-farm/printers/${formData.slug}/logs`,
        printer_cfg_content: formData.printer_cfg_content
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
      case 'online': return 'bg-green-500';
      case 'starting': return 'bg-orange-500';
      case 'error': return 'bg-red-500';
      case 'offline': return 'bg-slate-500';
      default: return 'bg-slate-400';
    }
  };

  const getPrinterNode = (printer) => printer.node || nodes.find(n => n.id === printer.assigned_node_id);
  const getPrinterMainsailUrl = (printer) => {
    const node = getPrinterNode(printer);
    return node?.ip_address ? `http://${node.ip_address}` : printer.embedded_ui_url;
  };

  const onlineNodes = nodes.filter(n => n.online);
  const selectedNode = nodes.find(n => n.id === formData.assigned_node_id);
  const mainsailUrl = selectedNode?.ip_address ? `http://${selectedNode.ip_address}` : null;
  const runtimeInstalledCount = ['klipper_installed', 'moonraker_installed', 'mainsail_installed']
    .filter(key => softwareStatus?.[key]).length;
  const runtimeLabel = runtimeInstalledCount === 3 ? 'Installed' : runtimeInstalledCount === 0 ? 'Not Installed' : 'Partial';
  const runtimeReady = Boolean(softwareStatus?.klipper_installed && softwareStatus?.moonraker_installed);
  const nfsReady = Boolean(storageCheck?.nfs_available || (storageCheck?.mounted && storageCheck?.writable));
  const statusClass = (ok) => ok ? 'text-green-500' : 'text-red-400';
  const runtimeClass = runtimeLabel === 'Installed' ? 'text-green-500' : runtimeLabel === 'Partial' ? 'text-orange-400' : 'text-red-400';

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
        {printers.map((printer) => {
          const assignedNode = getPrinterNode(printer);
          const printerMainsailUrl = getPrinterMainsailUrl(printer);

          return (
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
                    <p className="text-xs text-slate-400">Node: {assignedNode?.hostname || assignedNode?.name || 'Unassigned'}</p>
                    {assignedNode?.ip_address && <p className="text-[10px] text-slate-500 font-mono">{assignedNode.ip_address}</p>}
                  </div>
                  <div className="flex space-x-2">
                    <Link to={`/printers/${printer.id}`} className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-slate-300">
                      <SettingsIcon size={16} />
                    </Link>
                    {printerMainsailUrl && (
                      <a href={printerMainsailUrl} target="_blank" rel="noopener noreferrer" className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-slate-300">
                        <ExternalLink size={16} />
                      </a>
                    )}
                  </div>
                </div>

                <div className="py-4">
                  <div className="flex justify-between items-end mb-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{printer.status || 'offline'}</span>
                  </div>
                  <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${getStatusColor(printer.status)} transition-all duration-500`}
                      style={{ width: printer.status === 'printing' ? '45%' : printer.status === 'offline' ? '0%' : '100%' }}
                    ></div>
                  </div>
                </div>

                <div className="flex space-x-2">
                  <button
                    onClick={() => handlePrinterRestart(printer.id, 'all')}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 py-2 rounded-lg text-[10px] font-bold transition-colors text-slate-300 flex items-center justify-center"
                  >
                    <RefreshCw size={12} className="mr-1" /> RESTART
                  </button>
                  <button
                    onClick={() => addToast("Emergency Stop placeholder", "info")}
                    className="px-3 bg-red-900/20 hover:bg-red-900/40 py-2 rounded-lg text-red-500 transition-colors" title="Emergency Stop"
                  >
                    <ShieldAlert size={16} />
                  </button>
                  <button className="px-4 bg-blue-600 hover:bg-blue-700 py-2 rounded-lg transition-colors text-white shadow-lg shadow-blue-900/20"><Play size={16} fill="currentColor" /></button>
                </div>
              </div>
            </div>
          );
        })}
        {printers.length === 0 && <div className="col-span-full py-16 text-center text-slate-500 italic border border-dashed border-slate-700 rounded-xl">No printers found. Click Add Printer to begin.</div>}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setStep(1); }} title={`Guided Printer Setup - Step ${step} of 5`}>
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="font-bold text-slate-300">1. Printer Profile</h3>
            <div><label className="text-[10px] font-bold text-slate-500 uppercase">Printer Name</label><input name="name" value={formData.name} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. Ender 3 #1" /></div>
            <div className="grid grid-cols-2 gap-4">
               <div><label className="text-[10px] font-bold text-slate-500 uppercase">Model</label><input name="model" value={formData.model} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" /></div>
               <div><label className="text-[10px] font-bold text-slate-500 uppercase">Slug</label><input name="slug" value={formData.slug} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" /></div>
            </div>
            <div className="flex justify-end pt-4"><button onClick={() => setStep(2)} className="bg-blue-600 px-6 py-2 rounded-lg font-bold flex items-center">Next <ChevronRight size={18} /></button></div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 text-left">
            <h3 className="font-bold text-slate-300">2. Select Target Node</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
               {onlineNodes.map(node => (
                 <button key={node.id} onClick={() => handleNodeSelect(node.id)} className="w-full flex items-center justify-between p-4 bg-slate-900 border border-slate-700 rounded-xl hover:border-blue-500 group transition-all text-left">
                    <div className="flex items-center space-x-3">
                       <Server className="text-blue-500" size={20} />
                       <div>
                          <p className="font-bold text-sm text-slate-200">{node.name || node.hostname}</p>
                          <p className="text-[10px] text-slate-500">{node.ip_address}</p>
                       </div>
                    </div>
                    <ChevronRight size={16} className="text-slate-600 group-hover:text-blue-500" />
                 </button>
               ))}
               {onlineNodes.length === 0 && <p className="text-center py-8 text-slate-500 italic">No online nodes available.</p>}
            </div>
            <div className="flex justify-start pt-4"><button onClick={() => setStep(1)} className="text-slate-500 font-bold flex items-center hover:text-white transition-colors"><ChevronLeft size={18} /> Back</button></div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h3 className="font-bold text-slate-300">3. Node Software & MCU</h3>

            <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Node Runtime Status</p>
                {mainsailUrl && softwareStatus?.mainsail_installed && (
                  <a href={mainsailUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-blue-400 hover:text-blue-300">
                    {mainsailUrl}
                  </a>
                )}
              </div>

              {(softwareLoading && !softwareStatus) || storageLoading ? (
                <div className="flex items-center space-x-2 text-xs text-blue-400">
                  <Loader2 className="animate-spin" size={14} />
                  <span>Checking node...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="flex justify-between items-center bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2">
                    <span>Printer Runtime:</span>
                    <span className={`${runtimeClass} font-bold`}>{runtimeLabel}</span>
                  </div>
                  <div className="flex justify-between items-center bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2">
                    <span>NFS:</span>
                    <span className={`${statusClass(nfsReady)} font-bold`}>{nfsReady ? 'Mounted + Writable' : 'Needs Attention'}</span>
                  </div>
                  <div className="flex justify-between items-center bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2">
                    <span>Klipper:</span>
                    <span className={`${statusClass(softwareStatus?.klipper_installed)} font-bold`}>{softwareStatus?.klipper_installed ? 'Installed' : 'Missing'}</span>
                  </div>
                  <div className="flex justify-between items-center bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2">
                    <span>Moonraker:</span>
                    <span className={`${statusClass(softwareStatus?.moonraker_installed)} font-bold`}>{softwareStatus?.moonraker_installed ? 'Installed' : 'Missing'}</span>
                  </div>
                  <div className="flex justify-between items-center bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2">
                    <span>Mainsail:</span>
                    <span className={`${statusClass(softwareStatus?.mainsail_installed)} font-bold`}>{softwareStatus?.mainsail_installed ? 'Installed' : 'Missing'}</span>
                  </div>
                  <div className="flex justify-between items-center bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2">
                    <span>nginx:</span>
                    <span className={`${statusClass(softwareStatus?.nginx_installed)} font-bold`}>{softwareStatus?.nginx_installed ? 'Installed' : 'Missing'}</span>
                  </div>
                </div>
              )}

              {softwareStatus && runtimeInstalledCount < 3 && (
                <button
                  onClick={() => installSoftware(formData.assigned_node_id, 'runtime')}
                  disabled={softwareLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 px-4 py-2 rounded-lg font-bold text-sm flex items-center justify-center space-x-2"
                >
                  {softwareLoading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  <span>Install Printer Runtime</span>
                </button>
              )}

              <button
                onClick={() => setAdvancedInstallOpen(prev => !prev)}
                className="text-[10px] font-bold text-slate-500 hover:text-slate-300 uppercase tracking-widest"
              >
                Advanced install options
              </button>

              {advancedInstallOpen && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button disabled={softwareLoading} onClick={() => installSoftware(formData.assigned_node_id, 'klipper')} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 px-3 py-2 rounded-lg text-[10px] font-bold text-slate-300">Install Klipper only</button>
                  <button disabled={softwareLoading} onClick={() => installSoftware(formData.assigned_node_id, 'moonraker')} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 px-3 py-2 rounded-lg text-[10px] font-bold text-slate-300">Install Moonraker only</button>
                  <button disabled={softwareLoading} onClick={() => installSoftware(formData.assigned_node_id, 'mainsail')} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 px-3 py-2 rounded-lg text-[10px] font-bold text-slate-300">Install Mainsail only</button>
                  <button disabled={softwareLoading} onClick={() => installSoftware(formData.assigned_node_id, 'runtime')} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 px-3 py-2 rounded-lg text-[10px] font-bold text-slate-300">Reinstall/Repair runtime</button>
                </div>
              )}
            </div>

            <div className="space-y-2">
               <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Select USB Serial</p>
               {mcuLoading ? <div className="py-8 flex justify-center"><RefreshCw className="animate-spin text-blue-500" /></div> : (
                 <div className="space-y-2 max-h-48 overflow-y-auto">
                      {mcus.available.map(dev => (
                        <button key={dev.path} onClick={() => { setFormData(prev => ({ ...prev, expected_mcu_serial: dev.path, mcu_serial: dev.path })); setStep(4); }} className={`w-full p-3 bg-slate-900 border rounded-lg text-left transition-all ${formData.expected_mcu_serial === dev.path ? 'border-blue-500 bg-blue-500/5' : 'border-slate-700 hover:border-slate-500'}`}>
                           <div className="flex items-center space-x-2"><Usb size={14} className="text-blue-500" /><span className="text-[11px] font-mono truncate">{dev.id}</span></div>
                           <p className="text-[9px] text-slate-500 mt-1">{dev.path}</p>
                        </button>
                      ))}
                      {mcus.available.length === 0 && <p className="text-[11px] text-slate-500 italic py-4">No USB serial devices detected.</p>}
                 </div>
               )}
            </div>

            {storageCheck && !storageCheck.nfs_available && (
               <div className="bg-red-900/10 border border-red-900/30 p-3 rounded-lg flex items-start space-x-3">
                  <AlertTriangle className="text-red-500 mt-0.5" size={16} />
                  <div>
                     <p className="text-[10px] text-red-200 font-bold uppercase">NFS Storage Required</p>
                     <p className="text-[10px] text-red-200/70 leading-tight mt-1">Please ensure central storage is mounted at {storageCheck.mount_path} and writable.</p>
                     <p className="text-[9px] text-slate-500 font-mono mt-2 bg-black/40 p-2 rounded">sudo mount -t nfs SERVER_IP:/exports {storageCheck.mount_path}</p>
                  </div>
               </div>
            )}

            <div className="flex justify-between pt-4">
               <button onClick={() => setStep(2)} className="text-slate-500 font-bold flex items-center hover:text-white transition-colors"><ChevronLeft size={18} /> Back</button>
               <div className="flex space-x-2">
                  <button onClick={() => { checkSoftware(formData.assigned_node_id); checkStorage(formData.assigned_node_id); fetchMcus(formData.assigned_node_id); }} className="p-2 bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors"><RefreshCw size={16} /></button>
                  <button disabled={!runtimeReady || !nfsReady} onClick={() => setStep(4)} className="bg-blue-600 disabled:bg-slate-700 px-6 py-2 rounded-lg font-bold flex items-center">Next <ChevronRight size={18} /></button>
               </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
             <h3 className="font-bold text-slate-300">4. Config Source</h3>
             <div className="grid grid-cols-1 gap-3">
                <button onClick={() => { setFormData(prev => ({ ...prev, config_source: 'minimal', printer_cfg_content: '' })); setStep(5); }} className="flex items-center p-4 bg-slate-900 border border-slate-700 rounded-xl hover:border-blue-500 group transition-all text-left">
                   <div className="p-3 bg-slate-800 rounded-lg mr-4 group-hover:text-blue-400"><FileCode size={24} /></div>
                   <div><p className="font-bold text-sm">Blank / Minimal</p><p className="text-[10px] text-slate-500">Start with a generic cartesian template</p></div>
                </button>
                <button onClick={() => { fetchExamples(); setStep(4.1); }} className="flex items-center p-4 bg-slate-900 border border-slate-700 rounded-xl hover:border-blue-500 group transition-all text-left">
                   <div className="p-3 bg-slate-800 rounded-lg mr-4 group-hover:text-blue-400"><Book size={24} /></div>
                   <div><p className="font-bold text-sm">Official Klipper Examples</p><p className="text-[10px] text-slate-500">Choose from hundreds of printer/board templates</p></div>
                </button>
                <button onClick={() => addToast("Upload not implemented yet", "info")} className="flex items-center p-4 bg-slate-900 border border-slate-700 rounded-xl hover:border-blue-500 group transition-all text-left opacity-50">
                   <div className="p-3 bg-slate-800 rounded-lg mr-4 group-hover:text-blue-400"><Upload size={24} /></div>
                   <div><p className="font-bold text-sm">Upload Files</p><p className="text-[10px] text-slate-500">Upload your own printer.cfg (Experimental)</p></div>
                </button>
             </div>
             <div className="bg-orange-900/10 border border-orange-900/30 p-3 rounded-lg flex items-start space-x-3">
                <AlertTriangle className="text-orange-500 mt-0.5" size={16} />
                <p className="text-[10px] text-orange-200/70 leading-relaxed">Example configs must be reviewed before use. Incorrect pin or motion settings can damage hardware.</p>
             </div>
             <div className="flex justify-start pt-4"><button onClick={() => setStep(3)} className="text-slate-500 font-bold flex items-center hover:text-white transition-colors"><ChevronLeft size={18} /> Back</button></div>
          </div>
        )}

        {step === 4.1 && (
           <div className="space-y-4">
              <h3 className="font-bold text-slate-300">Select Klipper Example</h3>
              <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
                 <div className="p-2 border-b border-slate-800"><input placeholder="Filter templates..." className="w-full bg-slate-800 rounded-lg px-3 py-1.5 text-xs outline-none" /></div>
                 <div className="max-h-64 overflow-y-auto">
                    {examplesLoading ? <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-blue-500" /></div> : (
                       examples.map(ex => (
                         <button key={ex.name} onClick={() => selectExample(ex)} className="w-full px-4 py-2.5 text-left text-xs hover:bg-blue-600/10 hover:text-blue-400 border-b border-slate-800/50 last:border-none">
                            {ex.name}
                         </button>
                       ))
                    )}
                 </div>
              </div>
              <div className="flex justify-start pt-2"><button onClick={() => setStep(4)} className="text-slate-500 font-bold flex items-center hover:text-white transition-colors"><ChevronLeft size={18} /> Back</button></div>
           </div>
        )}

        {step === 5 && (
           <div className="space-y-4">
              <h3 className="font-bold text-slate-300">5. Review & Provision</h3>
              <div className="bg-slate-900 rounded-xl divide-y divide-slate-800 text-[11px] border border-slate-800">
                 <div className="p-3 flex justify-between"><span>Printer:</span><span className="font-bold text-blue-400">{formData.name}</span></div>
                 <div className="p-3 flex justify-between"><span>Node:</span><span className="text-slate-300">{nodes.find(n=>n.id === formData.assigned_node_id)?.hostname}</span></div>
                 <div className="p-3 flex justify-between"><span>Config:</span><span className="text-slate-300">{formData.config_source === 'example' ? `Template: ${selectedExample}` : 'Minimal Template'}</span></div>
                 <div className="p-3">
                    <span className="block text-slate-500 uppercase font-bold mb-1">Target MCU</span>
                    <span className="font-mono text-slate-400 break-all">{formData.expected_mcu_serial}</span>
                 </div>
                 <div className="p-3">
                    <span className="block text-slate-500 uppercase font-bold mb-1">Storage Path (NFS)</span>
                    <span className="font-mono text-slate-400 break-all">/mnt/klipper-farm/printers/{formData.slug}/</span>
                 </div>
              </div>

              <div className="bg-blue-900/10 border border-blue-900/30 p-3 rounded-lg flex items-center space-x-3">
                 <Check size={18} className="text-blue-500" />
                 <p className="text-[10px] text-blue-200/70 italic">Klipper and Moonraker services will be created on the selected node. Mainsail is served from the node on port 80.</p>
              </div>

              <div className="flex justify-between pt-4">
                 <button onClick={() => setStep(4)} className="text-slate-500 font-bold flex items-center hover:text-white transition-colors"><ChevronLeft size={18} /> Back</button>
                 <button disabled={isSubmitting} onClick={handleSubmit} className="bg-green-600 hover:bg-green-700 px-8 py-3 rounded-xl font-bold flex items-center space-x-2 text-white shadow-lg">
                    {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <><Check size={18} /> <span>Provision Printer</span></>}
                 </button>
              </div>
           </div>
        )}
      </Modal>
    </div>
  );
};

export default Fleet;
