import React, { useState, useEffect, useMemo } from 'react';
import { RotateCcw, Plus, Loader2, DatabaseBackup, Save, SlidersHorizontal, Filter, X } from 'lucide-react';
import axios from 'axios';

const ALL_PRINTERS_SLUG = '__all_printers__';

const backupTypeOptions = [
  {
    label: 'Farm Backups',
    options: [{ value: 'farm', label: 'Farm Backup' }],
  },
  {
    label: 'Printer Backups',
    options: [{ value: 'printer-config', label: 'Printer Config' }],
  },
  {
    label: 'Other Backups',
    options: [{ value: 'other', label: 'Other' }],
  },
];

const formatBackupType = (type) => {
  if (type === 'file-edit') return 'Printer Config';
  if (type === 'manual' || type === 'farm' || type === 'klipper-farm') return 'Farm Backup';
  return type || 'Backup';
};

const getBackupCategory = (backup) => {
  if (backup.backup_category) return backup.backup_category;
  if (backup.backup_type === 'file-edit') return 'printer-config';
  if (backup.backup_type === 'manual' || backup.backup_type === 'farm' || backup.backup_type === 'klipper-farm') return 'farm';
  return 'other';
};

const getPrinterSlug = (backup) => {
  if (backup.printer_slug) return backup.printer_slug;
  return getBackupCategory(backup) === 'farm' ? ALL_PRINTERS_SLUG : '';
};

const getPrinterName = (backup) => {
  if (backup.printer_name) return backup.printer_name;
  if (getBackupCategory(backup) === 'farm') return 'All printers';
  if (backup.printer_slug) return backup.printer_slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return '-';
};

const Backups = ({ addToast }) => {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [settings, setSettings] = useState({ file_backup_limit: 5 });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [filters, setFilters] = useState({ printer: 'all', type: 'all' });

  useEffect(() => {
    fetchBackups();
    fetchSettings();
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

  const fetchSettings = async () => {
    try {
      const res = await axios.get(`/api/backups/settings`);
      setSettings(res.data);
    } catch (err) {
      console.error("Error fetching backup settings:", err);
    }
  };

  const handleSaveSettings = async () => {
    setSettingsLoading(true);
    try {
      const res = await axios.post(`/api/backups/settings`, settings);
      setSettings(res.data);
      addToast('Backup settings saved', 'success');
      fetchBackups();
    } catch (err) {
      addToast('Failed to save backup settings', 'error');
    } finally {
      setSettingsLoading(false);
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
    const target = backup.backup_type === 'file-edit' ? 'this file' : 'the full printer store';
    if (!window.confirm(`Restore ${target} from ${backup.filename}? Current data may be overwritten.`)) return;

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

  const printerOptions = useMemo(() => {
    const options = new Map();
    backups.forEach((backup) => {
      const slug = getPrinterSlug(backup);
      if (!slug || slug === ALL_PRINTERS_SLUG) return;
      options.set(slug, getPrinterName(backup));
    });
    return Array.from(options.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [backups]);

  const filteredBackups = useMemo(() => (
    backups.filter((backup) => (
      (filters.type === 'all' || getBackupCategory(backup) === filters.type)
      && (filters.printer === 'all' || getPrinterSlug(backup) === filters.printer)
    ))
  ), [backups, filters]);

  const hasActiveFilters = filters.printer !== 'all' || filters.type !== 'all';

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
          <span>{actionLoading ? 'Processing...' : 'Create Farm Backup'}</span>
        </button>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
            <SlidersHorizontal size={12} />
            <span>Edit Backups Per File</span>
          </label>
          <input
            type="number"
            min="0"
            max="100"
            value={settings.file_backup_limit}
            onChange={(e) => setSettings({ ...settings, file_backup_limit: parseInt(e.target.value, 10) || 0 })}
            className="w-36 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>
        <button
          onClick={handleSaveSettings}
          disabled={settingsLoading}
          className="flex items-center space-x-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-bold transition-colors"
        >
          {settingsLoading ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
          <span>Save</span>
        </button>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
            <Filter size={12} />
            <span>Printer</span>
          </label>
          <select
            value={filters.printer}
            onChange={(e) => setFilters({ ...filters, printer: e.target.value })}
            className="w-52 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="all">All printers</option>
            {printerOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Backup Type</label>
          <select
            value={filters.type}
            onChange={(e) => setFilters({ ...filters, type: e.target.value })}
            className="w-52 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="all">All Types</option>
            {backupTypeOptions.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {hasActiveFilters && (
          <button
            onClick={() => setFilters({ printer: 'all', type: 'all' })}
            className="flex items-center space-x-2 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm font-bold transition-colors"
          >
            <X size={16} />
            <span>Clear</span>
          </button>
        )}
        <div className="ml-auto text-sm text-slate-400 py-2">
          <span className="font-mono text-slate-200">{filteredBackups.length}</span>
          <span> / {backups.length}</span>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-900/50">
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Backup Name</th>
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Printer</th>
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Type</th>
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Date</th>
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Status</th>
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {filteredBackups.map((backup) => (
              <tr key={backup.id} className="hover:bg-slate-700/30 transition-colors">
                <td className="px-6 py-4 flex items-center space-x-3">
                  <DatabaseBackup size={18} className="text-purple-400" />
                  <span className="font-medium">{backup.filename}</span>
                </td>
                <td className="px-6 py-4 text-slate-400">
                  {getPrinterName(backup)}
                </td>
                <td className="px-6 py-4 text-slate-400">
                  {backup.display_type || formatBackupType(backup.backup_type)}
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
            {filteredBackups.length === 0 && !loading && (
              <tr>
                <td colSpan="6" className="px-6 py-12 text-center text-slate-500 italic">
                  {backups.length === 0 ? 'No backups found.' : 'No backups match these filters.'}
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
