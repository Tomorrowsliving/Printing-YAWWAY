import React, { useState, useEffect, useCallback } from 'react';
import { Info, AlertTriangle, XCircle, RefreshCw, Filter, Loader2, History as HistoryIcon } from 'lucide-react';
import axios from 'axios';
import { HelpText, PageHeader, Panel, SearchBox, ToolbarButton } from '../components/DesignSystem';
import { eventMatchesQuery } from '../utils/operator';



const Events = ({ addToast }) => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterPrinter, setFilterPrinter] = useState('');
  const [filterNode, setFilterNode] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [printers, setPrinters] = useState([]);
  const [nodes, setNodes] = useState([]);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterType) params.event_type = filterType;
      if (filterSeverity) params.severity = filterSeverity;
      if (filterPrinter) params.printer_id = filterPrinter;
      if (filterNode) params.node_id = filterNode;

      const res = await axios.get(`/api/events`, { params });
      setEvents(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Error fetching events:", err);
    } finally {
      setLoading(false);
    }
  }, [filterType, filterSeverity, filterPrinter, filterNode]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    Promise.all([axios.get('/api/printers'), axios.get('/api/nodes')])
      .then(([printerRes, nodeRes]) => {
        setPrinters(Array.isArray(printerRes.data) ? printerRes.data : []);
        setNodes(Array.isArray(nodeRes.data) ? nodeRes.data : []);
      })
      .catch(() => {});
  }, []);

  const getSeverityIcon = (severity) => {
    if (!severity) return <Info className="text-slate-500" size={18} />;
    switch (severity.toLowerCase()) {
      case 'error':
      case 'critical': return <XCircle className="text-red-500" size={18} />;
      case 'warning': return <AlertTriangle className="text-orange-500" size={18} />;
      default: return <Info className="text-blue-500" size={18} />;
    }
  };
  const printerName = (id) => printers.find((printer) => String(printer.id) === String(id))?.name;
  const nodeName = (id) => {
    const node = nodes.find((item) => String(item.id) === String(id));
    return node ? (node.name || node.hostname) : null;
  };
  const filteredEvents = events.filter((event) => eventMatchesQuery(event, searchTerm, printers, nodes));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Maintenance"
        title="Event Log"
        description="Filter major printer, node, backup, migration, slicer, and system events for troubleshooting."
        actions={<ToolbarButton icon={RefreshCw} variant="secondary" busy={loading} onClick={fetchEvents}>Refresh</ToolbarButton>}
      />

      <Panel title="Event Filters" description="Narrow by type, printer, node, or severity" icon={Filter}>
      <div className="mb-4">
        <HelpText>Events record major actions and health warnings with enough context to troubleshoot what failed and where.</HelpText>
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center space-x-2">
          <Filter size={16} className="text-slate-500" />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="app-select"
          >
            <option value="">All Event Types</option>
            <option value="migration">Migration</option>
            <option value="backup">Backup</option>
            <option value="status_change">Status Change</option>
            <option value="error">Error</option>
          </select>
        </div>
        <div className="flex items-center space-x-2">
          <select
            value={filterPrinter}
            onChange={(e) => setFilterPrinter(e.target.value)}
            className="app-select"
          >
            <option value="">All Printers</option>
            {printers.map(printer => <option key={printer.id} value={printer.id}>{printer.name}</option>)}
          </select>
        </div>
        <div className="flex items-center space-x-2">
          <select
            value={filterNode}
            onChange={(e) => setFilterNode(e.target.value)}
            className="app-select"
          >
            <option value="">All Nodes</option>
            {nodes.map(node => <option key={node.id} value={node.id}>{node.name || node.hostname}</option>)}
          </select>
        </div>
        <div className="flex items-center space-x-2">
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="app-select"
          >
            <option value="">All Severities</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <SearchBox
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search type, severity, printer, node, or message..."
          className="min-w-72 flex-1"
        />
      </div>
      </Panel>

      <div className="app-card overflow-hidden">
        {loading && events.length === 0 ? (
          <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>
        ) : (
          <div className="divide-y divide-slate-700">
            {filteredEvents.map((event) => (
              <div key={event.id} className="p-4 hover:bg-slate-700/30 transition-colors flex items-start space-x-4">
                <div className="mt-1">{getSeverityIcon(event.severity)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold text-xs text-slate-500 uppercase tracking-tighter">{event.event_type}</h4>
                    <span className="text-[10px] text-slate-500">{new Date(event.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-slate-200 mt-1">{event.message}</p>
                  {(event.printer_id || event.node_id || event.details) && (
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {event.printer_id && <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1">Printer: {printerName(event.printer_id) || event.printer_id}</span>}
                      {event.node_id && <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1">Node: {nodeName(event.node_id) || event.node_id}</span>}
                      {event.details?.fix && <span className="rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-blue-200">Fix: {event.details.fix}</span>}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {filteredEvents.length === 0 && !loading && (
              <div className="p-16 text-center text-slate-500 italic flex flex-col items-center">
                <HistoryIcon size={48} className="opacity-10 mb-4" />
                <p>No events recorded matching the filters.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Events;
