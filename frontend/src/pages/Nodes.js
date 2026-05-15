import React, { useState, useEffect } from 'react';
import { Server, Activity, Thermometer, Cpu, HardDrive, CheckCircle, XCircle, RefreshCw, Plus, Loader2, Usb, Layers, ShieldCheck, Edit, Trash2, Save, ArrowUpCircle, Search } from 'lucide-react';
import { nodeService, agentService } from '../services/api';
import { Modal } from '../components/UI';
import axios from 'axios';

const NodeOverview = ({ addToast }) => {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [actionNodeId, setActionNodeId] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);

  const [formData, setFormData] = useState({ hostname: '', ip_address: '', agent_port: 8001, model: '', notes: '' });
  const [editData, setEditData] = useState({ hostname: '', ip_address: '', agent_port: 8001, model: '', notes: '', approved: false });

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
    setFormData(prev => ({ ...prev, [name]: name === 'agent_port' ? parseInt(value) || '' : value }));
  };

  const handleEditInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setEditData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : (name === 'agent_port' ? parseInt(value) || '' : value) }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await nodeService.registerNode(formData);
      addToast(`Node registered successfully`, 'success');
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
    if (!window.confirm("Remove this node?")) return;
    setActionNodeId(nodeId);
    try {
      await nodeService.deleteNode(nodeId);
      addToast("Node removed", "success");
      fetchNodes();
    } catch (err) {
      addToast(err.response?.data?.detail || "Failed to delete node", "error");
    } finally {
      setActionNodeId(null);
    }
  };

  const handleRefresh = async (node) => {
    setActionNodeId(node.id);
    try {
      await axios.post(`/api/nodes/${node.id}/refresh`);
      fetchNodes();
      addToast("Refresh complete", "success");
    } catch (err) {
      addToast(err.response?.data?.detail || "Node unreachable", 'error');
    } finally {
      setActionNodeId(null);
    }
  };

  const handleDetectPort = async () => {
    setIsDetecting(true);
    try {
      const res = await axios.post(`/api/nodes/${selectedNode.id}/detect-port`);
      setEditData(prev => ({ ...prev, agent_port: res.data.agent_port }));
      addToast(`Detected agent on port ${res.data.agent_port}`, "success");
    } catch (err) {
      addToast(err.response?.data?.detail || "Could not detect agent port", "error");
    } finally {
      setIsDetecting(false);
    }
  };

  const handleEditClick = (node) => {
    setSelectedNode(node);
    setEditData({
      hostname: node.hostname || '',
      ip_address: node.ip_address || '',
      agent_port: node.agent_port || 8001,
      model: node.model || '',
      notes: node.notes || '',
      approved: node.approved || false
    });
    setIsEditModalOpen(true);
  };

  const handleUpdateNode = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await nodeService.updateNode(selectedNode.id, editData);
      addToast("Node updated", "success");
      setIsEditModalOpen(false);
      fetchNodes();
    } catch (err) {
      addToast(err.response?.data?.detail || "Failed to update node", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateNodeAgent = async (nodeId) => {
    if (!window.confirm("Trigger remote update on this node?")) return;
    setActionNodeId(nodeId);
    try {
      const res = await axios.post(`/api/nodes/${nodeId}/update`);
      const updateData = res.data;

      if (updateData.success) {
         if (updateData.status === 'already_up_to_date') {
            addToast("Node is already up to date", "info");
         } else {
            addToast("Update successful - restart required", "success");
         }
      } else {
         addToast(`Update failed: ${updateData.message}`, "error");
      }
      fetchNodes();
    } catch (err) {
      addToast(err.response?.data?.detail || "Communication failure during update", "error");
    } finally {
      setActionNodeId(null);
    }
  };

  if (loading && nodes.length === 0) {
    return <div className="p-12 text-center text-slate-500 animate-pulse">Initialising...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Nodes</h2>
        <button onClick={() => setIsModalOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center space-x-2 shadow-lg shadow-blue-900/20">
          <Plus size={18} /> <span>Add Manual</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {nodes.map((node) => (
          <div key={node.id} className={`bg-slate-800 border rounded-xl p-5 space-y-4 ${node.approved ? 'border-slate-700' : 'border-blue-500 shadow-lg shadow-blue-900/10'}`}>
            <div className="flex justify-between items-start min-w-0">
               <div className="flex items-center space-x-3 truncate">
                  <div className={`p-2 rounded-lg ${node.online ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}><Server size={20} /></div>
                  <div className="truncate text-left">
                    <h3 className="font-bold text-slate-200 truncate">{node.name || node.hostname}</h3>
                    <p className="text-[10px] text-slate-500 font-mono">http://${node.ip_address}:${node.agent_port}</p>
                  </div>
               </div>
               <div className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${node.online ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
                 {node.status}
               </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
               <div className="bg-slate-900/50 p-2 rounded-lg text-center border border-slate-700/50"><p className="text-[10px] font-bold text-slate-500 uppercase mb-1">CPU</p><p className="font-bold text-sm text-slate-200">{node.cpu_usage || 0}%</p></div>
               <div className="bg-slate-900/50 p-2 rounded-lg text-center border border-slate-700/50"><p className="text-[10px] font-bold text-slate-500 uppercase mb-1">RAM</p><p className="font-bold text-sm text-slate-200">{node.ram_usage || 0}%</p></div>
            </div>

            {node.last_update_status && (
              <div className={`p-2 rounded-lg text-[10px] border ${node.last_update_status === 'failed' ? 'bg-red-500/5 border-red-500/20 text-red-400' : 'bg-blue-500/5 border-blue-500/20 text-blue-400'}`}>
                <p className="font-bold uppercase mb-0.5">Last Update: {node.last_update_status}</p>
                <p className="opacity-80 italic line-clamp-1">{node.last_update_message}</p>
              </div>
            )}

            <div className="flex space-x-2 pt-2">
              <button disabled={actionNodeId === node.id} onClick={() => handleRefresh(node)} className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 py-1.5 rounded-lg text-[10px] font-bold flex items-center justify-center transition-colors">
                {actionNodeId === node.id ? <Loader2 size={12} className="animate-spin" /> : <><RefreshCw size={12} className="mr-1" /> Refresh</>}
              </button>
              <button onClick={() => handleEditClick(node)} className="p-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-400 transition-colors" title="Edit"><Edit size={14} /></button>
              {!node.approved && <button onClick={() => handleApprove(node.id)} className="px-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-[10px] font-bold transition-colors">Approve</button>}
              {node.agent_version && <button onClick={() => handleUpdateNodeAgent(node.id)} className="p-1.5 bg-slate-700 hover:bg-blue-900/40 rounded-lg text-blue-400 transition-colors" title="Update Agent"><ArrowUpCircle size={14} /></button>}
              <button onClick={() => handleDeleteNode(node.id)} className="p-1.5 bg-slate-700 hover:bg-red-900/40 rounded-lg text-red-500/70 transition-colors" title="Delete"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Add Node Manually">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label className="text-[10px] font-bold text-slate-500 uppercase">Hostname</label><input required name="hostname" value={formData.hostname} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-[10px] font-bold text-slate-500 uppercase">IP Address</label><input required name="ip_address" value={formData.ip_address} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" /></div>
            <div><label className="text-[10px] font-bold text-slate-500 uppercase">Agent Port</label><input type="number" name="agent_port" value={formData.agent_port} onChange={handleInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" /></div>
          </div>
          <div className="flex justify-end pt-4"><button disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg font-bold text-sm shadow-lg shadow-blue-900/20">Register</button></div>
        </form>
      </Modal>

      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="Edit Node">
        <form onSubmit={handleUpdateNode} className="space-y-4">
          <div><label className="text-[10px] font-bold text-slate-500 uppercase">Hostname</label><input required name="hostname" value={editData.hostname} onChange={handleEditInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" /></div>
          <div className="flex gap-4">
            <div className="flex-1"><label className="text-[10px] font-bold text-slate-500 uppercase">IP Address</label><input required name="ip_address" value={editData.ip_address} onChange={handleEditInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" /></div>
            <div className="w-32"><label className="text-[10px] font-bold text-slate-500 uppercase">Port</label><input type="number" name="agent_port" value={editData.agent_port} onChange={handleEditInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" /></div>
            <button type="button" onClick={handleDetectPort} disabled={isDetecting} className="self-end p-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-blue-400 transition-colors" title="Detect Port">
               {isDetecting ? <Loader2 size={20} className="animate-spin" /> : <Search size={20} />}
            </button>
          </div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase">Model</label><input name="model" value={editData.model} onChange={handleEditInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" /></div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase">Notes</label><textarea name="notes" value={editData.notes} onChange={handleEditInputChange} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm resize-none outline-none focus:border-blue-500" rows={3} /></div>
          <div className="flex items-center space-x-2"><input type="checkbox" id="approved-check" name="approved" checked={editData.approved} onChange={handleEditInputChange} className="w-4 h-4 rounded bg-slate-900 border-slate-700" /><label htmlFor="approved-check" className="text-xs font-bold text-slate-400 uppercase">Approved</label></div>
          <div className="flex justify-end pt-4"><button disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg font-bold text-sm shadow-lg shadow-blue-900/20">Save Changes</button></div>
        </form>
      </Modal>
    </div>
  );
};

export default NodeOverview;
