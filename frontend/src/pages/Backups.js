import React, { useState, useEffect } from 'react';
import { Database, Download, RotateCcw, Plus, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const Backups = () => {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetchBackups();
  }, []);

  const fetchBackups = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/backups`);
      setBackups(res.data);
    } catch (err) {
      console.error("Error fetching backups:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    setActionLoading(true);
    try {
      await axios.post(`${API_BASE_URL}/backups/create`);
      setMessage({ type: 'success', text: 'Backup created successfully' });
      fetchBackups();
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to create backup' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestore = async (backup) => {
    if (!window.confirm(`Are you sure you want to restore from ${backup.filename}? This will overwrite current configurations.`)) return;

    setActionLoading(true);
    try {
      await axios.post(`${API_BASE_URL}/backups/restore/${backup.id}`);
      setMessage({ type: 'success', text: 'System restored successfully' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Restore failed' });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Backups & Restore</h2>
        <button
          onClick={handleCreateBackup}
          disabled={actionLoading}
          className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
        >
          <Plus size={18} />
          <span>{actionLoading ? 'Processing...' : 'Create Manual Backup'}</span>
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-xl flex items-center space-x-3 ${message.type === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
          {message.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <span className="font-medium">{message.text}</span>
          <button onClick={() => setMessage(null)} className="ml-auto text-sm underline">Dismiss</button>
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-900/50">
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Backup File</th>
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Type</th>
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Date</th>
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Status</th>
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {backups.map((backup) => (
              <tr key={backup.id} className="hover:bg-slate-700/30 transition-colors">
                <td className="px-6 py-4 flex items-center space-x-3">
                  <Database size={18} className="text-purple-400" />
                  <span className="font-medium">{backup.filename}</span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-xs px-2 py-1 bg-slate-700 rounded-full capitalize">{backup.backup_type}</span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-400">
                  <div className="flex items-center space-x-2">
                    <Clock size={14} />
                    <span>{new Date(backup.created_at).toLocaleString()}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-xs font-bold ${backup.status === 'success' ? 'text-green-500' : 'text-red-500'}`}>
                    {backup.status.toUpperCase()}
                  </span>
                </td>
                <td className="px-6 py-4 text-right space-x-3">
                  <button
                    onClick={() => handleRestore(backup)}
                    className="p-1.5 hover:bg-slate-600 rounded-lg transition-colors text-orange-400"
                    title="Restore"
                  >
                    <RotateCcw size={18} />
                  </button>
                </td>
              </tr>
            ))}
            {backups.length === 0 && (
              <tr>
                <td colSpan="5" className="px-6 py-12 text-center text-slate-500 italic">
                  No backups found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Backups;
