import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Edit, File, FileWarning, Loader2, RefreshCw, Save, Trash2, Upload, X } from 'lucide-react';
import axios from 'axios';

const FILE_TYPES = [
  { value: 'config', label: 'Printer Configs', editable: true, uploadable: true },
  { value: 'moonraker', label: 'Moonraker Configs', editable: true, uploadable: true },
  { value: 'macros', label: 'Macros', editable: true, uploadable: true },
  { value: 'gcode', label: 'G-code', editable: false, uploadable: true },
  { value: 'logs', label: 'Logs', editable: false, uploadable: true },
  { value: 'backups', label: 'Backup Files', editable: false, uploadable: false },
];

const formatBytes = (value = 0) => {
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value > 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
};

const FileManager = ({ addToast }) => {
  const [printers, setPrinters] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [selectedType, setSelectedType] = useState('config');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingFile, setEditingFile] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [renamingPath, setRenamingPath] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [uploading, setUploading] = useState(false);

  const selectedTypeConfig = useMemo(
    () => FILE_TYPES.find(type => type.value === selectedType) || FILE_TYPES[0],
    [selectedType]
  );

  useEffect(() => {
    axios.get('/api/printers')
      .then(res => {
        const data = Array.isArray(res.data) ? res.data : [];
        setPrinters(data);
        if (data.length > 0) setSelectedPrinter(data[0].slug);
      })
      .catch(() => addToast('Failed to fetch printers', 'error'));
  }, [addToast]);

  const fetchFiles = useCallback(async () => {
    if (!selectedPrinter || !selectedType) return;
    setLoading(true);
    try {
      const res = await axios.get(`/api/files/${selectedPrinter}/${selectedType}`);
      setFiles(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setFiles([]);
      addToast(err.response?.data?.detail || 'Failed to list files', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedPrinter, selectedType, addToast]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleEdit = async (file) => {
    try {
      const res = await axios.get('/api/files/read', { params: { path: file.path } });
      setEditingFile(file);
      setEditContent(res.data.content);
    } catch (err) {
      addToast('Failed to read file', 'error');
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await axios.post('/api/files/save', { content: editContent }, { params: { path: editingFile.path } });
      addToast(res.data?.backup_created ? 'File saved with backup' : 'File saved', 'success');
      setEditingFile(null);
      fetchFiles();
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to save file', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (file) => {
    if (!window.confirm(`Delete ${file.name}?`)) return;
    try {
      await axios.delete('/api/files/delete', { params: { path: file.path } });
      addToast('File deleted', 'success');
      fetchFiles();
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to delete file', 'error');
    }
  };

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !selectedPrinter) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await axios.post('/api/files/upload', formData, {
        params: { printer_slug: selectedPrinter, file_type: selectedType },
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      addToast('File uploaded', 'success');
      fetchFiles();
    } catch (err) {
      addToast(err.response?.data?.detail || 'Upload failed', 'error');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const startRename = (file) => {
    setRenamingPath(file.path);
    setRenameValue(file.name.split('/').pop());
  };

  const saveRename = async () => {
    try {
      await axios.post('/api/files/rename', { path: renamingPath, new_name: renameValue });
      addToast('File renamed', 'success');
      setRenamingPath('');
      setRenameValue('');
      fetchFiles();
    } catch (err) {
      addToast(err.response?.data?.detail || 'Rename failed', 'error');
    }
  };

  const downloadUrl = (file) => `/api/files/download?path=${encodeURIComponent(file.path)}`;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Files</h2>
          <p className="text-sm text-slate-400">Configs, macros, logs, G-code and file backups</p>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Printer</label>
          <select value={selectedPrinter} onChange={(e) => setSelectedPrinter(e.target.value)} className="w-56 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500">
            <option value="">Select printer</option>
            {printers.map(printer => <option key={printer.id} value={printer.slug}>{printer.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">File Type</label>
          <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)} className="w-56 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500">
            {FILE_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </div>
        {selectedTypeConfig.uploadable && (
          <label className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 flex items-center gap-2 text-sm font-bold cursor-pointer">
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            Upload
            <input type="file" className="hidden" onChange={handleUpload} />
          </label>
        )}
        <button onClick={fetchFiles} className="h-10 w-10 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors flex items-center justify-center">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/50">
                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Name</th>
                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Path</th>
                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Size</th>
                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {files.map((file) => (
                <tr key={file.path} className="hover:bg-slate-700/30 transition-colors">
                  <td className="px-6 py-4">
                    {renamingPath === file.path ? (
                      <div className="flex items-center gap-2">
                        <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-sm" />
                        <button onClick={saveRename} className="p-1.5 rounded-lg bg-green-600 hover:bg-green-700"><Save size={14} /></button>
                        <button onClick={() => setRenamingPath('')} className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600"><X size={14} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center space-x-3 min-w-0">
                        <File size={18} className="text-blue-400 shrink-0" />
                        <span className="font-medium text-sm truncate">{file.name}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 max-w-md">
                    <p className="font-mono text-[11px] text-slate-500 truncate" title={file.path}>{file.path}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-400">{formatBytes(file.size)}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      {selectedTypeConfig.editable && (
                        <button title="Edit" onClick={() => handleEdit(file)} className="p-1.5 hover:bg-slate-600 rounded-lg transition-colors text-blue-400">
                          <Edit size={16} />
                        </button>
                      )}
                      {selectedType !== 'backups' && (
                        <button title="Rename" onClick={() => startRename(file)} className="p-1.5 hover:bg-slate-600 rounded-lg transition-colors text-slate-300">
                          <Save size={16} />
                        </button>
                      )}
                      <a title="Download" href={downloadUrl(file)} className="p-1.5 hover:bg-slate-600 rounded-lg transition-colors text-green-400">
                        <Download size={16} />
                      </a>
                      <button title="Delete" onClick={() => handleDelete(file)} className="p-1.5 hover:bg-slate-600 rounded-lg transition-colors text-red-400">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {files.length === 0 && (
                <tr>
                  <td colSpan="4" className="px-6 py-12 text-center text-slate-500">
                    <FileWarning size={32} className="mb-2 opacity-20 mx-auto" />
                    No files found for this printer and type.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {editingFile && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-in fade-in duration-200">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-700 flex justify-between items-center">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg"><Edit size={20} /></div>
                <div className="min-w-0">
                  <h3 className="font-bold truncate">{editingFile.name}</h3>
                  <p className="text-[10px] text-slate-500 font-mono truncate">{editingFile.path}</p>
                </div>
              </div>
              <button onClick={() => setEditingFile(null)} className="p-2 hover:bg-slate-700 rounded-lg transition-colors"><X size={20} /></button>
            </div>
            <div className="flex-1 p-4 bg-slate-900">
              <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="w-full h-full bg-transparent text-blue-100 font-mono text-sm p-4 outline-none resize-none" spellCheck="false" />
            </div>
            <div className="p-4 border-t border-slate-700 flex justify-end space-x-3 bg-slate-800/50">
              <button onClick={() => setEditingFile(null)} className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={isSaving} className="flex items-center space-x-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 rounded-lg text-sm font-bold transition-colors">
                {isSaving ? <Loader2 className="animate-spin" size={18} /> : <><Save size={18} /><span>Save & Backup</span></>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileManager;
