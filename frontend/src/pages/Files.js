import React, { useState, useEffect, useCallback } from 'react';
import { File, Save, X, Edit, Trash2, Loader2, FileWarning, RefreshCw } from 'lucide-react';
import axios from 'axios';



const FileManager = ({ addToast }) => {
  const [printers, setPrinters] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [selectedType, setSelectedType] = useState('config');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingFile, setEditingFile] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    axios.get(`/api/printers`)
      .then(res => {
        setPrinters(res.data);
        if (res.data.length > 0) setSelectedPrinter(res.data[0].slug);
      })
      .catch(() => addToast("Failed to fetch printers", "error"));
  }, [addToast]);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/files/${selectedPrinter}/${selectedType}`);
      setFiles(res.data);
    } catch (err) {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [selectedPrinter, selectedType]);

  useEffect(() => {
    if (selectedPrinter && selectedType) {
      fetchFiles();
    }
  }, [selectedPrinter, selectedType, fetchFiles]);

  const handleEdit = async (file) => {
    try {
      const res = await axios.get(`/api/files/read`, { params: { path: file.path } });
      setEditingFile(file);
      setEditContent(res.data.content);
    } catch (err) {
      addToast("Failed to read file", "error");
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await axios.post(`/api/files/save`, { content: editContent }, {
        params: { path: editingFile.path }
      });
      addToast("File saved successfully (backup created)", "success");
      setEditingFile(null);
      fetchFiles();
    } catch (err) {
      addToast("Failed to save file", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (file) => {
    if (!window.confirm(`Are you sure you want to delete ${file.name}?`)) return;
    try {
      await axios.delete(`/api/files/delete`, { params: { path: file.path } });
      addToast("File deleted", "success");
      fetchFiles();
    } catch (err) {
      addToast("Failed to delete file", "error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">File Manager</h2>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Printer</label>
          <select
            value={selectedPrinter}
            onChange={(e) => setSelectedPrinter(e.target.value)}
            className="w-48 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="">Select Printer...</option>
            {printers.map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">File Type</label>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="w-48 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="config">Configuration</option>
            <option value="gcode">G-code</option>
            <option value="logs">Logs</option>
          </select>
        </div>
        <button onClick={fetchFiles} className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">
          <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
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
                <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {files.map((file) => (
                <tr key={file.path} className="hover:bg-slate-700/30 transition-colors">
                  <td className="px-6 py-4 flex items-center space-x-3">
                    <File size={18} className="text-blue-400" />
                    <span className="font-medium text-sm">{file.name}</span>
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <button onClick={() => handleEdit(file)} className="p-1.5 hover:bg-slate-600 rounded-lg transition-colors text-blue-400">
                      <Edit size={16} />
                    </button>
                    <button onClick={() => handleDelete(file)} className="p-1.5 hover:bg-slate-600 rounded-lg transition-colors text-red-400">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {files.length === 0 && (
                <tr>
                  <td colSpan="2" className="px-6 py-12 text-center text-slate-500 italic flex flex-col items-center">
                    <FileWarning size={32} className="mb-2 opacity-20" />
                    <span>No files found for this printer and type.</span>
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
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg"><Edit size={20} /></div>
                <div>
                  <h3 className="font-bold">{editingFile.name}</h3>
                  <p className="text-[10px] text-slate-500 font-mono">{editingFile.path}</p>
                </div>
              </div>
              <button onClick={() => setEditingFile(null)} className="p-2 hover:bg-slate-700 rounded-lg transition-colors"><X size={20} /></button>
            </div>
            <div className="flex-1 p-4 bg-slate-900">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-full bg-transparent text-blue-100 font-mono text-sm p-4 outline-none resize-none"
                spellCheck="false"
              />
            </div>
            <div className="p-4 border-t border-slate-700 flex justify-end space-x-3 bg-slate-800/50">
              <button onClick={() => setEditingFile(null)} className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center space-x-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 rounded-lg text-sm font-bold transition-colors"
              >
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
