import React, { useState, useEffect } from 'react';
import { Server, Activity, Thermometer, Cpu, HardDrive, CheckCircle, XCircle, RefreshCw, Plus, Loader2, Usb, Layers } from 'lucide-react';
import { nodeService, agentService } from '../services/api';
import { Modal } from '../components/UI';

const NodeOverview = ({ addToast }) => {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    hostname: '',
    ip_address: '',
    agent_port: 8000,
    model: '',
    notes: ''
  });

  useEffect(() => {
    fetchNodes();
    const interval = setInterval(fetchNodes, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchNodes = async () => {
    try {
      const res = await nodeService.getNodes();
      setNodes(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Error fetching nodes:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: name === 'agent_port' ? parseInt(value) : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await nodeService.registerNode(formData);
      addToast(`Node ${formData.hostname} registered!`, 'success');
      setIsModalOpen(false);
      fetchNodes();
    } catch (err) {
      addToast("Failed to register node", 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRefresh = async (node) => {
    addToast(`Refreshing health for ${node.hostname}...`, 'info');
    try {
      const res = await agentService.getHealth(node.ip_address, node.agent_port);
      await nodeService.registerNode({
        hostname: node.hostname,
        ip_address: node.ip_address,
        agent_port: node.agent_port,
        ...res.data
      });
      fetchNodes();
      addToast("Health data updated", 'success');
    } catch (err) {
      addToast("Could not reach node agent", 'error');
    }
  };

  if (loading && nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <RefreshCw className="text-blue-500 animate-spin" size={32} />
        <div className="text-slate-400 font-medium">Initialising Nodes...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Node Overview</h2>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors shadow-lg shadow-blue-900/20"
        >
          <Plus size={18} />
          <span>Register Node</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {nodes.map((node) => (
          <div key={node.id} className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4 hover:border-slate-600 transition-colors">
            <div className="flex justify-between items-start">
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-lg ${node.online ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                  <Server size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-lg">{node.hostname}</h3>
                  <p className="text-xs text-slate-400">{node.ip_address}:{node.agent_port}</p>
                </div>
              </div>
              <div className={`flex items-center space-x-1 text-xs font-medium px-2 py-1 rounded-full ${node.online ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                {node.online ? <CheckCircle size={12} /> : <XCircle size={12} />}
                <span>{node.online ? 'Online' : 'Offline'}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900/50 p-3 rounded-lg flex items-center space-x-3">
                <Cpu size={16} className="text-blue-400" />
                <div><p className="text-[10px] text-slate-500 uppercase font-bold">CPU</p><p className="text-sm font-semibold">{node.cpu_usage || 0}%</p></div>
              </div>
              <div className="bg-slate-900/50 p-3 rounded-lg flex items-center space-x-3">
                <HardDrive size={16} className="text-purple-400" />
                <div><p className="text-[10px] text-slate-500 uppercase font-bold">RAM</p><p className="text-sm font-semibold">{node.ram_usage || 0}%</p></div>
              </div>
            </div>

            <div className="flex space-x-2 pt-2">
              <button onClick={() => handleRefresh(node)} className="flex-1 flex items-center justify-center space-x-1 bg-slate-700 hover:bg-slate-600 py-1.5 rounded-lg text-[10px] font-bold transition-colors">
                <RefreshCw size={12} /> <span>Refresh</span>
              </button>
              <button onClick={() => addToast("USB view not implemented yet", "info")} className="flex-1 flex items-center justify-center space-x-1 bg-slate-700 hover:bg-slate-600 py-1.5 rounded-lg text-[10px] font-bold transition-colors">
                <Usb size={12} /> <span>USB</span>
              </button>
              <button onClick={() => addToast("Instance view not implemented yet", "info")} className="flex-1 flex items-center justify-center space-x-1 bg-slate-700 hover:bg-slate-600 py-1.5 rounded-lg text-[10px] font-bold transition-colors">
                <Layers size={12} /> <span>Tasks</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Register Node"
        footer={
          <div className="flex justify-end space-x-3">
            <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-white transition-colors">Cancel</button>
            <button
              form="node-form"
              disabled={isSubmitting}
              className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 px-6 py-2 rounded-lg text-sm font-bold transition-colors"
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <span>Register</span>}
            </button>
          </div>
        }
      >
        <form id="node-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Hostname</label>
            <input required name="hostname" value={formData.hostname} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">IP Address</label>
              <input required name="ip_address" value={formData.ip_address} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Agent Port</label>
              <input type="number" name="agent_port" value={formData.agent_port} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default NodeOverview;
