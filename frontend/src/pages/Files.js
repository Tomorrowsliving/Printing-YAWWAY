import React, { useState, useEffect } from 'react';
import { File, Folder, Search, Filter, Save, X, Edit, Trash2 } from 'lucide-react';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const FileManager = () => {
  const [printers, setPrinters] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [selectedType, setSelectedType] = useState('config');
  const [files, setFiles] = useState([]);
  const [editingFile, setEditingFile] = useState(null);
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    // Fetch printers to populate dropdown
    axios.get(`${API_BASE_URL}/printers`)
      .then(res => {
        setPrinters(res.data);
        if (res.data.length > 0) setSelectedPrinter(res.data[0].slug);
      });
  }, []);

  useEffect(() => {
    if (selectedPrinter && selectedType) {
      fetchFiles();
    }
  }, [selectedPrinter, selectedType]);

  const fetchFiles = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/files/${selectedPrinter}/${selectedType}`);
      setFiles(res.data);
    } catch (err) {
      console.error("Error fetching files:", err);
      setFiles([]);
    }
  };

  const handleEdit = async (file) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/files/read`, { params: { path: file.path } });
      setEditingFile(file);
      setEditContent(res.data.content);
    } catch (err) {
      alert("Failed to read file");
    }
  };

  const handleSave = async () => {
    try {
      await axios.post(`${API_BASE_URL}/files/save`, null, {
        params: { path: editingFile.path, content: editContent }
      });
      alert("File saved successfully (backup created)");
      setEditingFile(null);
      fetchFiles();
    } catch (err) {
      alert("Failed to save file");
    }
  };

  const handleDelete = async (file) => {
    if (!window.confirm(`Are you sure you want to delete ${file.name}?`)) return;
    try {
      await axios.delete(`${API_BASE_URL}/files/delete`, { params: { path: file.path } });
      fetchFiles();
    } catch (err) {
      alert("Failed to delete file");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">File Manager</h2>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-wrap gap-4">
        <div className="flex items-center space-x-2">
          <label className="text-sm font-bold text-slate-500 uppercase">Printer:</label>
          <select
            value={selectedPrinter}
            onChange={(e) => setSelectedPrinter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-500"
          >
            {printers.map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
          </select>
        </div>
        <div className="flex items-center space-x-2">
          <label className="text-sm font-bold text-slate-500 uppercase">Type:</label>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-500"
          >
            <option value="config">Configuration</option>
            <option value="gcode">G-code</option>
            <option value="logs">Logs</option>
          </select>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-900/50">
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Name</th>
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Size</th>
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Modified</th>
              <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {files.map((file) => (
              <tr key={file.path} className="hover:bg-slate-700/30 transition-colors">
                <td className="px-6 py-4 flex items-center space-x-3">
                  <File size={18} className="text-blue-400" />
                  <span className="font-medium">{file.name}</span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-400">
                  {(file.size / 1024).toFixed(2)} KB
                </td>
                <td className="px-6 py-4 text-sm text-slate-400">
                  {new Date(file.last_modified * 1000).toLocaleString()}
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
                <td colSpan="4" className="px-6 py-12 text-center text-slate-500">No files found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Editor Modal */}
      {editingFile && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-700 flex justify-between items-center">
              <div>
                <h3 className="font-bold">Editing: {editingFile.name}</h3>
                <p className="text-xs text-slate-400">{editingFile.path}</p>
              </div>
              <button onClick={() => setEditingFile(null)} className="p-2 hover:bg-slate-700 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 p-4">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-full bg-slate-900 text-slate-300 font-mono text-sm p-4 rounded-xl border border-slate-700 outline-none focus:border-blue-500 resize-none"
              />
            </div>
            <div className="p-4 border-t border-slate-700 flex justify-end space-x-3">
              <button onClick={() => setEditingFile(null)} className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-white transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} className="flex items-center space-x-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-bold transition-colors">
                <Save size={18} />
                <span>Save Changes</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileManager;
