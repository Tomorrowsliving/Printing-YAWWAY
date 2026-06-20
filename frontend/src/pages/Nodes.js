import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Server, HardDrive, RefreshCw, Plus, Loader2, Layers, Edit, Trash2, ArrowUpCircle, Search, Power, Settings2, Info, Activity, Thermometer, Clock, Cpu, ArrowLeftRight, Usb } from 'lucide-react';
import { nodeService } from '../services/api';
import { ConfirmActionModal, Modal } from '../components/UI';
import { DetailGrid, EmptyState, HelpText, MetricCard, PageHeader, SearchBox, StatusPill, ToolbarButton } from '../components/DesignSystem';
import axios from 'axios';
import { clampPercent, formatLastSeen, formatMb, formatPercent, formatUptime } from '../utils/format';
import { explainApiError, formatDateTime, nodeStatusMeta } from '../utils/operator';

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
  },
  software_runtime_installing: {
    label: 'Installing Runtime',
    message: 'Klipper, Moonraker, and Mainsail are being installed. Large downloads and Python package builds can make small Pis slow to answer.'
  },
  software_klipper_installing: {
    label: 'Installing Klipper',
    message: 'Klipper runtime is being installed. The node may answer slowly while packages and Python modules finish.'
  },
  software_moonraker_installing: {
    label: 'Installing Moonraker',
    message: 'Moonraker runtime is being installed. Python package builds can take several minutes on small Pis.'
  },
  software_mainsail_installing: {
    label: 'Installing Mainsail',
    message: 'Mainsail and the web server packages are being installed. The node may briefly stop answering.'
  }
};

const LOCAL_ACTION_DETAILS = {
  approve: { label: 'Approving', message: 'Approving this node and queueing storage auto-connect.' },
  refresh: { label: 'Refreshing', message: 'Checking the node health and current agent details.' },
  'mount-nfs': OPERATION_DETAILS.nfs_mounting,
  'update-and-mount': {
    label: 'Updating + NFS',
    message: 'Updating the node agent, retrying once if needed, then testing NFS storage again.'
  },
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
  'update-and-mount': 2200,
  'update-agent': 1600,
  'restart-agent': 1400,
  reboot: 1600,
  'restart-services': 1400
};

const NODE_VIEW_MODE_KEY = 'klipper-farm-node-view-mode';

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
  const [nodeInventory, setNodeInventory] = useState({});
  const [events, setEvents] = useState([]);
  const [nfsInfo, setNfsInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [usbDetailNode, setUsbDetailNode] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [nodeActions, setNodeActions] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
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

  const fetchEvents = useCallback(async () => {
    try {
      const res = await axios.get('/api/events', { params: { limit: 200 } });
      setEvents(Array.isArray(res.data) ? res.data : []);
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
          Promise.allSettled([
            axios.get(`/api/nodes/${node.id}/usb`),
            axios.get(`/api/nodes/${node.id}/instances`)
          ]).then(([usbRes, instanceRes]) => {
            setNodeInventory(prev => ({
              ...prev,
              [node.id]: {
                usb_devices: usbRes.status === 'fulfilled' ? usbRes.value.data : (node.usb_devices || []),
                service_instances: instanceRes.status === 'fulfilled' ? instanceRes.value.data : (node.service_instances || []),
              }
            }));
          });
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
    fetchEvents();
    const interval = setInterval(() => {
      fetchNodes();
      fetchEvents();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchNodes, fetchNfsInfo, fetchEvents]);

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
      addToast(explainApiError(err, {
        what: 'Node registration failed',
        cause: 'The hostname/IP may already exist, or the API could not save the node.',
        fix: 'Check the hostname, IP address, and agent port, then try again.',
      }), 'error');
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
      addToast(explainApiError(err, {
        what: 'Node approval failed',
        cause: 'The API could not approve this node or queue storage auto-connect.',
        fix: 'Refresh the node list and confirm the node still exists.',
      }), "error");
    } finally {
      setNodeAction(nodeId, null);
    }
  };

  const handleDeleteNode = async (nodeId) => {
    setNodeAction(nodeId, 'delete');
    try {
      await nodeService.deleteNode(nodeId);
      addToast("Node removed", "success");
      fetchNodes();
    } catch (err) {
      addToast(explainApiError(err, {
        what: 'Delete node failed',
        cause: 'The API could not remove the node or clear assignments.',
        fix: 'Refresh the node list and check whether the node still exists.',
      }), "error");
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
      addToast(explainApiError(err, {
        what: 'Node refresh failed',
        cause: 'The node-agent health endpoint did not answer.',
        fix: 'Check the node IP, port 8001, and klipper-farm-node-agent service.',
      }), 'error');
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
      addToast(explainApiError(err, {
        what: 'Agent port detection failed',
        cause: 'No node-agent answered on the common ports.',
        fix: 'Check that the node is powered on and the agent service is running.',
      }), "error");
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
      addToast(explainApiError(err, {
        what: 'Node update failed',
        cause: 'The API could not save the node details.',
        fix: 'Check required fields and try again.',
      }), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNodeAction = async (nodeId, action) => {
    const actionMap = {
        'restart-agent': { url: `/api/nodes/${nodeId}/restart-agent`, label: 'Agent restart' },
        'reboot': { url: `/api/nodes/${nodeId}/reboot`, label: 'Node reboot' },
        'restart-services': { url: `/api/nodes/${nodeId}/restart-services`, label: 'Service restart' },
        'mount-nfs': { url: `/api/nodes/${nodeId}/storage/mount`, label: 'NFS mount' },
        'update-and-mount': { url: `/api/nodes/${nodeId}/storage/update-and-mount`, label: 'Update and NFS retry' }
    };

    const config = actionMap[action];

    setNodeAction(nodeId, action);
    try {
        const res = await axios.post(config.url);
        if ((action === 'mount-nfs' || action === 'update-and-mount') && res.data.success === false) {
             addToast(res.data.message || `${config.label} failed`, "error");
        } else {
             addToast(action === 'update-and-mount' ? (res.data.message || 'Node updated and NFS retry completed') : `${config.label} initiated`, "success");
        }

        // Immediate refresh for storage actions
        if (action === 'mount-nfs' || action === 'update-and-mount') {
            const node = nodes.find(n => n.id === nodeId);
            if (node) fetchNodeStorage(node);
        }

        fetchNodes();
    } catch (err) {
        addToast(explainApiError(err, {
          what: `${config.label} failed`,
          cause: 'The node-agent did not complete the requested operation.',
          fix: 'Check node-agent status, network reachability, and the event log.',
        }), "error");
    } finally {
        setNodeAction(nodeId, null);
    }
  };

  const handleUpdateNodeAgent = async (nodeId) => {
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
      addToast(explainApiError(err, {
        what: 'Node update failed',
        cause: 'The dashboard could not complete the remote update request.',
        fix: 'Check node-agent connectivity, then retry from the node card.',
      }), "error");
    } finally {
      setNodeAction(nodeId, null);
    }
  };

  const requestNodeAction = (node, action) => {
    const nodeName = node?.name || node?.hostname || `node ${node?.id}`;
    const serverIp = nfsInfo?.mount_command_nfs4?.split(' ')[3]?.split(':')[0] || 'the server';
    const copy = {
      'restart-agent': {
        title: 'Restart Node Agent',
        actionLabel: 'Restart Agent',
        description: `Restart klipper-farm-node-agent on ${nodeName}.`,
        consequences: [
          'The node may appear offline until the service starts again.',
          'Printer services stay in place, but live health checks may pause briefly.',
        ],
      },
      reboot: {
        title: 'Reboot Node',
        actionLabel: 'Reboot Node',
        description: `Reboot ${nodeName}.`,
        consequences: [
          'The Pi will disconnect from the dashboard.',
          'Any running printer services on this node will be interrupted.',
          'The node should return after boot and a new heartbeat.',
        ],
      },
      'restart-services': {
        title: 'Restart Printer Services',
        actionLabel: 'Restart Services',
        description: `Restart all Klipper and Moonraker services on ${nodeName}.`,
        consequences: [
          'Active prints on this node may stop.',
          'Moonraker and Klipper will briefly disconnect.',
          'Use this after config changes or service errors.',
        ],
      },
      'mount-nfs': {
        title: 'Test NFS Connection',
        actionLabel: 'Test NFS Connection',
        description: `Mount central storage from ${serverIp} on ${nodeName}.`,
        consequences: [
          'The node will install or refresh mount helpers if needed.',
          'The dashboard will recheck /mnt/klipper-farm after the command.',
          'Printer files stay in central storage.',
        ],
        confirmVariant: 'warning',
      },
      'update-agent': {
        title: 'Update Node Agent',
        actionLabel: 'Start Update',
        description: `Update the node agent on ${nodeName}.`,
        consequences: [
          'The current agent version will be replaced if an update is available.',
          'The node may disconnect while dependencies install and services restart.',
          'The result stays visible on the node card until the next update.',
        ],
        confirmVariant: 'warning',
      },
      'update-and-mount': {
        title: 'Update & Retry NFS',
        actionLabel: 'Update & Retry',
        description: `Update the node agent on ${nodeName}, retry the update once if it fails, then try the NFS mount again.`,
        consequences: [
          'The dashboard will run the node-agent update.',
          'If the first update fails, it will automatically try one more time.',
          'If the update succeeds, the dashboard will retry the NFS storage mount.',
          'The node may briefly appear offline while the agent restarts.',
        ],
        confirmVariant: 'warning',
      },
    }[action];

    setConfirmAction({ node, action, ...(copy || {}) });
  };

  const requestDeleteNode = (node) => {
    const nodeName = node?.name || node?.hostname || `node ${node?.id}`;
    setConfirmAction({
      node,
      action: 'delete-node',
      title: 'Delete Node',
      actionLabel: 'Delete Node',
      requireText: 'DELETE',
      description: `Remove ${nodeName} from the dashboard.`,
      consequences: [
        'Printer assignments for this node will be cleared.',
        'Printer files and configs in central storage will not be deleted.',
        'The Pi can register again later if its node agent checks in.',
      ],
    });
  };

  const runConfirmedAction = async () => {
    if (!confirmAction?.node) return;
    const { node, action } = confirmAction;
    setConfirmAction(null);
    if (action === 'delete-node') {
      await handleDeleteNode(node.id);
    } else if (action === 'update-agent') {
      await handleUpdateNodeAgent(node.id);
    } else {
      await handleNodeAction(node.id, action);
    }
  };

  if (loading && nodes.length === 0) {
    return <div className="p-12 text-center text-slate-500 animate-pulse">Initialising...</div>;
  }

  const approvedNodes = nodes.filter(node => node.approved);
  const onlineCount = nodes.filter(node => node.online).length;
  const offlineCount = approvedNodes.filter(node => !node.online).length;
  const storageIssueCount = approvedNodes.filter(node => {
    const storage = storageStatus[node.id];
    return storage && storage.nfs_available === false;
  }).length;
  const piZeroCount = nodes.filter(node => /zero 2/i.test(node.model || '')).length;
  const search = searchTerm.trim().toLowerCase();
  const filteredNodes = nodes.filter((node) => {
    if (!search) return true;
    return [
      node.hostname,
      node.name,
      node.ip_address,
      node.model,
      node.agent_version,
    ].some((value) => String(value || '').toLowerCase().includes(search));
  });
  const latestNodeEvent = (nodeId, matcher) => events.find((event) => (
    String(event.node_id) === String(nodeId) && matcher(event.event_type || '')
  ));
  const usbDetailInventory = usbDetailNode ? (nodeInventory[usbDetailNode.id] || {}) : {};
  const usbDetailDevices = usbDetailNode
    ? (usbDetailInventory.usb_devices || usbDetailNode.usb_devices || [])
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Print Farm"
        title="Nodes"
        description="Raspberry Pi controllers, storage mounts, runtime installs, USB devices, and service health."
        actions={(
          <>
            <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/80 p-1">
            <button
              type="button"
              onClick={() => updateViewMode('simple')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${!isAdvancedMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => updateViewMode('advanced')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${isAdvancedMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
            >
              Advanced
            </button>
          </div>

          <Link to="/nodes/assignments" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 text-sm font-bold text-slate-200 transition-colors hover:border-blue-500/40 hover:bg-slate-750 hover:text-blue-200">
            <ArrowLeftRight size={18} />
            <span>Printer Assignments</span>
          </Link>

          <ToolbarButton icon={Plus} variant="primary" onClick={() => setIsModalOpen(true)}>Add Node</ToolbarButton>
          </>
        )}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Online" value={onlineCount} helper="Heartbeat received" icon={Server} tone="green" />
        <MetricCard label="Offline" value={offlineCount} helper="Approved but unreachable" icon={Power} tone={offlineCount ? 'red' : 'slate'} />
        <MetricCard label="Storage alerts" value={storageIssueCount} helper="NFS checks need attention" icon={HardDrive} tone={storageIssueCount ? 'amber' : 'green'} />
        <MetricCard label="Pi Zero nodes" value={piZeroCount} helper="Keep workloads modest" icon={Info} tone="blue" />
      </div>

      <div className="app-card-soft p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-bold text-slate-200">Node search</p>
            <HelpText>Nodes are Raspberry Pis that run Klipper, Moonraker, and the node agent for printer control.</HelpText>
          </div>
          <SearchBox
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search hostname, IP, model, or version..."
            className="w-full md:w-96"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredNodes.map((node) => {
          const operation = getNodeOperation(node);
          const showOperationPanel = operation && operation.operation !== 'refresh';
          const actionDisabled = isNodeBusy(node.id) || Boolean(node.active_operation);
          const storage = storageStatus[node.id] || {};
          const storageBusy = operation?.operation === 'nfs_mounting' || ['mount-nfs', 'update-and-mount'].includes(nodeAction(node.id));
          const recoveryBusy = nodeAction(node.id) === 'update-and-mount';
          const latestStorageRecoveryEvent = latestNodeEvent(node.id, (type) => type === 'node_storage_auto_mount' || type === 'node_storage_recovery_failed');
          const storageRecoveryRecommended = node.approved && !storage.nfs_available && Boolean(latestStorageRecoveryEvent);
          const storageRecoveryMessage = latestStorageRecoveryEvent?.details?.suggested_fix || latestStorageRecoveryEvent?.message;
          const nodeLooksOnline = node.online || Boolean(operation);
          const statusMeta = nodeStatusMeta(node, operation);
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
          const inventory = nodeInventory[node.id] || {};
          const usbDevices = inventory.usb_devices || node.usb_devices || [];
          const usbSerialDevices = usbDevices.filter((device) => {
            const value = `${device.path || ''} ${device.id || device.device_id || ''}`.toLowerCase();
            return value.includes('serial') || value.includes('by-id') || value.includes('tty') || value.includes('usb');
          });
          const serviceInstances = inventory.service_instances || node.service_instances || [];
          const lastReboot = latestNodeEvent(node.id, (type) => type === 'node_reboot');
          const lastInstall = latestNodeEvent(node.id, (type) => type.includes('install') || type.includes('software'));
          const lastUpdate = latestNodeEvent(node.id, (type) => type.includes('node_update'));
          const warnings = [
            /zero 2/i.test(node.model || '') ? 'Pi Zero 2 W: avoid webcams or multiple printers on this node.' : null,
            Number(temperature || 0) >= 75 ? 'High CPU temperature.' : null,
            Number(cpuUsage || 0) >= 85 ? 'High CPU load.' : null,
            Number(ramUsage || 0) >= 85 ? 'Low RAM headroom.' : null,
            node.approved && storageStatus[node.id] && !storage.nfs_available ? 'NFS mount unavailable.' : null,
            serviceInstances.some(instance => String(instance.active || instance.status || '').toLowerCase().includes('failed')) ? 'One or more services are failed.' : null,
          ].filter(Boolean);

          return (
          <div key={node.id} className={`app-card p-5 space-y-4 transition-all duration-300 ease-out ${node.approved ? '' : 'border-blue-500/60 shadow-blue-950/20'}`}>
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
               <StatusPill tone={statusMeta.tone} pulse={Boolean(operation)} title={statusMeta.tooltip}>{statusMeta.label}</StatusPill>
            </div>

            <DetailGrid
              items={[
                { label: 'Last heartbeat', value: formatLastSeen(node.last_seen), helper: formatDateTime(node.last_seen) },
                { label: 'Last update', value: node.last_update_status || 'Never', helper: node.last_update_at ? formatDateTime(node.last_update_at) : lastUpdate?.message },
                { label: 'Last reboot', value: lastReboot ? formatLastSeen(lastReboot.created_at) : 'Never', helper: lastReboot?.message },
                { label: 'Last install', value: lastInstall ? formatLastSeen(lastInstall.created_at) : 'Never', helper: lastInstall?.message },
              ]}
              className="grid-cols-2"
            />

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

            {!node.online && !operation && (
              <div className="rounded-lg border border-slate-700/70 bg-slate-900/35 p-3 text-[10px] text-slate-300">
                <p className="font-bold uppercase text-slate-400">Offline</p>
                <p className="mt-1 leading-relaxed text-slate-400">The agent is not reachable on the network. This is expected if the Pi is powered down or unplugged.</p>
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
                      {storageBusy
                        ? 'Recovery is running now. Health checks may pause while the node updates or mounts storage.'
                        : storageRecoveryRecommended
                          ? (storageRecoveryMessage || 'Auto-connect failed. Update the node agent and retry NFS.')
                          : 'Auto-connect runs after approval and each node boot. If it fails, update the node agent and retry NFS.'}
                    </p>
                  )}

                  {(!storage.nfs_available && node.approved) && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        onClick={() => requestNodeAction(node, 'mount-nfs')}
                        disabled={actionDisabled || storageBusy}
                        className="w-full py-1 bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 text-[10px] font-bold rounded border border-orange-500/30 transition-colors flex items-center justify-center space-x-1"
                      >
                        {storageBusy && !recoveryBusy ? <Loader2 size={10} className="animate-spin" /> : <HardDrive size={10} />}
                        <span>{storageBusy && !recoveryBusy ? 'Testing...' : 'Test NFS'}</span>
                      </button>
                      <button
                        onClick={() => requestNodeAction(node, 'update-and-mount')}
                        disabled={actionDisabled || storageBusy}
                        className="w-full py-1 bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 text-[10px] font-bold rounded border border-blue-500/30 transition-colors flex items-center justify-center space-x-1"
                      >
                        {recoveryBusy ? <Loader2 size={10} className="animate-spin" /> : <ArrowUpCircle size={10} />}
                        <span>{recoveryBusy ? 'Updating...' : 'Update & Retry'}</span>
                      </button>
                    </div>
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
              <div className={`p-3 rounded-lg text-[10px] border ${node.last_update_status === 'failed' ? 'bg-red-500/5 border-red-500/20 text-red-300' : node.last_update_status === 'already_up_to_date' ? 'bg-green-500/5 border-green-500/20 text-green-300' : 'bg-blue-500/5 border-blue-500/20 text-blue-300'}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-bold uppercase">Update Result: {String(node.last_update_status).replaceAll('_', ' ')}</p>
                  <span className="font-mono text-slate-500">{node.agent_version || 'unknown version'}</span>
                </div>
                <p className="mt-1 opacity-80 line-clamp-2">{node.last_update_message || 'No update message reported.'}</p>
                <p className="mt-1 text-slate-500">Timestamp: {formatDateTime(node.last_update_at)}</p>
              </div>
            )}

            {isAdvancedMode && (
              <div className="rounded-lg border border-slate-700/60 bg-slate-900/30 p-3 space-y-3">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Usb size={14} className="text-purple-300" />
                      <p className="text-[10px] font-bold uppercase text-slate-400">USB Devices</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUsbDetailNode(node)}
                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[9px] font-bold uppercase text-blue-300 hover:border-blue-500/40"
                    >
                      Details
                    </button>
                  </div>
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <SimpleMetric label="USB Serial Devices" value={usbSerialDevices.length} />
                    <SimpleMetric label="Connected USB Devices" value={usbDevices.length} />
                  </div>
                  {usbDevices.length > 0 ? (
                    <div className="space-y-1">
                      {usbDevices.slice(0, 4).map((device, index) => (
                        <p key={`${device.id || device.path}-${index}`} className="truncate font-mono text-[10px] text-slate-400" title={device.path || device.id}>
                          {device.id || device.path}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-orange-300">No serial devices reported.</p>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Layers size={14} className="text-green-300" />
                    <p className="text-[10px] font-bold uppercase text-slate-400">Services</p>
                  </div>
                  {serviceInstances.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {serviceInstances.map((instance) => (
                        <span key={instance.name} className={`rounded-md border px-2 py-1 text-[9px] font-bold uppercase ${String(instance.active || instance.status).toLowerCase().includes('failed') ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-slate-700 bg-slate-950 text-slate-300'}`}>
                          {instance.name}: {instance.active || instance.status}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-500">No Klipper or Moonraker services reported.</p>
                  )}
                </div>
                {warnings.length > 0 && (
                  <div className="rounded-lg border border-orange-500/20 bg-orange-500/10 p-2 text-[10px] text-orange-200 space-y-1">
                    {warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  </div>
                )}
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
                      label="Restart Agent"
                      tone="blue"
                      disabled={actionDisabled}
                      busy={nodeAction(node.id) === 'restart-agent'}
                      title="Restart node agent"
                      onClick={() => requestNodeAction(node, 'restart-agent')}
                    />
                    <ActionButton
                      icon={Layers}
                      label="Restart Services"
                      tone="green"
                      disabled={actionDisabled}
                      busy={nodeAction(node.id) === 'restart-services'}
                      title="Restart printer services"
                      onClick={() => requestNodeAction(node, 'restart-services')}
                    />
                    {node.agent_version && (
                      <ActionButton
                        icon={ArrowUpCircle}
                        label="Update"
                        tone="blue"
                        disabled={actionDisabled}
                        busy={nodeAction(node.id) === 'update-agent'}
                        title="Update node agent"
                        onClick={() => requestNodeAction(node, 'update-agent')}
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
                      onClick={() => requestNodeAction(node, 'reboot')}
                    />
                    <ActionButton
                      icon={Trash2}
                      label="Delete"
                      tone="red"
                      disabled={actionDisabled}
                      busy={nodeAction(node.id) === 'delete'}
                      onClick={() => requestDeleteNode(node)}
                    />
                  </div>
                </>
              )}

            </div>
          </div>
          );
        })}
        {filteredNodes.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={Server}
              title={nodes.length === 0 ? 'No nodes registered' : 'No nodes match this search'}
              description={nodes.length === 0 ? 'Install the node agent on a Raspberry Pi or register a known node manually to begin provisioning printers.' : 'Search by hostname, IP address, model, or version.'}
              action={<ToolbarButton icon={Plus} variant="primary" onClick={() => setIsModalOpen(true)}>Add Node</ToolbarButton>}
            />
          </div>
        )}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Add Node Manually">
        <form onSubmit={handleSubmit} className="space-y-4">
          <HelpText>Nodes are Raspberry Pis that run Klipper, Moonraker, and the node agent. Most nodes register themselves automatically, but manual registration is useful while recovering or testing a Pi.</HelpText>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase">Hostname</label><input required name="hostname" value={formData.hostname} onChange={handleInputChange} className="app-input w-full" placeholder="client1" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-[10px] font-bold text-slate-500 uppercase">IP Address</label><input required name="ip_address" value={formData.ip_address} onChange={handleInputChange} className="app-input w-full" placeholder="10.1.8.136" /></div>
            <div><label className="text-[10px] font-bold text-slate-500 uppercase">Agent Port</label><input type="number" name="agent_port" value={formData.agent_port} onChange={handleInputChange} className="app-input w-full" /></div>
          </div>
          <div className="flex justify-end pt-4"><button disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg font-bold text-sm shadow-lg shadow-blue-900/20">Register</button></div>
        </form>
      </Modal>

      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="Edit Node">
        <form onSubmit={handleUpdateNode} className="space-y-4">
          <HelpText>Keep the IP and agent port aligned with the node-agent install. Changing approval can trigger storage auto-connect on the next heartbeat.</HelpText>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase">Hostname</label><input required name="hostname" value={editData.hostname} onChange={handleEditInputChange} className="app-input w-full" /></div>
          <div className="flex gap-4">
            <div className="flex-1"><label className="text-[10px] font-bold text-slate-500 uppercase">IP Address</label><input required name="ip_address" value={editData.ip_address} onChange={handleEditInputChange} className="app-input w-full" /></div>
            <div className="w-32"><label className="text-[10px] font-bold text-slate-500 uppercase">Port</label><input type="number" name="agent_port" value={editData.agent_port} onChange={handleEditInputChange} className="app-input w-full" /></div>
            <button type="button" onClick={handleDetectPort} disabled={isDetecting} className="self-end p-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-blue-400 transition-colors" title="Detect Port">
               {isDetecting ? <Loader2 size={20} className="animate-spin" /> : <Search size={20} />}
            </button>
          </div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase">Model</label><input name="model" value={editData.model} onChange={handleEditInputChange} className="app-input w-full" placeholder="Raspberry Pi 4" /></div>
          <div><label className="text-[10px] font-bold text-slate-500 uppercase">Notes</label><textarea name="notes" value={editData.notes} onChange={handleEditInputChange} className="app-textarea w-full resize-none" rows={3} /></div>
          <div className="flex items-center space-x-2"><input type="checkbox" id="approved-check" name="approved" checked={editData.approved} onChange={handleEditInputChange} className="w-4 h-4 rounded bg-slate-900 border-slate-700" /><label htmlFor="approved-check" className="text-xs font-bold text-slate-400 uppercase">Approved</label></div>
          <div className="flex justify-end pt-4"><button disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg font-bold text-sm shadow-lg shadow-blue-900/20">Save Changes</button></div>
        </form>
      </Modal>

      <Modal isOpen={Boolean(usbDetailNode)} onClose={() => setUsbDetailNode(null)} title={`USB Details - ${usbDetailNode?.name || usbDetailNode?.hostname || 'Node'}`}>
        <div className="space-y-4">
          <HelpText>Choose the control board connected to this printer. If a serial path changes after unplugging a cable, refresh the node before assigning the MCU.</HelpText>
          {usbDetailDevices.length > 0 ? (
            <div className="space-y-3">
              {usbDetailDevices.map((device, index) => (
                <div key={`${device.path || device.id || index}`} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <DetailGrid
                    items={[
                      { label: 'Device name', value: device.name || device.id || device.device_id || `USB device ${index + 1}` },
                      { label: 'VID', value: device.vid || device.vendor_id || '--', mono: true },
                      { label: 'PID', value: device.pid || device.product_id || '--', mono: true },
                      { label: 'Serial path', value: device.path || device.serial_path || '--', mono: true },
                    ]}
                  />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Usb}
              title="No USB devices reported"
              description="Refresh the node after plugging in the printer control board. The node agent reports serial devices when Linux exposes them under /dev."
            />
          )}
        </div>
      </Modal>

      <ConfirmActionModal
        isOpen={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        onConfirm={runConfirmedAction}
        title={confirmAction?.title}
        actionLabel={confirmAction?.actionLabel}
        itemName={confirmAction?.node?.name || confirmAction?.node?.hostname}
        description={confirmAction?.description}
        consequences={confirmAction?.consequences || []}
        requireText={confirmAction?.requireText}
        confirmVariant={confirmAction?.confirmVariant || 'danger'}
        busy={Boolean(confirmAction?.node && isNodeBusy(confirmAction.node.id))}
      />
    </div>
  );
};

export default NodeOverview;
