import React, { useState, useEffect } from 'react';
import { History, Info, AlertTriangle, XCircle, Search, Filter } from 'lucide-react';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const Events = () => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');

  useEffect(() => {
    fetchEvents();
  }, [filterType, filterSeverity]);

  const fetchEvents = async () => {
    try {
      const params = {};
      if (filterType) params.event_type = filterType;
      if (filterSeverity) params.severity = filterSeverity;

      const res = await axios.get(`${API_BASE_URL}/events`, { params });
      setEvents(res.data);
    } catch (err) {
      console.error("Error fetching events:", err);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityIcon = (severity) => {
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
        <button onClick={fetchEvents} className="text-sm text-blue-400 hover:underline">Refresh</button>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-wrap gap-4">
        <div className="flex items-center space-x-2">
          <Filter size={16} className="text-slate-500" />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm outline-none"
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
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm outline-none"
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
        <div className="divide-y divide-slate-700">
          {events.map((event) => (
            <div key={event.id} className="p-4 hover:bg-slate-700/30 transition-colors flex items-start space-x-4">
              <div className="mt-1">{getSeverityIcon(event.severity)}</div>
              <div className="flex-1">
                <div className="flex justify-between items-start">
                  <h4 className="font-bold text-sm">{event.event_type.toUpperCase()}</h4>
                  <span className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString()}</span>
                </div>
                <p className="text-sm text-slate-300 mt-1">{event.message}</p>
                {event.details && (
                  <pre className="text-[10px] bg-slate-900 p-2 rounded mt-2 text-slate-500 overflow-x-auto">
                    {JSON.stringify(event.details, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          ))}
          {events.length === 0 && (
            <div className="p-12 text-center text-slate-500 italic">No events recorded.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Events;
