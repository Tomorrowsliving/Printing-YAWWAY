import React, { useState, useEffect } from 'react';
import { History, Info, AlertTriangle, XCircle, RefreshCw, Filter, Loader2, History as HistoryIcon } from 'lucide-react';
import axios from 'axios';
import api from '../services/api';



const Events = ({ addToast }) => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');

  useEffect(() => {
    fetchEvents();
  }, [filterType, filterSeverity]);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterType) params.event_type = filterType;
      if (filterSeverity) params.severity = filterSeverity;

      const res = await axios.get(`/api/events`, { params });
      setEvents(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Error fetching events:", err);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityIcon = (severity) => {
    if (!severity) return <Info className="text-slate-500" size={18} />;
    switch (severity.toLowerCase()) {
      case 'error':
      case 'critical': return <XCircle className="text-red-500" size={18} />;
      case 'warning': return <AlertTriangle className="text-orange-500" size={18} />;
      default: return <Info className="text-blue-500" size={18} />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Event Log</h2>
        <button
          onClick={fetchEvents}
          disabled={loading}
          className="flex items-center space-x-2 text-sm text-blue-400 hover:text-blue-300 disabled:text-slate-600 transition-colors"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-wrap gap-4">
        <div className="flex items-center space-x-2">
          <Filter size={16} className="text-slate-500" />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-500"
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
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-500"
          >
            <option value="">All Severities</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        {loading && events.length === 0 ? (
          <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>
        ) : (
          <div className="divide-y divide-slate-700">
            {events.map((event) => (
              <div key={event.id} className="p-4 hover:bg-slate-700/30 transition-colors flex items-start space-x-4">
                <div className="mt-1">{getSeverityIcon(event.severity)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold text-xs text-slate-500 uppercase tracking-tighter">{event.event_type}</h4>
                    <span className="text-[10px] text-slate-500">{new Date(event.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-slate-200 mt-1">{event.message}</p>
                </div>
              </div>
            ))}
            {events.length === 0 && !loading && (
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
