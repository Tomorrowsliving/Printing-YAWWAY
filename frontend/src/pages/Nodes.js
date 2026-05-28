import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Server, HardDrive, RefreshCw, Plus, Loader2, Layers, Edit, Trash2, ArrowUpCircle, Search, Power, Settings2, Info, Activity, Thermometer, Clock, Cpu } from 'lucide-react';
import { nodeService } from '../services/api';
import { Modal } from '../components/UI';
import axios from 'axios';

const OPERATION_DETAILS = {
  nfs_mounting: {
    label: 'Connecting NFS',
    message: 'Storage setup is running. The agent may briefly stop answering while packages or mounts settle.'
  },
  node_updating: {
    label: 'Updating',
    message: 'The node agent is updating. It may briefly disconnect while services restart.'
  },
  agent_restarting: {
    label: 'Restarting Agent',
    message: 'Agent restart requested. Waiting for the next heartbeat before marking it ready.'
  },
  node_rebooting: {
    label: 'Rebooting',
    message: 'The Pi is rebooting. It will come back online after it starts and sends a heartbeat.'
  },
  services_restarting: {
    label: 'Restarting Services',
    message: 'Printer services are restarting. Status checks may pause for a moment.'
  }
};

const LOCAL_ACTION_DETAILS = {
  approve: { label: 'Approving', message: 'Approving this node and queueing storage auto-connect.' },
  refresh: { label: 'Refreshing', message: 'Checking the node health and current agent details.' },
  'mount-nfs': OPERATION_DETAILS.nfs_mounting,
  'update-agent': OPERATION_DETAILS.node_updating,
  'restart-agent': OPERATION_DETAILS.agent_restarting,
  reboot: OPERATION_DETAILS.node_rebooting,
  'restart-services': OPERATION_DETAILS.services_restarting
};

const ACTION_MIN_VISIBLE_MS = {
  refresh: 1000,
  approve: 1200,
  delete: 900,
  'mount-nfs': 1600,
  'update-agent': 1600,
  'restart-agent': 1400,
  reboot: 1600,
  'restart-services': 1400
};

const NODE_VIEW_MODE_KEY = 'klipper-farm-node-view-mode';

const formatLastSeen = (value) => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 20) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const clampPercent = (value) => Math.min(100, Math.max(0, Number(value) || 0));

const formatPercent = (value) => `${clampPercent(value).toFixed(clampPercent(value) < 10 ? 1 : 0)}%`;

const formatMb = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '';
  if (number >= 1024) return `${(number / 1024).toFixed(number >= 10240 ? 0 : 1)} GB`;
  return `${number.toFixed(0)} MB`;
};

const formatUptime = (value, secondsValue) => {
  let seconds = Number(secondsValue);
  if (!Number.isFinite(seconds) && typeof value === 'string') {
    const match = value.match(/^(\d+)s$/);
    if (match) seconds = Number(match[1]);
  }
  if (!Number.isFinite(seconds)) return value || 'Unknown';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
};

const usageColor = (value) => {
  const percent = clampPercent(value);
  if (percent >= 85) return 'bg-red-400';
  if (percent >= 65) return 'bg-orange-400';
  return 'bg-green-400';
};

const temperatureColor = (value) => {
  const temp = Number(value) || 0;
  if (temp >= 75) return 'text-red-300';
  if (temp >= 60) return 'text-orange-300';
  return 'text-green-300';
};

const MetricBar = ({ icon: Icon, label, value, subtext, percent }) => (
  <div className="bg-slate-900/50 p-2.5 rounded-lg border border-slate-700/50 min-w-0">
    <div className="flex items-center justify-between gap-2 mb-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <Icon size={13} className="text-slate-500 shrink-0" />
        <p className="text-[10px] font-bold text-slate-500 uppercase truncate">{label}</p>
      </div>
      <p className="font-bold text-sm text-slate-100 tabular-nums">{value}</p>
    </div>
    {typeof percent === 'number' && (
      <div className="h-1.5 rounded-full bg-slate-950/80 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ease-out ${usageColor(percent)}`} style={{ width: `${clampPercent(percent)}%` }} />
      </div>
    )}
    {subtext && <p className="mt-1.5 text-[9px] text-slate-500 truncate">{subtext}</p>}
  </div>
);

const SimpleMetric = ({ label, value, tone = 'text-slate-100' }) => (
  <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 px-2.5 py-2 min-w-0">
    <p className="text-[9px] font-bold uppercase text-slate-500 truncate">{label}</p>
    <p className={`text-sm font-bold tabular-nums truncate ${tone}`}>{value}</p>
  </div>
);

const ActionButton = ({ icon: Icon, label, onClick, disabled, busy, tone = 'default', title }) => {
  const tones = {
    default: 'bg-slate-700/80 hover:bg-slate-600 text-slate-200 border-slate-600/60',
    blue: 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border-blue-500/30',
    green: 'bg-green-600/15 hover:bg-green-600/25 text-green-300 border-green-500/25',
    orange: 'bg-orange-600/15 hover:bg-orange-600/25 text-orange-300 border-orange-500/25',
    red: 'bg-red-600/15 hover:bg-red-600/25 text-red-300 border-red-500/25',
    muted: 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-700',
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title || label}
      className={`h-9 min-w-0 rounded-lg border px-2 text-[10px] font-bold uppercase tracking-normal transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45 flex items-center justify-center gap-1.5 ${tones[tone] || tones.default}`}
    >
      {busy ? <Loader2 size={13} className="animate-spin shrink-0" /> : <Icon size={13} className="shrink-0" />}
      <span className="truncate">{label}</span>
    </button>
  );
};

const NodeOverview = ({ addToast }) => {
  const [nodes, setNodes] = useState([]);
  const [storageStatus, setStorageStatus] = useState({});
  const [hardwareStatus, setHardwareStatus] = useState({});
  const [nfsInfo, setNfsInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [nodeActions, setNodeActions] = useState({});
  const [viewMode, setViewMode] = useState(() => {
    try {
      return window.localStorage.getItem(NODE_VIEW_MODE_KEY) || 'simple';
    } catch (e) {
      return 'simple';
    }
  });
  const actionClearTimers = useRef({});
  const [selectedNode, setSelectedNode] = useState(null);

  const [formData, setFormData] = useState({ hostname: '', ip_address: '', agent_port: 8001, model: '', notes: '' });
  const [editData, setEditData] = useState({ hostname: '', ip_address: '', agent_port: 8001, model: '', notes: '', approved: false });
  const isAdvancedMode = viewMode === 'advanced';

  const updateViewMode = (mode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(NODE_VIEW_MODE_KEY, mode);
    } catch (e) {}
  };

  const setNodeAction = (nodeId, action) => {
    const key = String(nodeId);
    if (actionClearTimers.current[key]) {
      clearTimeout(actionClearTimers.current[key]);
      delete actionClearTimers.current[key];
    }

    if (action) {
      const now = Date.now();
      const visibleMs = ACTION_MIN_VISIBLE_MS[action] || 1000;
      setNodeActions(prev => ({
        ...prev,
        [nodeId]: {
          action,
          startedAt: now,
          minUntil: now + visibleMs
        }
      }));
      return;
    }

    setNodeActions(prev => {
      const current = prev[nodeId];
      if (!current) return prev;
      const waitMs = Math.max(0, (current.minUntil || 0) - Date.now());
      if (waitMs > 0) {
        actionClearTimers.current[key] = setTimeout(() => {
          setNodeActions(inner => {
            const next = { ...inner };
            delete next[nodeId];
            return next;
          });
          delete actionClearTimers.current[key];
        }, waitMs);
        return prev;
      }
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  };

  const isNodeBusy = (nodeId) => Boolean(nodeActions[nodeId]);
  const nodeAction = (nodeId) => {
    const current = nodeActions[nodeId];
    return typeof current === 'string' ? current : current?.action || '';
  };
  const getNodeOperation = (node) => {
    const localAction = nodeAction(node.id);
    if (node.active_operation) {
      return {
        operation: node.active_operation,
        ...(OPERATION_DETAILS[node.active_operation] || { label: node.active_operation.replaceAll('_', ' '), message: node.active_operation_message }),
        message: node.active_operation_message || OPERATION_DETAILS[node.active_operation]?.message
      };
    }
    if (localAction && LOCAL_ACTION_DETAILS[localAction]) {
      return { operation: localAction, ...LOCAL_ACTION_DETAILS[localAction] };
    }
    if (OPERATION_DETAILS[node.status]) {
      return { operation: node.status, ...OPERATION_DETAILS[node.status] };
    }
    return null;
  };

  const fetchNfsInfo = useCallback(async () => {
    try {
        const res = await axios.get('/api/storage/nfs-status');
        setNfsInfo(res.data);
    } catch (err) {}
  }, []);

  const fetchNodeStorage = useCallback(async (node) => {
      try {
          setStorageStatus(prev => {
            const current = prev[node.id] || {};
            return {
              ...prev,
              [node.id]: {
                ...current,
                checking: !current.nfs_available,
                refreshing: true
              }
            };
          });
          const res = await axios.get(`/api/nodes/${node.id}/storage/check`);
          setStorageStatus(prev => ({ ...prev, [node.id]: { ...res.data, checking: false, refreshing: false, checked_at: new Date().toISOString() } }));
      } catch (err) {
          setStorageStatus(prev => ({ ...prev, [node.id]: { ...(prev[node.id] || {}), checking: false, refreshing: false, nfs_available: false, error: 'Storage check failed' } }));
      }
  }, []);

  const fetchNodeHardware = useCallback(async (node) => {
    try {
      const requestedAt = new Date().toISOString();
      setHardwareStatus(prev => ({
        ...prev,
        [node.id]: {
          ...(prev[node.id] || {}),
          loading: !prev[node.id],
        }
      }));
      const res = await axios.get(`/api/nodes/${node.id}/health`, { params: { _: Date.now() } });
      setHardwareStatus(prev => ({
        ...prev,
        [node.id]: {
          ...res.data,
          loading: false,
          error: null,
          node_checked_at: res.data.checked_at,
          checked_at: requestedAt
        }
      }));
    } catch (err) {
      setHardwareStatus(prev => ({
        ...prev,
        [node.id]: {
          ...(prev[node.id] || {}),
          loading: false,
          error: err.response?.data?.detail || 'Live health unavailable'
        }
      }));
    }
  }, []);

  const fetchNodes = useCallback(async () => {
    try {
      const res = await nodeService.getNodes();
      const nodeData = Array.isArray(res.data) ? res.data : [];
      setNodes(nodeData);

      // Fetch storage status for each online node
      nodeData.filter(n => n.online).forEach(node => {
          fetchNodeStorage(node);
      });
    } catch (err) {
      console.error("Error fetching nodes:", err);
    } finally {
      setLoading(false);
    }
  }, [fetchNodeStorage]);

  useEffect(() => {
    fetchNodes();
    fetchNfsInfo();
    const interval = setInterval(fetchNodes, 10000);
    return () => clearInterval(interval);
  }, [fetchNodes, fetchNfsInfo]);

  const liveHardwareNodeKey = nodes
    .filter(node => node.online || node.active_operation)
    .map(node => `${node.id}:${node.ip_address}:${node.agent_port}:${node.online}:${node.active_operation || ''}`)
    .join('|');

  useEffect(() => {
    const liveNodes = nodes.filter(node => node.online || node.active_operation);
    if (liveNodes.length === 0) return undefined;

    liveNodes.forEach(fetchNodeHardware);
    const interval = setInterval(() => {
      liveNodes.forEach(fetchNodeHardware);
    }, 5000);
    return () => clearInterval(interval);
  }, [liveHardwareNodeKey, fetchNodeHardware, nodes]);

  useEffect(() => {
    const timers = actionClearTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

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
    setNodeAction(nodeId, 'approve');
    try {
      await axios.post(`/api/nodes/${nodeId}/approve`);
      addToast("Node approved; storage auto-connect queued", "success");
      fetchNodes();
    } catch (err) {
      addToast(err.response?.data?.detail || "Failed to approve node", "error");
    } finally {
      setNodeAction(nodeId, null);
    }
  };

  const handleDeleteNode = async (nodeId) => {
    if (!window.confirm("Remove this node?")) return;
    setNodeAction(nodeId, 'delete');
    try {
      await nodeService.deleteNode(nodeId);
      addToast("Node removed", "success");
      fetchNodes();
    } catch (err) {
      addToast(err.response?.data?.detail || "Failed to delete node", "error");
    } finally {
      setNodeAction(nodeId, null);
    }
  };

  const handleRefresh = async (node) => {
    setNodeAction(node.id, 'refresh');
    try {
      await axios.post(`/api/nodes/${node.id}/refresh`);
      fetchNodes();
      addToast("Refresh complete", "success");
    } catch (err) {
      addToast(err.response?.data?.detail || "Node unreachable", 'error');
    } finally {
      setNodeAction(node.id, null);
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

  const handleNodeAction = async (nodeId, action) => {
    const actionMap = {
        'restart-agent': { url: `/api/nodes/${nodeId}/restart-agent`, label: 'Agent restart' },
        'reboot': { url: `/api/nodes/${nodeId}/reboot`, label: 'Node reboot' },
        'restart-services': { url: `/api/nodes/${nodeId}/restart-services`, label: 'Service restart' },
        'mount-nfs': { url: `/api/nodes/${nodeId}/storage/mount`, label: 'NFS mount' }
    };

    const config = actionMap[action];

    let confirmMsg = `Initiate ${config.label} for this node?`;
    if (action === 'mount-nfs') {
        const serverIp = nfsInfo?.mount_command_nfs4?.split(' ')[3]?.split(':')[0] || 'the server';
        confirmMsg = `Initiate NFS mount? This will attempt to mount central storage from ${serverIp} on this Pi node.`;
    }

    if (!window.confirm(confirmMsg)) return;

    setNodeAction(nodeId, action);
    try {
        const res = await axios.post(config.url);
        if (action === 'mount-nfs' && res.data.success === false) {
             addToast(res.data.message || "Mount failed", "error");
        } else {
             addToast(`${config.label} initiated`, "success");
        }

        // Immediate refresh for storage actions
        if (action === 'mount-nfs') {
            const node = nodes.find(n => n.id === nodeId);
            if (node) fetchNodeStorage(node);
        }

        fetchNodes();
    } catch (err) {
        const msg = err.response?.data?.detail || err.response?.data?.message || `Failed to initiate ${config.label}`;
        addToast(msg, "error");
    } finally {
        setNodeAction(nodeId, null);
    }
  };

  const handleUpdateNodeAgent = async (nodeId) => {
    if (!window.confirm("Trigger remote update on this node?")) return;
    setNodeAction(nodeId, 'update-agent');
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
      setNodeAction(nodeId, null);
    }
  };

  if (loading && nodes.length === 0) {
    return <div className="p-12 text-center text-slate-500 animate-pulse">Initialising...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Nodes</h2>
          <p className="text-xs text-slate-500 mt-1">{isAdvancedMode ? 'Advanced controls are visible.' : 'Simple controls are shown.'}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-lg border border-slate-700 bg-slate-800/80 p-1 flex items-center gap-1">
            <button
              type="button"
              onClick={() => updateViewMode('simple')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${!isAdvancedMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => updateViewMode('advanced')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${isAdvancedMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
            >
              Advanced
            </button>
          </div>

          <button onClick={() => setIsModalOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center space-x-2 shadow-lg shadow-blue-900/20">
            <Plus size={18} /> <span>Add Manual</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {nodes.map((node) => {
          const operation = getNodeOperation(node);
          const showOperationPanel = operation && operation.operation !== 'refresh';
          const actionDisabled = isNodeBusy(node.id) || Boolean(node.active_operation);
          const storage = storageStatus[node.id] || {};
          const storageBusy = operation?.operation === 'nfs_mounting' || nodeAction(node.id) === 'mount-nfs';
          const nodeLooksOnline = node.online || Boolean(operation);
          const statusLabel = operation ? operation.label : node.status;
          const statusClass = operation
            ? 'bg-blue-900/50 text-blue-300 border border-blue-500/30'
            : node.online
              ? 'bg-green-900/40 text-green-400'
              : 'bg-red-900/40 text-red-400';
          const iconClass = operation
            ? 'bg-blue-500/10 text-blue-400'
            : node.online
              ? 'bg-green-500/10 text-green-500'
              : 'bg-red-500/10 text-red-500';
          const storageClass = storageBusy
            ? 'bg-blue-500/5 border-blue-500/20'
            : storage.nfs_available
              ? 'bg-green-500/5 border-green-500/20'
              : 'bg-orange-500/5 border-orange-500/20';
          const storageTextClass = storageBusy
            ? 'text-blue-400'
            : storage.nfs_available
              ? 'text-green-500'
              : 'text-orange-500';
          const storageText = storageBusy ? 'Connecting' : storage.checking ? 'Checking' : storage.nfs_available ? 'Available' : (storage.mounted ? 'Issues' : 'Not Mounted');
          const hardware = hardwareStatus[node.id] || {};
          const cpuUsage = hardware.cpu_usage ?? node.cpu_usage ?? 0;
          const ramUsage = hardware.ram_usage ?? node.ram_usage ?? 0;
          const temperature = hardware.temperature ?? node.temperature ?? 0;
          const cpuSubtext = hardware.cpu_count
            ? `${hardware.cpu_count} cores${hardware.load_average?.load_1m !== undefined ? ` - load ${hardware.load_average.load_1m}` : ''}`
            : hardware.source === 'live'
              ? 'Live sample'
              : 'Heartbeat sample';
          const ramSubtext = hardware.ram_total_mb
            ? `${formatMb(hardware.ram_used_mb)} / ${formatMb(hardware.ram_total_mb)}`
            : hardware.source === 'live'
              ? 'Live sample'
              : 'Heartbeat sample';
          const diskPercent = hardware.root_disk?.percent;
          const diskSubtext = hardware.root_disk ? `${formatMb(hardware.root_disk.free_mb)} free` : null;
          const healthFreshness = hardware.checked_at ? `Updated ${formatLastSeen(hardware.checked_at)}` : 'Waiting for live sample';

          return (
          <div key={node.id} className={`bg-slate-800 border rounded-xl p-5 space-y-4 transition-all duration-300 ease-out ${node.approved ? 'border-slate-700' : 'border-blue-500 shadow-lg shadow-blue-900/10'}`}>
            <div className="flex justify-between items-start min-w-0">
               <div className="flex items-center space-x-3 truncate">
                  <div className={`p-2 rounded-lg transition-all duration-300 ease-out ${iconClass}`}>
                    {operation ? <Loader2 size={20} className="animate-spin" /> : <Server size={20} />}
                  </div>
                  <div className="truncate text-left">
                    <h3 className="font-bold text-slate-200 truncate">{node.name || node.hostname}</h3>
                    <p className="text-[10px] text-slate-500 font-mono">{`http://${node.ip_address}:${node.agent_port}`}</p>
                    <p className={`text-[9px] transition-colors duration-300 ${operation?.operation === 'refresh' ? 'text-blue-300' : 'text-slate-600'}`}>
                      {operation?.operation === 'refresh' ? 'Refreshing health...' : `Last seen ${formatLastSeen(node.last_seen)}`}
                    </p>
                  </div>
               </div>
               <div className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full transition-all duration-300 ease-out ${statusClass}`}>
                 {statusLabel}
               </div>
            </div>

            {isAdvancedMode ? (
              <div className="rounded-lg border border-slate-700/60 bg-slate-900/20 p-3 space-y-3 transition-all duration-300 ease-out">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity size={14} className="text-blue-400" />
                    <p className="text-[10px] font-bold uppercase text-slate-400">Live Hardware</p>
                  </div>
                  <div className={`flex items-center gap-1 text-[9px] font-bold uppercase ${hardware.error ? 'text-orange-300' : 'text-green-300'}`}>
                    {hardware.loading ? <Loader2 size={10} className="animate-spin" /> : <span className={`h-1.5 w-1.5 rounded-full ${hardware.error ? 'bg-orange-300' : 'bg-green-300'}`} />}
                    <span>{hardware.error ? 'Heartbeat' : healthFreshness}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <MetricBar icon={Cpu} label="CPU" value={formatPercent(cpuUsage)} percent={cpuUsage} subtext={cpuSubtext} />
                  <MetricBar icon={Activity} label="RAM" value={formatPercent(ramUsage)} percent={ramUsage} subtext={ramSubtext} />
                  <MetricBar
                    icon={Thermometer}
                    label="Temp"
                    value={<span className={temperatureColor(temperature)}>{Number(temperature || 0).toFixed(temperature >= 10 ? 0 : 1)}C</span>}
                    subtext={temperature ? (temperature >= 75 ? 'Hot' : temperature >= 60 ? 'Warm' : 'Normal') : 'No sensor'}
                  />
                  <MetricBar
                    icon={diskPercent !== undefined ? HardDrive : Clock}
                    label={diskPercent !== undefined ? 'Disk' : 'Uptime'}
                    value={diskPercent !== undefined ? formatPercent(diskPercent) : formatUptime(hardware.uptime ?? node.uptime, hardware.uptime_seconds)}
                    percent={diskPercent !== undefined ? diskPercent : undefined}
                    subtext={diskSubtext || `Up ${formatUptime(hardware.uptime ?? node.uptime, hardware.uptime_seconds)}`}
                  />
                </div>
                {hardware.error && (
                  <p className="text-[9px] text-orange-200/70 leading-tight">Live health is not responding, showing the last heartbeat values.</p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 transition-all duration-300 ease-out">
                <SimpleMetric label="CPU" value={formatPercent(cpuUsage)} />
                <SimpleMetric label="RAM" value={formatPercent(ramUsage)} />
                <SimpleMetric label="Temp" value={`${Number(temperature || 0).toFixed(temperature >= 10 ? 0 : 1)}C`} tone={temperatureColor(temperature)} />
              </div>
            )}

            {showOperationPanel && (
              <div className="p-3 rounded-lg border border-blue-500/20 bg-blue-500/5 text-blue-100 space-y-1 transition-all duration-300 ease-out animate-in fade-in slide-in-from-top-1">
                <div className="flex items-center space-x-2 text-blue-300">
                  <Info size={14} />
                  <p className="text-[10px] font-bold uppercase">{operation.label}</p>
                </div>
                <p className="text-[10px] leading-relaxed text-blue-100/80">{operation.message}</p>
                {!node.online && (
                  <p className="text-[9px] leading-relaxed text-blue-200/70">Temporarily keeping this as an in-progress node rather than marking it failed.</p>
                )}
              </div>
            )}

            {(nodeLooksOnline || storageStatus[node.id]) && (
               <div className={`p-3 rounded-lg border flex flex-col space-y-2 transition-all duration-300 ease-out ${storageClass}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                       {storageBusy ? <Loader2 size={16} className="text-blue-400 animate-spin" /> : <HardDrive size={16} className={storage.nfs_available ? 'text-green-500' : 'text-orange-500'} />}
                       <div>
                          <p className="text-[10px] font-bold uppercase text-slate-400">NFS Storage</p>
                          {isAdvancedMode && (
                            <p className="text-[9px] text-slate-500 truncate max-w-[120px]">{storage.mount_path || '/mnt/klipper-farm'}</p>
                          )}
                       </div>
                    </div>
                    <div className={`text-[10px] font-bold ${storageTextClass}`}>
                     {storageText}
                    </div>
                  </div>

                  {node.approved && !storage.nfs_available && (
                    <p className="text-[9px] text-orange-200/80 leading-tight">
                      {storageBusy ? 'Auto-connect is running now. Health checks may pause while the mount is created.' : 'Auto-connect runs after approval and each node boot. Use the button to retry now.'}
                    </p>
                  )}

                  {(!storage.nfs_available && node.approved) && (
                    <button
                      onClick={() => handleNodeAction(node.id, 'mount-nfs')}
                      disabled={actionDisabled || storageBusy}
                      className="w-full py-1 bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 text-[10px] font-bold rounded border border-orange-500/30 transition-colors flex items-center justify-center space-x-1"
                    >
                      {storageBusy ? <Loader2 size={10} className="animate-spin" /> : <HardDrive size={10} />}
                      <span>{storageBusy ? 'Auto-Connecting...' : 'Auto-Connect Now'}</span>
                    </button>
                  )}

                  {storage.error && !storage.mounted && !storageBusy && (
                    <p className="text-[9px] text-red-400 italic leading-tight">{storage.error}</p>
                  )}

                  {isAdvancedMode && storage.mount_source && (
                    <p className="text-[8px] text-slate-600 font-mono italic truncate">Source: {storage.mount_source} ({storage.filesystem_type})</p>
                  )}

                  {isAdvancedMode && node.approved && (
                    <div className="flex items-center gap-1.5 text-[9px] text-green-300/80">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-300/80" />
                      <span>Auto-reconnect after reboot or agent restart is enabled.</span>
                    </div>
                  )}
               </div>
            )}

            {isAdvancedMode && node.last_update_status && (
              <div className={`p-2 rounded-lg text-[10px] border ${node.last_update_status === 'failed' ? 'bg-red-500/5 border-red-500/20 text-red-400' : 'bg-blue-500/5 border-blue-500/20 text-blue-400'}`}>
                <p className="font-bold uppercase mb-0.5">Last Update: {node.last_update_status}</p>
                <p className="opacity-80 italic line-clamp-1">{node.last_update_message}</p>
              </div>
            )}

            <div className="space-y-2 pt-2">
              {!node.approved && (
                <ActionButton
                  icon={Server}
                  label="Approve Node"
                  tone="blue"
                  disabled={actionDisabled}
                  busy={nodeAction(node.id) === 'approve'}
                  onClick={() => handleApprove(node.id)}
                />
              )}

              <div className="grid grid-cols-2 gap-2">
                <ActionButton
                  icon={RefreshCw}
                  label="Refresh"
                  disabled={actionDisabled}
                  busy={nodeAction(node.id) === 'refresh'}
                  onClick={() => handleRefresh(node)}
                />
                <ActionButton
                  icon={Edit}
                  label="Edit"
                  tone="muted"
                  disabled={actionDisabled}
                  onClick={() => handleEditClick(node)}
                />
              </div>

              {isAdvancedMode && (
                <>
                  <div className={`grid gap-2 ${node.agent_version ? 'grid-cols-3' : 'grid-cols-2'}`}>
                    <ActionButton
                      icon={Settings2}
                      label="Agent"
                      tone="blue"
                      disabled={actionDisabled}
                      busy={nodeAction(node.id) === 'restart-agent'}
                      title="Restart node agent"
                      onClick={() => handleNodeAction(node.id, 'restart-agent')}
                    />
                    <ActionButton
                      icon={Layers}
                      label="Services"
                      tone="green"
                      disabled={actionDisabled}
                      busy={nodeAction(node.id) === 'restart-services'}
                      title="Restart printer services"
                      onClick={() => handleNodeAction(node.id, 'restart-services')}
                    />
                    {node.agent_version && (
                      <ActionButton
                        icon={ArrowUpCircle}
                        label="Update"
                        tone="blue"
                        disabled={actionDisabled}
                        busy={nodeAction(node.id) === 'update-agent'}
                        title="Update node agent"
                        onClick={() => handleUpdateNodeAgent(node.id)}
                      />
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <ActionButton
                      icon={Power}
                      label="Reboot"
                      tone="orange"
                      disabled={actionDisabled}
                      busy={nodeAction(node.id) === 'reboot'}
                      title="Reboot node"
                      onClick={() => handleNodeAction(node.id, 'reboot')}
                    />
                    <ActionButton
                      icon={Trash2}
                      label="Delete"
                      tone="red"
                      disabled={actionDisabled}
                      busy={nodeAction(node.id) === 'delete'}
                      onClick={() => handleDeleteNode(node.id)}
                    />
                  </div>
                </>
              )}

            </div>
          </div>
          );
        })}
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
