import React, { useState, useEffect } from 'react';
import { ArrowRight, AlertCircle, Server, Printer as PrinterIcon, ArrowLeftRight, Loader2 } from 'lucide-react';
import axios from 'axios';



const Assignments = ({ addToast }) => {
  const [printers, setPrinters] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState(null);
  const [targetNode, setTargetNode] = useState('');
  const [preflight, setPreflight] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setDataLoading(true);
    try {
      const [pRes, nRes] = await Promise.all([
        axios.get(`/api/printers`),
        axios.get(`/api/nodes`)
      ]);
      setPrinters(pRes.data);
      setNodes(nRes.data);
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setDataLoading(false);
    }
  };

  const handleMigrate = async () => {
    if (!selectedPrinter || !targetNode) return;

    const targetNodeObj = nodes.find(n => n.id === parseInt(targetNode));
    setChecking(true);
    let check = preflight;
    try {
      const res = await axios.post('/api/assignments/check', {
        printer_id: selectedPrinter.id,
        target_node_id: parseInt(targetNode)
      });
      check = res.data;
      setPreflight(check);
    } catch (err) {
      addToast(err.response?.data?.detail || 'Migration preflight failed', 'error');
      setChecking(false);
      return;
    } finally {
      setChecking(false);
    }

    const warningText = check?.warnings?.length ? `\n\nWarnings:\n${check.warnings.join('\n')}` : '';
    if (!window.confirm(`Migrate ${selectedPrinter.name} to ${targetNodeObj.hostname}?${warningText}`)) return;

    setLoading(true);
    try {
      await axios.post(`/api/assignments/migrate`, {
        printer_id: selectedPrinter.id,
        target_node_id: parseInt(targetNode),
        confirmed: true
      });
      addToast(`Successfully migrated ${selectedPrinter.name}`, "success");
      fetchData();
      setSelectedPrinter(null);
      setTargetNode('');
      setPreflight(null);
    } catch (err) {
      addToast(err.response?.data?.detail || "Migration failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const runPreflight = async () => {
    if (!selectedPrinter || !targetNode) return;
    setChecking(true);
    try {
      const res = await axios.post('/api/assignments/check', {
        printer_id: selectedPrinter.id,
        target_node_id: parseInt(targetNode)
      });
      setPreflight(res.data);
    } catch (err) {
      setPreflight(null);
      addToast(err.response?.data?.detail || 'Preflight failed', 'error');
    } finally {
      setChecking(false);
    }
  };

  if (dataLoading) {
     return <div className="p-8 text-center text-slate-500 animate-pulse font-medium">Initialising Migration Manager...</div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Assignments & Migration</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4 shadow-sm">
          <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
             <PrinterIcon size={18} className="text-blue-400" />
             <h3 className="font-bold text-sm">Select Printer</h3>
          </div>
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
            {printers.map(printer => (
              <button
                key={printer.id}
                onClick={() => { setSelectedPrinter(printer); setTargetNode(''); setPreflight(null); }}
                className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all text-left ${
                  selectedPrinter?.id === printer.id
                    ? 'bg-blue-600/10 border-blue-600 text-blue-400 shadow-inner shadow-blue-900/10'
                    : 'bg-slate-900 border-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${selectedPrinter?.id === printer.id ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                    <PrinterIcon size={18} />
                  </div>
                  <span className="font-bold text-sm">{printer.name}</span>
                </div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter bg-slate-800 px-2 py-1 rounded-full">
                  Node: {nodes.find(n => n.id === printer.assigned_node_id)?.hostname || 'Unassigned'}
                </span>
              </button>
            ))}
            {printers.length === 0 && <div className="p-8 text-center text-slate-600 italic text-sm">No printers found.</div>}
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-6 shadow-sm">
          <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
             <ArrowLeftRight size={18} className="text-orange-400" />
             <h3 className="font-bold text-sm">Migration Workflow</h3>
          </div>

          {selectedPrinter ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-inner">
                <div className="text-center flex-1">
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Current</p>
                  <p className="font-bold text-slate-300">{nodes.find(n => n.id === selectedPrinter.assigned_node_id)?.hostname || 'None'}</p>
                </div>
                <div className="bg-slate-800 p-2 rounded-full border border-slate-700 shadow-sm">
                   <ArrowRight className="text-blue-500" size={24} />
                </div>
                <div className="text-center flex-1">
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Target</p>
                <select
                  value={targetNode}
                    onChange={(e) => { setTargetNode(e.target.value); setPreflight(null); }}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 mt-1 text-sm outline-none w-full text-blue-400 font-bold text-center focus:border-blue-500 transition-colors"
                  >
                    <option value="">Select Node...</option>
                    {nodes.filter(n => n.id !== selectedPrinter.assigned_node_id).map(node => (
                      <option key={node.id} value={node.id}>{node.hostname} {node.online ? '' : '(OFFLINE)'}</option>
                    ))}
                  </select>
                </div>
              </div>

              {targetNode && (
                <div className="space-y-3">
                  <button
                    onClick={runPreflight}
                    disabled={checking}
                    className="w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 py-3 rounded-xl font-bold transition-all flex items-center justify-center space-x-3"
                  >
                    {checking ? <Loader2 className="animate-spin" size={18} /> : <AlertCircle size={18} />}
                    <span>Run Preflight</span>
                  </button>
                  {preflight && (
                    <div className={`rounded-xl border p-4 text-sm ${preflight.can_migrate ? 'bg-green-500/5 border-green-500/20 text-green-200' : 'bg-orange-500/5 border-orange-500/20 text-orange-200'}`}>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div><span className="font-bold uppercase text-slate-500">Target</span><p>{preflight.target_online ? 'Online' : 'Not ready'}</p></div>
                        <div><span className="font-bold uppercase text-slate-500">MCU</span><p>{preflight.target_has_expected_mcu ? 'Found' : 'Not found'}</p></div>
                        <div><span className="font-bold uppercase text-slate-500">Old Node</span><p>{preflight.old_online ? 'Reachable' : 'Offline or none'}</p></div>
                        <div><span className="font-bold uppercase text-slate-500">USB Devices</span><p>{preflight.usb_devices?.length || 0}</p></div>
                      </div>
                      {preflight.warnings?.length > 0 && (
                        <div className="mt-3 space-y-1 text-xs">
                          {preflight.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="bg-blue-500/5 border border-blue-500/10 p-4 rounded-xl flex items-start space-x-3">
                <AlertCircle size={20} className="text-blue-400 mt-0.5 shrink-0" />
                <div className="text-xs text-blue-300 leading-relaxed">
                  <p className="font-bold uppercase tracking-widest mb-1 text-blue-400">Migration Safety Check</p>
                  <ul className="list-disc ml-4 space-y-1 opacity-80">
                    <li>Target node must be reachable on the network</li>
                    <li>The printer's MCU serial path will be verified on target</li>
                    <li>Services on old node will be stopped automatically if reachable</li>
                  </ul>
                </div>
              </div>

              <button
                onClick={handleMigrate}
                disabled={!targetNode || loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 py-4 rounded-xl font-bold transition-all flex items-center justify-center space-x-3 shadow-lg shadow-blue-900/20"
              >
                {loading ? <Loader2 className="animate-spin" size={20} /> : <><ArrowLeftRight size={20} /><span>Execute Migration</span></>}
              </button>
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-slate-600 space-y-4 italic">
              <div className="bg-slate-900 p-6 rounded-full border border-slate-800 opacity-20">
                <Server size={48} />
              </div>
              <p className="text-sm">Select a printer from the list to begin migration</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Assignments;
