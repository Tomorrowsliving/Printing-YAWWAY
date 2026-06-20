import { formatLastSeen } from './format';

const normalise = (value) => String(value || '').trim().toLowerCase();

export const nodeStatusMeta = (node, operation) => {
  if (operation) {
    return {
      key: operation.operation || 'updating',
      label: operation.label || String(operation.operation || 'Working').replaceAll('_', ' '),
      tone: 'blue',
      tooltip: operation.message || 'A node operation is still running. The agent may briefly stop answering.',
    };
  }
  if (!node?.approved) {
    return {
      key: 'warning',
      label: 'Warning',
      tone: 'amber',
      tooltip: 'This node has checked in but has not been approved for printer work yet.',
    };
  }
  if (node?.status === 'error') {
    return {
      key: 'error',
      label: 'Error',
      tone: 'red',
      tooltip: 'The last node action failed. Check the event log and node-agent service.',
    };
  }
  if (node?.online) {
    return {
      key: 'online',
      label: 'Online',
      tone: 'green',
      tooltip: `Node agent is reachable. Last heartbeat ${formatLastSeen(node.last_seen)}.`,
    };
  }
  return {
    key: 'offline',
    label: 'Offline',
    tone: 'red',
    tooltip: 'Node agent is not reachable. Likely causes: Pi powered off, network issue, or node-agent service stopped.',
  };
};

export const printerStatusMeta = (printer) => {
  const status = normalise(printer?.status);
  if (!printer?.assigned_node_id && !printer?.node) {
    return {
      key: 'unassigned',
      label: 'Unassigned',
      tone: 'amber',
      tooltip: 'This logical printer profile is not assigned to a node yet.',
    };
  }
  if (!printer?.expected_mcu_serial && !printer?.mcu_serial) {
    return {
      key: 'identity_unknown',
      label: 'Identity Unknown',
      tone: 'amber',
      tooltip: 'No MCU serial is saved, so the app cannot confidently match this profile to a control board.',
    };
  }
  if (status === 'printing') {
    return {
      key: 'printing',
      label: 'Printing',
      tone: 'blue',
      tooltip: printer?.active_gcode ? `Printing ${printer.active_gcode}` : 'Moonraker reports an active print.',
    };
  }
  if (['idle', 'online', 'ready'].includes(status)) {
    return {
      key: 'configured',
      label: status === 'idle' ? 'Configured' : 'Running',
      tone: 'green',
      tooltip: 'Moonraker and Klipper are reachable for this printer.',
    };
  }
  if (['error', 'shutdown'].includes(status)) {
    return {
      key: 'error',
      label: 'Error',
      tone: 'red',
      tooltip: printer?.status_message || 'Klipper or Moonraker reported an error for this printer.',
    };
  }
  if (status === 'starting') {
    return {
      key: 'running',
      label: 'Running',
      tone: 'blue',
      tooltip: 'Moonraker is reachable and Klipper is still starting or connecting.',
    };
  }
  if (printer?.assigned_node_id || printer?.node) {
    return {
      key: 'assigned',
      label: 'Assigned',
      tone: 'amber',
      tooltip: printer?.status_message || 'This printer has a node assignment but runtime readiness has not been confirmed.',
    };
  }
  return {
    key: 'unknown',
    label: 'Unknown',
    tone: 'slate',
    tooltip: 'The printer state has not been reported yet.',
  };
};

export const eventMatchesQuery = (event, query, printers = [], nodes = []) => {
  const term = normalise(query);
  if (!term) return true;
  const printer = printers.find((item) => String(item.id) === String(event.printer_id));
  const node = nodes.find((item) => String(item.id) === String(event.node_id));
  return [
    event.event_type,
    event.severity,
    event.message,
    printer?.name,
    printer?.slug,
    node?.hostname,
    node?.name,
    node?.ip_address,
  ].some((value) => normalise(value).includes(term));
};

export const getApiDetail = (err) => {
  const detail = err?.response?.data?.detail ?? err?.response?.data?.message ?? err?.message;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg || JSON.stringify(item)).join('; ');
  }
  if (detail && typeof detail === 'object') {
    return detail.message || JSON.stringify(detail);
  }
  return String(detail || '').trim();
};

export const explainApiError = (err, fallback = {}) => {
  const detail = getApiDetail(err);
  const text = normalise(detail);
  const library = [
    {
      test: ['moonraker', '7125', 'server/info'],
      what: 'Moonraker not reachable',
      cause: 'Moonraker may be stopped, using a different port, or blocked by the network.',
      fix: 'Check the printer node, Moonraker service, and the saved Moonraker port.',
    },
    {
      test: ['nfs', 'mount', 'storage'],
      what: 'NFS mount missing',
      cause: 'Central storage is not mounted or is not writable from this node.',
      fix: 'Use Test NFS Connection or Auto-Connect NFS, then confirm /mnt/klipper-farm is writable.',
    },
    {
      test: ['config path', 'printer.cfg', 'config'],
      what: 'Printer config missing',
      cause: 'The printer profile points to a config path that does not contain the expected file.',
      fix: 'Open Files, restore a config backup, or repair the printer configuration.',
    },
    {
      test: ['usb', 'serial', 'mcu'],
      what: 'USB device not found',
      cause: 'The control board is disconnected, has a new serial path, or is already assigned.',
      fix: 'Check the USB cable, refresh the node USB list, and select the correct MCU serial.',
    },
    {
      test: ['node agent', 'node unreachable', 'could not reach node', 'connection refused', 'timeout'],
      what: 'Node agent offline',
      cause: 'The Raspberry Pi is offline, the node-agent service stopped, or the IP/port is wrong.',
      fix: 'Power/network check the node, then restart klipper-farm-node-agent or update the saved IP/port.',
    },
  ];
  const match = library.find((item) => item.test.some((needle) => text.includes(needle)));
  const what = fallback.what || match?.what || detail || 'Action failed';
  const cause = fallback.cause || match?.cause || 'The request did not complete successfully.';
  const fix = fallback.fix || match?.fix || 'Review the details, refresh the page, and check the event log.';
  const detailText = detail && !normalise(what).includes(text) ? ` Details: ${detail}` : '';
  return `${what}. Likely cause: ${cause} Suggested fix: ${fix}${detailText}`;
};

export const formatDateTime = (value) => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
};
