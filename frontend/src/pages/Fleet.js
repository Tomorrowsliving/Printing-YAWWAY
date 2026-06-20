import React, { useState, useEffect, useCallback } from 'react';
import {
  Printer, Play, AlertTriangle, ExternalLink, Settings as SettingsIcon,
  RefreshCw, Plus, Loader2, ChevronRight, ChevronLeft, Server, Usb, Check, ShieldAlert, Upload, Book, FileCode, Trash2, HardDrive, DatabaseBackup, Copy
} from 'lucide-react';
import { printerService, nodeService } from '../services/api';
import { Link } from 'react-router-dom';
import { ConfirmActionModal, Modal } from '../components/UI';
import { DetailGrid, EmptyState, HelpText, MetricCard, PageHeader, Panel, ProgressBar, SearchBox, StatusPill, ToolbarButton } from '../components/DesignSystem';
import axios from 'axios';
import { explainApiError, formatDateTime, printerStatusMeta } from '../utils/operator';

const defaultFormData = {
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
};

const slugify = (value) => (
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
);

const Fleet = ({ addToast }) => {
  const [printers, setPrinters] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [backups, setBackups] = useState([]);
  const [events, setEvents] = useState([]);
  const [storageSummary, setStorageSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);

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
  const [examplesError, setExamplesError] = useState('');
  const [exampleFilter, setExampleFilter] = useState('');
  const [selectedExample, setSelectedNodeExample] = useState(null);

  const [formData, setFormData] = useState(defaultFormData);
  const activeInstallJob = softwareStatus?.install_job || softwareStatus?.job;

  useEffect(() => {
    fetchPrinters();
    fetchNodes();
    fetchFleetAuxiliary();
    const interval = setInterval(() => {
        fetchPrinters();
        fetchNodes();
        fetchFleetAuxiliary();
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

  const fetchFleetAuxiliary = async () => {
    try {
      const [backupRes, storageRes, eventRes] = await Promise.allSettled([
        axios.get('/api/backups'),
        axios.get('/api/storage/nfs-status'),
        axios.get('/api/events', { params: { limit: 200 } }),
      ]);
      if (backupRes.status === 'fulfilled') setBackups(Array.isArray(backupRes.value.data) ? backupRes.value.data : []);
      if (storageRes.status === 'fulfilled') setStorageSummary(storageRes.value.data);
      if (eventRes.status === 'fulfilled') setEvents(Array.isArray(eventRes.value.data) ? eventRes.value.data : []);
    } catch (err) {}
  };

  const checkSoftware = useCallback(async (nodeId, options = {}) => {
    const { background = false, quiet = false } = options;
    if (!background) setSoftwareLoading(true);
    try {
      const res = await axios.get(`/api/nodes/${nodeId}/software/status`);
      setSoftwareStatus(res.data);
    } catch (err) {
      if (!quiet) addToast(explainApiError(err, {
        what: 'Node software check failed',
        cause: 'The node-agent software status endpoint did not answer.',
        fix: 'Refresh the node and confirm the agent is online before provisioning.',
      }), "error");
    } finally {
      if (!background) setSoftwareLoading(false);
    }
  }, [addToast]);

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
      const nextStatus = res.data?.status && typeof res.data.status === 'object' ? { ...res.data.status } : {};
      const job = res.data?.job || res.data?.install_job || nextStatus.install_job;
      if (job) {
        nextStatus.install_job = job;
      }

      if (Object.keys(nextStatus).length > 0) {
        setSoftwareStatus(prev => ({ ...(prev || {}), ...nextStatus }));
      } else {
        await checkSoftware(nodeId);
      }

      if (res.data?.success === false) {
        addToast(res.data.message || `${labels[type]} install failed`, "error");
      } else if (res.data?.accepted || job?.status === 'running') {
        addToast(`${labels[type]} install started`, "info");
      } else {
        addToast(`${labels[type]} installed successfully`, "success");
      }
    } catch (err) {
      addToast(explainApiError(err, {
        what: `${labels[type]} install failed`,
        cause: 'The node-agent could not complete the install request.',
        fix: 'Check node-agent logs, network access, and available disk space on the Pi.',
      }), "error");
      setSoftwareLoading(false);
    } finally {
      setSoftwareLoading(false);
    }
  };

  useEffect(() => {
    const nodeId = formData.assigned_node_id;
    if (!nodeId || activeInstallJob?.status !== 'running') return undefined;

    const interval = setInterval(() => {
      checkSoftware(nodeId, { background: true, quiet: true });
    }, 5000);

    return () => clearInterval(interval);
  }, [formData.assigned_node_id, activeInstallJob?.id, activeInstallJob?.status, checkSoftware]);

  const fetchMcus = async (nodeId) => {
    setMcuLoading(true);
    try {
      const res = await nodeService.getNodeUsb(nodeId);
      const available = res.data;

      // In a real app, we'd cross-reference with existing printers
      setMcus({ available, used: [] });
    } catch (err) {
      addToast(explainApiError(err, {
        what: 'USB device scan failed',
        cause: 'The node-agent did not return the connected USB serial devices.',
        fix: 'Check the node-agent service and reconnect the printer control board USB cable.',
      }), "error");
    } finally {
      setMcuLoading(false);
    }
  };

  const fetchExamples = async () => {
    setExamplesLoading(true);
    setExamplesError('');
    try {
      const res = await axios.get('/api/files/examples/klipper');
      setExamples(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      const message = err.response?.data?.detail || "Failed to fetch Klipper example configs";
      setExamplesError(message);
      addToast(explainApiError(err, {
        what: 'Could not load Klipper examples',
        cause: 'The backend could not fetch the upstream example list.',
        fix: 'Try again later or start from a minimal config.',
      }), "error");
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
      addToast(explainApiError(err, {
        what: 'Could not load example config',
        cause: 'The selected example file could not be downloaded.',
        fix: 'Pick another template or start with the minimal config.',
      }), "error");
    }
  };

  const resetWizard = () => {
    setStep(1);
    setMcus({ available: [], used: [] });
    setSoftwareStatus(null);
    setAdvancedInstallOpen(false);
    setStorageCheck(null);
    setExamples([]);
    setExamplesError('');
    setExampleFilter('');
    setSelectedNodeExample(null);
    setFormData(defaultFormData);
  };

  const closeWizard = () => {
    setIsModalOpen(false);
    resetWizard();
  };

  const validatePrinterProfile = () => {
    const name = formData.name.trim();
    const slug = slugify(formData.slug || name);

    if (!name) {
      addToast("Enter a printer name before continuing", "error");
      return null;
    }
    if (!slug) {
      addToast("Enter a valid printer slug before continuing", "error");
      return null;
    }

    setFormData(prev => ({ ...prev, name, slug }));
    return { name, slug };
  };

  const handleProfileNext = () => {
    if (validatePrinterProfile()) {
      setStep(2);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const newData = { ...prev, [name]: value };
      if (name === 'name') {
        const previousAutoSlug = slugify(prev.name);
        if (!prev.slug || prev.slug === previousAutoSlug) {
          newData.slug = slugify(value);
        }
      }
      if (name === 'slug') {
        newData.slug = slugify(value);
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
      addToast(explainApiError(err, {
        what: 'NFS check failed',
        cause: 'The node-agent storage check did not answer.',
        fix: 'Confirm the node is online and the agent can reach /mnt/klipper-farm.',
      }), "error");
    } finally {
      setStorageLoading(false);
    }
  };

  const handlePrinterRestart = async (printerId, target) => {
    try {
        await axios.post(`/api/printers/${printerId}/restart`, { target });
        addToast(`${target} restart initiated`, "success");
        fetchFleetAuxiliary();
    } catch (err) {
        addToast(explainApiError(err, {
          what: 'Restart services failed',
          cause: 'The node-agent or Moonraker service restart command did not complete.',
          fix: 'Check the assigned node, service names, and event log.',
        }), "error");
    }
  };

  const handleEmergencyStop = async (printer) => {
    try {
      await axios.post(`/api/printers/${printer.id}/emergency-stop`);
      addToast('Emergency stop sent', 'success');
      fetchPrinters();
      fetchFleetAuxiliary();
    } catch (err) {
      addToast(explainApiError(err, {
        what: 'Emergency stop failed',
        cause: 'Moonraker did not accept the emergency stop command.',
        fix: 'Use the printer hardware controls if motion is unsafe, then check Moonraker connectivity.',
      }), 'error');
    }
  };

  const handleDeletePrinter = async (printer) => {
    try {
      await printerService.deletePrinter(printer.id);
      addToast(`${printer.name || 'Printer'} deleted`, "success");
      fetchPrinters();
      fetchFleetAuxiliary();
    } catch (err) {
      addToast(explainApiError(err, {
        what: 'Delete printer failed',
        cause: 'The API could not remove the printer profile.',
        fix: 'Refresh the fleet and check whether the printer still exists.',
      }), "error");
    }
  };

  const handleSubmit = async () => {
    const profile = validatePrinterProfile();
    if (!profile) return;

    if (!formData.assigned_node_id) {
      addToast("Select a target node before provisioning", "error");
      return;
    }

    setIsSubmitting(true);
    let createdPrinterId = null;
    try {
      const selectedNode = nodes.find(n => n.id === formData.assigned_node_id);
      if (!selectedNode) {
        addToast("Selected node is no longer available", "error");
        return;
      }

      const mainsailUrl = selectedNode?.ip_address ? `http://${selectedNode.ip_address}` : formData.embedded_ui_url;
      // 1. Create printer record in central DB
      const createRes = await printerService.createPrinter({
        ...formData,
        name: profile.name,
        slug: profile.slug,
        status: 'offline',
        klipper_service_name: `klipper-${profile.slug}`,
        moonraker_service_name: `moonraker-${profile.slug}`,
        config_path: `/mnt/klipper-farm/printers/${profile.slug}/config`,
        gcode_path: `/mnt/klipper-farm/printers/${profile.slug}/gcodes`,
        embedded_ui_url: formData.embedded_ui_url || mainsailUrl,
      });
      createdPrinterId = createRes.data?.id;

      // 2. Instruct node agent to create instance
      await nodeService.createNodeInstance(formData.assigned_node_id, {
        printer_slug: profile.slug,
        mcu_serial: formData.expected_mcu_serial,
        moonraker_port: formData.moonraker_port,
        config_path: `/mnt/klipper-farm/printers/${profile.slug}/config`,
        gcode_path: `/mnt/klipper-farm/printers/${profile.slug}/gcodes`,
        logs_path: `/mnt/klipper-farm/printers/${profile.slug}/logs`,
        printer_cfg_content: formData.printer_cfg_content
      });

      addToast(`Printer ${profile.name} initialised!`, 'success');
      closeWizard();
      fetchPrinters();
    } catch (err) {
      if (createdPrinterId) {
        await printerService.deletePrinter(createdPrinterId).catch(() => {});
      }
      addToast(explainApiError(err, {
        what: 'Printer creation failed',
        cause: 'The dashboard could not create the central profile or provision services on the node.',
        fix: 'Check NFS status, MCU selection, and node-agent connectivity, then retry from the review screen.',
      }), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const requestPrinterAction = (printer, action, target = 'all') => {
    const printerName = printer?.name || 'this printer';
    const copy = {
      delete: {
        title: 'Delete Printer',
        actionLabel: 'Delete Printer',
        requireText: 'DELETE',
        description: `Delete ${printerName} from the fleet.`,
        consequences: [
          'The logical printer profile will be removed from the dashboard.',
          'Assignments are removed, but central config and G-code files stay in storage.',
          'Use Backups before deleting if you may need to restore the profile later.',
        ],
      },
      restart: {
        title: 'Restart Printer Services',
        actionLabel: 'Restart Services',
        description: `Restart Klipper and Moonraker for ${printerName}.`,
        consequences: [
          'Active prints on this printer may stop.',
          'Mainsail and Moonraker will briefly disconnect.',
          'Use this after config changes or service errors.',
        ],
        confirmVariant: 'warning',
      },
      emergency: {
        title: 'Emergency Stop',
        actionLabel: 'Send Emergency Stop',
        description: `Send an emergency stop command to ${printerName}.`,
        consequences: [
          'Klipper will stop printer motion immediately if Moonraker is reachable.',
          'You may need a firmware restart before printing again.',
          'Use physical controls if the printer is unsafe and the command cannot reach Moonraker.',
        ],
        confirmVariant: 'danger',
      },
    }[action];

    setConfirmAction({ printer, action, target, ...(copy || {}) });
  };

  const runConfirmedAction = async () => {
    if (!confirmAction?.printer) return;
    const { printer, action, target } = confirmAction;
    setConfirmAction(null);
    if (action === 'delete') await handleDeletePrinter(printer);
    if (action === 'restart') await handlePrinterRestart(printer.id, target || 'all');
    if (action === 'emergency') await handleEmergencyStop(printer);
  };

  const getPrinterNode = (printer) => printer.node || nodes.find(n => n.id === printer.assigned_node_id);
  const getPrinterMainsailUrl = (printer) => {
    const node = getPrinterNode(printer);
    return node?.ip_address ? `http://${node.ip_address}` : printer.embedded_ui_url;
  };

  const onlineNodes = nodes.filter(n => n.online);
  const selectedNode = nodes.find(n => n.id === formData.assigned_node_id);
  const mainsailUrl = selectedNode?.ip_address ? `http://${selectedNode.ip_address}` : null;
  const generatedPaths = {
    config: `/mnt/klipper-farm/printers/${formData.slug || '<slug>'}/config`,
    gcodes: `/mnt/klipper-farm/printers/${formData.slug || '<slug>'}/gcodes`,
    logs: `/mnt/klipper-farm/printers/${formData.slug || '<slug>'}/logs`,
  };
  const generatedServices = {
    klipper: `klipper-${formData.slug || '<slug>'}.service`,
    moonraker: `moonraker-${formData.slug || '<slug>'}.service`,
  };
  const installJob = activeInstallJob;
  const installJobRunning = installJob?.status === 'running';
  const installJobLogs = Array.isArray(installJob?.log) ? installJob.log.slice(-5) : [];
  const runtimeInstalledCount = ['klipper_installed', 'moonraker_installed', 'mainsail_installed']
    .filter(key => softwareStatus?.[key]).length;
  const runtimeLabel = installJobRunning ? 'Installing' : runtimeInstalledCount === 3 ? 'Installed' : runtimeInstalledCount === 0 ? 'Not Installed' : 'Partial';
  const runtimeReady = Boolean(softwareStatus?.klipper_installed && softwareStatus?.moonraker_installed);
  const nfsReady = Boolean(storageCheck?.nfs_available || (storageCheck?.mounted && storageCheck?.writable));
  const statusClass = (ok) => ok ? 'text-green-500' : 'text-red-400';
  const runtimeClass = installJobRunning ? 'text-blue-400' : runtimeLabel === 'Installed' ? 'text-green-500' : runtimeLabel === 'Partial' ? 'text-orange-400' : 'text-red-400';
  const filteredExamples = examples.filter(example =>
    example.name.toLowerCase().includes(exampleFilter.trim().toLowerCase())
  );
  const fleetSummary = {
    total: printers.length,
    printing: printers.filter(printer => printer.status === 'printing').length,
    ready: printers.filter(printer => ['idle', 'online'].includes(printer.status)).length,
    needsAttention: printers.filter(printer => ['offline', 'error'].includes(printer.status)).length,
  };
  const latestPrinterEvent = (printerId, matcher) => events.find((event) => (
    String(event.printer_id) === String(printerId) && matcher(event.event_type || '')
  ));
  const search = searchTerm.trim().toLowerCase();
  const filteredPrinters = printers.filter((printer) => {
    if (!search) return true;
    const node = getPrinterNode(printer);
    return [
      printer.name,
      printer.slug,
      printer.status,
      printer.notes?.model,
      printer.model,
      node?.hostname,
      node?.name,
      node?.ip_address,
    ].some((value) => String(value || '').toLowerCase().includes(search));
  });
  const failedBackups = backups.filter((backup) => backup.status !== 'success');
  const missingNfsDirs = Object.entries(storageSummary?.required_directories || {})
    .filter(([, exists]) => !exists)
    .map(([name]) => name);
  const warnings = [
    ...nodes.filter(node => node.approved && !node.online).map(node => ({
      key: `offline-node-${node.id}`,
      label: 'Offline node',
      message: `${node.name || node.hostname} has no recent heartbeat.`,
    })),
    ...printers.filter(printer => !printer.assigned_node_id && !printer.node).map(printer => ({
      key: `unassigned-printer-${printer.id}`,
      label: 'Unassigned printer',
      message: `${printer.name} is not assigned to a node.`,
    })),
    ...failedBackups.slice(0, 4).map(backup => ({
      key: `failed-backup-${backup.id}`,
      label: 'Failed backup',
      message: backup.error_message || backup.filename,
    })),
    ...missingNfsDirs.map(dir => ({
      key: `missing-nfs-${dir}`,
      label: 'Missing NFS path',
      message: `${dir} directory is missing under central storage.`,
    })),
  ];
  const configurationSummary = [
    `Printer: ${formData.name || '-'}`,
    `Slug: ${formData.slug || '-'}`,
    `Node: ${selectedNode?.hostname || '-'}`,
    `MCU: ${formData.expected_mcu_serial || '-'}`,
    `Klipper service: ${generatedServices.klipper}`,
    `Moonraker service: ${generatedServices.moonraker}`,
    `Moonraker port: ${formData.moonraker_port || 7125}`,
    `Config path: ${generatedPaths.config}`,
    `G-code path: ${generatedPaths.gcodes}`,
    `Logs path: ${generatedPaths.logs}`,
  ].join('\n');

  const copyConfigurationSummary = async () => {
    await navigator.clipboard.writeText(configurationSummary);
    addToast('Configuration summary copied', 'success');
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
      <PageHeader
        eyebrow="Print Farm"
        title="Fleet"
        description="Monitor every printer, see what is running, and keep common controls close without overwhelming new users."
        actions={(
          <>
            <ToolbarButton icon={RefreshCw} variant="secondary" onClick={() => { fetchPrinters(); fetchNodes(); }}>
              Refresh
            </ToolbarButton>
            <ToolbarButton
              icon={Plus}
              variant="primary"
              onClick={() => { setStep(1); setIsModalOpen(true); }}
            >
              Add Printer
            </ToolbarButton>
          </>
        )}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Printers" value={fleetSummary.total} helper="Registered profiles" icon={Printer} tone="slate" />
        <MetricCard label="Online printers" value={fleetSummary.ready + fleetSummary.printing} helper="Ready or actively printing" icon={Check} tone="green" />
        <MetricCard label="Online nodes" value={nodes.filter(node => node.online).length} helper="Node agent heartbeats" icon={Server} tone="green" />
        <MetricCard label="Active prints" value={fleetSummary.printing} helper="Jobs currently active" icon={Play} tone="blue" />
        <MetricCard label="Pending backups" value={failedBackups.length} helper="Failed or incomplete backups" icon={DatabaseBackup} tone={failedBackups.length ? 'amber' : 'slate'} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <Panel title="Storage Summary" description="Central storage, backups, and file inventory" icon={HardDrive}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricCard
              label="Storage usage"
              value={storageSummary?.storage_usage_percent != null ? `${storageSummary.storage_usage_percent}%` : 'Check NFS'}
              helper={storageSummary?.free_space ? `${storageSummary.free_space} free` : storageSummary?.storage_root || 'Central storage path'}
              icon={HardDrive}
              tone={storageSummary?.storage_usage_percent >= 85 ? 'red' : 'slate'}
            />
            <MetricCard label="Backup count" value={storageSummary?.backup_count ?? backups.length} helper="Farm and file-edit backups" icon={DatabaseBackup} tone="purple" />
            <MetricCard label="G-code count" value={storageSummary?.gcode_count ?? '--'} helper="Managed G-code files" icon={FileCode} tone="blue" />
          </div>
        </Panel>

        <Panel title="Warnings" description="Items that need operator attention" icon={AlertTriangle}>
          {warnings.length > 0 ? (
            <div className="space-y-2">
              {warnings.slice(0, 6).map((warning) => (
                <div key={warning.key} className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-300">{warning.label}</p>
                  <p className="mt-1 text-xs leading-5 text-amber-100/80">{warning.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Check} title="No warnings" description="No offline nodes, unassigned printers, failed backups, or missing NFS directories were found." />
          )}
        </Panel>
      </div>

      <div className="app-card-soft p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-bold text-slate-200">Printer search</p>
            <HelpText>Printers are logical profiles stored centrally and assigned to nodes for Klipper and Moonraker services.</HelpText>
          </div>
          <SearchBox
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search name, model, node, or status..."
            className="w-full md:w-96"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {filteredPrinters.map((printer) => {
          const assignedNode = getPrinterNode(printer);
          const printerMainsailUrl = getPrinterMainsailUrl(printer);
          const statusMeta = printerStatusMeta(printer);
          const lastConfig = latestPrinterEvent(printer.id, (type) => type.includes('config') || type.includes('profile'));
          const lastPrint = latestPrinterEvent(printer.id, (type) => type.includes('print'));
          const lastAssignment = latestPrinterEvent(printer.id, (type) => type.includes('assignment') || type.includes('migration'));
          const progressValue = printer.status === 'printing'
            ? Math.max(1, Math.min(100, printer.progress || 0))
            : printer.status === 'offline'
              ? 0
              : 100;

          return (
            <div key={printer.id} className="app-card overflow-hidden transition-colors hover:border-slate-600">
              <div className="grid grid-cols-1 md:grid-cols-[176px_minmax(0,1fr)]">
              <div className="flex h-44 items-center justify-center border-b border-slate-800 bg-slate-950 md:h-full md:border-b-0 md:border-r">
                {printer.webcam_url ? (
                  <img src={printer.webcam_url} alt={printer.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-3 text-slate-700">
                    <Printer size={54} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">No webcam</span>
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-5 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-lg font-bold text-slate-50">{printer.name}</h3>
                      <StatusPill tone={statusMeta.tone} status={statusMeta.key} title={statusMeta.tooltip}>{statusMeta.label}</StatusPill>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">Node: {assignedNode?.hostname || assignedNode?.name || 'Unassigned'}</p>
                    {assignedNode?.ip_address && <p className="mt-0.5 font-mono text-[10px] text-slate-500">{assignedNode.ip_address}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <ToolbarButton
                      onClick={() => requestPrinterAction(printer, 'delete')}
                      icon={Trash2}
                      size="icon"
                      variant="danger"
                      title="Delete Printer"
                      aria-label={`Delete ${printer.name}`}
                    />
                    <Link to={`/printers/${printer.id}`} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 transition-colors hover:bg-slate-750 hover:text-white" title="Open printer">
                      <SettingsIcon size={16} />
                    </Link>
                    {printerMainsailUrl && (
                      <a href={printerMainsailUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 transition-colors hover:bg-slate-750 hover:text-white" title="Open Mainsail">
                        <ExternalLink size={16} />
                      </a>
                    )}
                  </div>
                </div>

                <DetailGrid
                  items={[
                    { label: 'Created', value: formatDateTime(printer.created_at) },
                    { label: 'Last config change', value: lastConfig ? formatDateTime(lastConfig.created_at) : formatDateTime(printer.updated_at), helper: lastConfig?.message },
                    { label: 'Last print', value: lastPrint ? formatDateTime(lastPrint.created_at) : 'Never', helper: lastPrint?.message },
                    { label: 'Last assignment', value: lastAssignment ? formatDateTime(lastAssignment.created_at) : (assignedNode ? 'Assigned' : 'Unassigned'), helper: lastAssignment?.message },
                  ]}
                  className="grid-cols-2"
                />

                <div>
                  <div className="mb-2 flex items-end justify-between gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Print progress</span>
                    {printer.progress != null && <span className="text-[10px] font-bold text-blue-300">{printer.progress}%</span>}
                  </div>
                  <ProgressBar value={progressValue} tone={printer.status === 'error' ? 'red' : printer.status === 'printing' ? 'blue' : printer.status === 'offline' ? 'red' : 'green'} />
                  <p className="mt-2 min-h-4 truncate text-[11px] text-slate-500">
                    {printer.active_gcode ? `Active G-code: ${printer.active_gcode}` : 'No active G-code'}
                  </p>
                </div>

                <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                  <ToolbarButton
                    onClick={() => requestPrinterAction(printer, 'restart', 'all')}
                    icon={RefreshCw}
                    variant="secondary"
                  >
                    Restart
                  </ToolbarButton>
                  <ToolbarButton
                    onClick={() => requestPrinterAction(printer, 'emergency')}
                    icon={ShieldAlert}
                    variant="danger"
                    size="icon"
                    title="Emergency Stop"
                  />
                  <ToolbarButton icon={Play} variant="primary" size="icon" title="Print actions" />
                </div>
              </div>
              </div>
            </div>
          );
        })}
        {filteredPrinters.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={Printer}
              title={printers.length === 0 ? 'No printers yet' : 'No printers match this search'}
              description={printers.length === 0 ? 'Add your first printer profile, choose a node, and provision Klipper/Moonraker services from the guided setup.' : 'Search by printer name, model, assigned node, IP address, or status.'}
              action={<ToolbarButton icon={Plus} variant="primary" onClick={() => { setStep(1); setIsModalOpen(true); }}>Add Printer</ToolbarButton>}
            />
          </div>
        )}
      </div>

      <Modal isOpen={isModalOpen} onClose={closeWizard} title={`Guided Printer Setup - Step ${step} of 5`}>
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="font-bold text-slate-300">1. Printer Profile</h3>
            <HelpText>Printers are logical profiles stored centrally and assigned to nodes. Pick a clear name; the slug becomes part of service names and storage paths.</HelpText>
            <div><label className="text-[10px] font-bold text-slate-500 uppercase">Printer Name</label><input name="name" value={formData.name} onChange={handleInputChange} className="app-input w-full" placeholder="e.g. Ender 3 #1" /></div>
            <div className="grid grid-cols-2 gap-4">
               <div><label className="text-[10px] font-bold text-slate-500 uppercase">Model</label><input name="model" value={formData.model} onChange={handleInputChange} className="app-input w-full" placeholder="Ender 3" /></div>
               <div><label className="text-[10px] font-bold text-slate-500 uppercase">Slug</label><input name="slug" value={formData.slug} onChange={handleInputChange} className="app-input w-full" /></div>
            </div>
            <div className="flex justify-end pt-4"><button onClick={handleProfileNext} className="bg-blue-600 px-6 py-2 rounded-lg font-bold flex items-center">Next <ChevronRight size={18} /></button></div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 text-left">
            <h3 className="font-bold text-slate-300">2. Select Target Node</h3>
            <HelpText>Choose the Raspberry Pi that this printer is physically connected to. Online nodes can provision services and scan USB serial devices.</HelpText>
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

              {installJob && (
                <div className={`rounded-xl border p-3 space-y-2 ${installJob.status === 'failed' ? 'bg-red-950/20 border-red-500/30' : installJob.status === 'completed' ? 'bg-green-950/20 border-green-500/30' : 'bg-blue-950/20 border-blue-500/30'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Install Progress</p>
                      <p className="text-sm font-bold text-slate-100 capitalize">{installJob.kind || installJob.component || 'Runtime'} - {installJob.status || 'running'}</p>
                    </div>
                    {installJobRunning ? <Loader2 size={16} className="animate-spin text-blue-300 shrink-0" /> : <Check size={16} className="text-green-300 shrink-0" />}
                  </div>
                  {installJob.message && <p className="text-[11px] text-slate-300 leading-relaxed">{installJob.message}</p>}
                  {installJob.current_command && (
                    <div className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2">
                      <p className="text-[9px] font-bold uppercase text-slate-500 mb-1">Current Command</p>
                      <p className="text-[10px] font-mono text-blue-200 truncate">{installJob.current_command}</p>
                    </div>
                  )}
                  {installJobLogs.length > 0 && (
                    <div className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2 space-y-1">
                      <p className="text-[9px] font-bold uppercase text-slate-500">Recent Log</p>
                      {installJobLogs.map((entry, index) => (
                        <p key={`${entry.timestamp || 'log'}-${index}`} className="text-[10px] text-slate-400 leading-tight truncate">
                          {entry.message}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {softwareStatus && runtimeInstalledCount < 3 && (
                <button
                  onClick={() => installSoftware(formData.assigned_node_id, 'runtime')}
                  disabled={softwareLoading || installJobRunning}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 px-4 py-2 rounded-lg font-bold text-sm flex items-center justify-center space-x-2"
                >
                  {(softwareLoading || installJobRunning) ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  <span>{installJobRunning ? 'Install running' : 'Install Printer Runtime'}</span>
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
                  <button disabled={softwareLoading || installJobRunning} onClick={() => installSoftware(formData.assigned_node_id, 'klipper')} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 px-3 py-2 rounded-lg text-[10px] font-bold text-slate-300">Install Klipper only</button>
                  <button disabled={softwareLoading || installJobRunning} onClick={() => installSoftware(formData.assigned_node_id, 'moonraker')} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 px-3 py-2 rounded-lg text-[10px] font-bold text-slate-300">Install Moonraker only</button>
                  <button disabled={softwareLoading || installJobRunning} onClick={() => installSoftware(formData.assigned_node_id, 'mainsail')} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 px-3 py-2 rounded-lg text-[10px] font-bold text-slate-300">Install Mainsail only</button>
                  <button disabled={softwareLoading || installJobRunning} onClick={() => installSoftware(formData.assigned_node_id, 'runtime')} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 px-3 py-2 rounded-lg text-[10px] font-bold text-slate-300">Reinstall/Repair runtime</button>
                </div>
              )}
            </div>

            <div className="space-y-2">
               <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Select USB Serial</p>
               <HelpText>Choose the control board connected to this printer. The serial path is saved so this profile can be matched to the same MCU later.</HelpText>
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
                  <button disabled={installJobRunning || !runtimeReady || !nfsReady} onClick={() => setStep(4)} className="bg-blue-600 disabled:bg-slate-700 px-6 py-2 rounded-lg font-bold flex items-center">Next <ChevronRight size={18} /></button>
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
                 <div className="p-2 border-b border-slate-800">
                    <input
                      value={exampleFilter}
                      onChange={(e) => setExampleFilter(e.target.value)}
                      placeholder="Filter templates..."
                      className="w-full bg-slate-800 rounded-lg px-3 py-1.5 text-xs outline-none"
                    />
                 </div>
                 <div className="max-h-64 overflow-y-auto">
                    {examplesLoading ? <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-blue-500" /></div> : examplesError ? (
                       <div className="p-8 text-center text-xs text-red-300">{examplesError}</div>
                    ) : filteredExamples.length === 0 ? (
                       <div className="p-8 text-center text-xs text-slate-500">No example configs found.</div>
                    ) : (
                       filteredExamples.map(ex => (
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-bold text-slate-300">5. Review & Provision</h3>
                <ToolbarButton icon={Copy} variant="secondary" size="sm" onClick={copyConfigurationSummary}>
                  Copy Summary
                </ToolbarButton>
              </div>
              <HelpText>Review the generated service names, port, and central storage paths before creation. Provisioning creates the profile first, then asks the node to create Klipper and Moonraker services.</HelpText>
              <div className="bg-slate-900 rounded-xl border border-slate-800 p-3">
                 <DetailGrid
                   items={[
                     { label: 'Printer', value: formData.name },
                     { label: 'Selected node', value: selectedNode?.hostname || 'Missing node', helper: selectedNode?.ip_address },
                     { label: 'Selected MCU', value: formData.expected_mcu_serial || 'No MCU selected', mono: true },
                     { label: 'Config source', value: formData.config_source === 'example' ? `Template: ${selectedExample}` : 'Minimal Template' },
                     { label: 'Klipper service', value: generatedServices.klipper, mono: true },
                     { label: 'Moonraker service', value: generatedServices.moonraker, mono: true },
                     { label: 'Moonraker port', value: formData.moonraker_port || 7125, mono: true },
                     { label: 'Config path', value: generatedPaths.config, mono: true },
                     { label: 'G-code path', value: generatedPaths.gcodes, mono: true },
                     { label: 'Logs path', value: generatedPaths.logs, mono: true },
                   ]}
                 />
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

      <ConfirmActionModal
        isOpen={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        onConfirm={runConfirmedAction}
        title={confirmAction?.title}
        actionLabel={confirmAction?.actionLabel}
        itemName={confirmAction?.printer?.name}
        description={confirmAction?.description}
        consequences={confirmAction?.consequences || []}
        requireText={confirmAction?.requireText}
        confirmVariant={confirmAction?.confirmVariant || 'danger'}
        busy={isSubmitting}
      />
    </div>
  );
};

export default Fleet;
