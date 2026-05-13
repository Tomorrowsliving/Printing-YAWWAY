import React, { useState, useEffect } from 'react';
import { ArrowRight, AlertCircle, CheckCircle2, Server, Printer as PrinterIcon } from 'lucide-react';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const Assignments = () => {
  const [printers, setPrinters] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState(null);
  const [targetNode, setTargetNode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [pRes, nRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/printers`),
        axios.get(`${API_BASE_URL}/nodes`)
      ]);
      setPrinters(pRes.data);
      setNodes(nRes.data);
    } catch (err) {
      console.error("Error fetching data:", err);
    }
  };

  const handleMigrate = async () => {
    if (!selectedPrinter || !targetNode) return;

    const targetNodeObj = nodes.find(n => n.id === parseInt(targetNode));
    if (targetNodeObj && !targetNodeObj.online) {
      alert("Target node is offline. Cannot migrate.");
      return;
    }

    if (!window.confirm(`Are you sure you want to migrate ${selectedPrinter.name} to ${targetNodeObj.hostname}?`)) return;

    setLoading(true);
    try {
      await axios.post(`${API_BASE_URL}/assignments/migrate`, {
        printer_id: selectedPrinter.id,
        target_node_id: parseInt(targetNode)
      });
      setMessage({ type: 'success', text: `Successfully migrated ${selectedPrinter.name}` });
      fetchData();
      setSelectedPrinter(null);
      setTargetNode('');
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.detail || "Migration failed" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Assignments & Migration</h2>
      </div>

      {message && (
        <div className={`p-4 rounded-xl flex items-center space-x-3 ${message.type === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
          {message.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <span className="font-medium">{message.text}</span>
          <button onClick={() => setMessage(null)} className="ml-auto text-sm underline">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4">
          <h3 className="font-bold text-lg mb-4">Select Printer</h3>
          <div className="space-y-2">
            {printers.map(printer => (
              <button
                key={printer.id}
                onClick={() => setSelectedPrinter(printer)}
                className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${
                  selectedPrinter?.id === printer.id
                    ? 'bg-blue-600/10 border-blue-600 text-blue-400'
                    : 'bg-slate-900 border-slate-700 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <PrinterIcon size={20} />
                  <span className="font-bold">{printer.name}</span>
                </div>
                <span className="text-xs text-slate-500">
                  Node: {nodes.find(n => n.id === printer.assigned_node_id)?.hostname || 'Unassigned'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-6">
          <h3 className="font-bold text-lg">Migration Workflow</h3>

          {selectedPrinter ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between bg-slate-900 p-4 rounded-xl">
                <div className="text-center flex-1">
                  <p className="text-[10px] text-slate-500 font-bold uppercase">Current Node</p>
                  <p className="font-bold">{nodes.find(n => n.id === selectedPrinter.assigned_node_id)?.hostname || 'None'}</p>
                </div>
                <ArrowRight className="text-slate-600 mx-4" />
                <div className="text-center flex-1">
                  <p className="text-[10px] text-slate-500 font-bold uppercase">Target Node</p>
                  <select
                    value={targetNode}
                    onChange={(e) => setTargetNode(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 mt-1 text-sm outline-none w-full"
                  >
                    <option value="">Select Node...</option>
                    {nodes.filter(n => n.id !== selectedPrinter.assigned_node_id).map(node => (
                      <option key={node.id} value={node.id}>{node.hostname} {node.online ? '' : '(Offline)'}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-xl flex items-start space-x-3">
                <AlertCircle size={20} className="text-blue-400 mt-0.5" />
                <div className="text-sm text-blue-300">
                  <p className="font-bold">Migration Safety Check</p>
                  <ul className="list-disc ml-4 mt-2 space-y-1">
                    <li>Target node must be reachable</li>
                    <li>Expected MCU serial path will be verified</li>
                    <li>Services on old node will be stopped if reachable</li>
                  </ul>
                </div>
              </div>

              <button
                onClick={handleMigrate}
                disabled={!targetNode || loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 py-3 rounded-xl font-bold transition-all flex items-center justify-center space-x-2"
              >
                {loading ? 'Processing Migration...' : 'Execute Migration'}
              </button>
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-slate-500 space-y-4">
              <Server size={48} className="opacity-20" />
              <p>Select a printer to begin migration</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Assignments;
