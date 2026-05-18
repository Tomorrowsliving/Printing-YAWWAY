import React, { useState, useEffect } from 'react';
import { RotateCcw, Plus, Loader2, DatabaseBackup } from 'lucide-react';
import axios from 'axios';



const Backups = ({ addToast }) => {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchBackups();
  }, []);

  const fetchBackups = async () => {
    try {
      const res = await axios.get(`/api/backups`);
      setBackups(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Error fetching backups:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    setActionLoading(true);
    try {
      await axios.post(`/api/backups/create`);
      addToast('Backup created successfully', 'success');
      fetchBackups();
    } catch (err) {
      addToast('Failed to create backup', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestore = async (backup) => {
    if (!window.confirm(`Are you sure you want to restore from ${backup.filename}? Current data may be overwritten.`)) return;

    setActionLoading(true);
    try {
      await axios.post(`/api/backups/restore/${backup.id}`);
      addToast('System restored successfully', 'success');
    } catch (err) {
      addToast('Restore failed', 'error');
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
          className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors shadow-lg shadow-blue-900/20"
        >
          {actionLoading ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
          <span>{actionLoading ? 'Processing...' : 'Create Manual Backup'}</span>
        </button>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-900/50">
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Backup Name</th>
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Date</th>
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Status</th>
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {backups.map((backup) => (
              <tr key={backup.id} className="hover:bg-slate-700/30 transition-colors">
                <td className="px-6 py-4 flex items-center space-x-3">
                  <DatabaseBackup size={18} className="text-purple-400" />
                  <span className="font-medium">{backup.filename}</span>
                </td>
                <td className="px-6 py-4 text-slate-400">
                  {new Date(backup.created_at).toLocaleString()}
                </td>
                <td className="px-6 py-4">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${backup.status === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                    {backup.status.toUpperCase()}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
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
            {backups.length === 0 && !loading && (
              <tr>
                <td colSpan="4" className="px-6 py-12 text-center text-slate-500 italic">No backups found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Backups;
