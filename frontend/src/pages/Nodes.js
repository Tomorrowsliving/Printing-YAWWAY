import React, { useState, useEffect } from 'react';
import { Server, Activity, Thermometer, Cpu, HardDrive, CheckCircle, XCircle, RefreshCw, Plus, Loader2, Usb, Layers, ShieldCheck, Edit, Trash2, Save, ArrowUpCircle } from 'lucide-react';
import { nodeService, agentService } from '../services/api';
import { Modal } from '../components/UI';
import axios from 'axios';

const NodeOverview = ({ addToast }) => {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionNodeId, setActionNodeId] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);

  const [formData, setFormData] = useState({
    hostname: '',
    ip_address: '',
    agent_port: 8001,
    model: '',
    notes: ''
  });

  const [editData, setEditEditData] = useState({
    name: '',
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

  const handleEditInputChange = (e) => {
    const { name, value } = e.target;
    setEditEditData(prev => ({ ...prev, [name]: value }));
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
      addToast(err.response?.data?.detail || "Failed to register node", 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async (nodeId) => {
    setActionNodeId(nodeId);
    try {
      await axios.post(`/api/nodes/${nodeId}/approve`);
      addToast("Node approved", "success");
      fetchNodes();
    } catch (err) {
      addToast(err.response?.data?.detail || "Failed to approve node", "error");
    } finally {
      setActionNodeId(null);
    }
  };

  const handleDeleteNode = async (nodeId) => {
    if (!window.confirm("Are you sure you want to remove this node? This will not stop any services running on the node itself.")) return;
    setActionNodeId(nodeId);
    try {
      await axios.delete(`/api/nodes/${nodeId}`);
      addToast("Node removed from dashboard", "success");
      fetchNodes();
    } catch (err) {
      addToast(err.response?.data?.detail || "Failed to delete node", "error");
    } finally {
      setActionNodeId(null);
    }
  };

  const handleUpdateNodeAgent = async (nodeId) => {
    if (!window.confirm("Trigger remote update on this node? The agent will restart.")) return;
    setActionNodeId(nodeId);
    try {
      await axios.post(`/api/nodes/${nodeId}/update`);
      addToast("Update sequence started", "success");
      fetchNodes();
    } catch (err) {
      addToast(err.response?.data?.detail || "Failed to trigger update", "error");
    } finally {
      setActionNodeId(null);
    }
  };

  const handleEditClick = (node) => {
    setSelectedNode(node);
    setEditEditData({
      name: node.name || '',
      notes: node.notes || ''
    });
    setIsEditModalOpen(true);
  };

  const handleUpdateNode = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await axios.post(`/api/nodes/`, {
        ...selectedNode,
        ...editData
      });
      addToast("Node updated", "success");
      setIsEditModalOpen(false);
      fetchNodes();
    } catch (err) {
      addToast("Failed to update node", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRefresh = async (node) => {
    setActionNodeId(node.id);
    try {
      await axios.post(`/api/nodes/${node.id}/refresh`);
      fetchNodes();
      addToast("Refresh successful", "success");
    } catch (err) {
      addToast(err.response?.data?.detail || "Node unreachable", 'error');
    } finally {
      setActionNodeId(null);
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
        <div>
          <h2 className="text-2xl font-bold">Node Overview</h2>
          <p className="text-xs text-slate-500 mt-1">Management and discovery of Raspberry Pi execution nodes</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors shadow-lg shadow-blue-900/20"
        >
          <Plus size={18} />
          <span>Add Node Manually</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {nodes.map((node) => (
          <div key={node.id} className={`bg-slate-800 border rounded-xl p-5 space-y-4 transition-all ${node.approved ? 'border-slate-700' : 'border-blue-500 shadow-lg shadow-blue-900/10'}`}>
            {!node.approved && (
               <div className="flex items-center justify-between bg-blue-500/10 -mx-5 -mt-5 p-3 px-5 border-b border-blue-500/20 rounded-t-xl mb-4">
                  <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">New Discovery</span>
                  <button
                    disabled={actionNodeId === node.id}
                    onClick={() => handleApprove(node.id)}
                    className="text-[10px] font-bold bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 text-white px-2 py-0.5 rounded flex items-center space-x-1"
                  >
                    {actionNodeId === node.id ? <Loader2 className="animate-spin" size={10} /> : <span>Approve</span>}
                  </button>
               </div>
            )}

            <div className="flex justify-between items-start">
              <div className="flex items-center space-x-3 text-left min-w-0">
                <div className={`p-2 rounded-lg shrink-0 ${node.online ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                  <Server size={24} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-lg truncate pr-2">{node.name || node.hostname}</h3>
                  <p className="text-[10px] font-mono text-slate-500 truncate uppercase">{node.hostname} • v{node.agent_version || '1.0.0'}</p>
                </div>
              </div>
              <div className={`flex items-center space-x-1 text-[10px] font-bold uppercase tracking-tighter px-2 py-0.5 rounded-full shrink-0 ${node.online ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                <span>{node.status}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-700/50">
                <div className="flex items-center space-x-2 mb-1">
                  <Cpu size={14} className="text-blue-400" />
                  <span className="text-[9px] text-slate-500 font-bold uppercase">CPU</span>
                </div>
                <p className="text-sm font-bold">{node.cpu_usage || 0}%</p>
              </div>
              <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-700/50">
                <div className="flex items-center space-x-2 mb-1">
                  <HardDrive size={14} className="text-purple-400" />
                  <span className="text-[9px] text-slate-500 font-bold uppercase">RAM</span>
                </div>
                <p className="text-sm font-bold">{node.ram_usage || 0}%</p>
              </div>
            </div>

            <div className="text-[11px] space-y-1">
               <p className="flex justify-between">
                 <span className="text-slate-500">IP Address:</span>
                 <span className="text-slate-300 font-mono">{node.ip_address}:{node.agent_port}</span>
               </p>
               <p className="flex justify-between">
                 <span className="text-slate-500">Model:</span>
                 <span className="text-slate-300 truncate max-w-[120px]">{node.model || 'Unknown'}</span>
               </p>
               {node.notes && (
                 <p className="text-slate-400 italic mt-2 line-clamp-2">"{node.notes}"</p>
               )}
            </div>

            <div className="flex space-x-2 pt-2">
              <button
                disabled={actionNodeId === node.id}
                onClick={() => handleRefresh(node)}
                className="flex-1 flex items-center justify-center space-x-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 py-2 rounded-lg text-[10px] font-bold transition-colors"
              >
                {actionNodeId === node.id ? <Loader2 className="animate-spin" size={12} /> : <><RefreshCw size={12} /> <span>Refresh</span></>}
              </button>
              <button onClick={() => handleEditClick(node)} className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-slate-400" title="Edit"><Edit size={14} /></button>
              <button onClick={() => handleUpdateNodeAgent(node.id)} className="p-2 bg-slate-700 hover:bg-blue-900/40 rounded-lg transition-colors text-blue-400" title="Update Agent"><ArrowUpCircle size={14} /></button>
              <button onClick={() => handleDeleteNode(node.id)} className="p-2 bg-slate-700 hover:bg-red-900/40 rounded-lg transition-colors text-red-500/70" title="Delete"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Register Node Manually"
        footer={
          <div className="flex justify-end space-x-3">
            <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-white transition-colors">Cancel</button>
            <button
              form="node-form"
              disabled={isSubmitting}
              className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 px-6 py-2 rounded-lg text-sm font-bold transition-colors shadow-lg shadow-blue-900/20"
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

      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Configure Node"
        footer={
          <div className="flex justify-end space-x-3">
            <button onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-white transition-colors">Cancel</button>
            <button
              form="node-edit-form"
              disabled={isSubmitting}
              className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 px-6 py-2 rounded-lg text-sm font-bold transition-colors shadow-lg shadow-blue-900/20"
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <><Save size={18} /><span>Save Changes</span></>}
            </button>
          </div>
        }
      >
        <form id="node-edit-form" onSubmit={handleUpdateNode} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Display Name</label>
            <input name="name" value={editData.name} onChange={handleEditInputChange} placeholder={selectedNode?.hostname} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Notes</label>
            <textarea name="notes" value={editData.notes} onChange={handleEditInputChange} rows={3} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 resize-none" />
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default NodeOverview;
