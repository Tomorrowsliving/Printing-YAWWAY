import React, { useState, useEffect } from 'react';
import { Server, Activity, Thermometer, Cpu, HardDrive, CheckCircle, XCircle } from 'lucide-react';
import { nodeService } from '../services/api';

const NodeOverview = () => {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNodes();
    const interval = setInterval(fetchNodes, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchNodes = async () => {
    try {
      const res = await nodeService.getNodes();
      setNodes(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Error fetching nodes:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400 animate-pulse font-medium">Initialising Nodes...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Node Overview</h2>
        <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors">
          Register Node
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {(nodes || []).map((node) => (
          <div key={node.id} className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
            <div className="flex justify-between items-start">
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-lg ${node.online ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                  <Server size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-lg">{node.hostname || 'Unknown'}</h3>
                  <p className="text-xs text-slate-400">{node.ip_address || '0.0.0.0'}:{node.agent_port || 8000}</p>
                </div>
              </div>
              <div className={`flex items-center space-x-1 text-xs font-medium px-2 py-1 rounded-full ${node.online ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                {node.online ? <CheckCircle size={12} /> : <XCircle size={12} />}
                <span>{node.online ? 'Online' : 'Offline'}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900/50 p-3 rounded-lg flex items-center space-x-3">
                <Cpu size={16} className="text-blue-400" />
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-bold">CPU</p>
                  <p className="text-sm font-semibold">{node.cpu_usage || 0}%</p>
                </div>
              </div>
              <div className="bg-slate-900/50 p-3 rounded-lg flex items-center space-x-3">
                <HardDrive size={16} className="text-purple-400" />
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-bold">RAM</p>
                  <p className="text-sm font-semibold">{node.ram_usage || 0}%</p>
                </div>
              </div>
              <div className="bg-slate-900/50 p-3 rounded-lg flex items-center space-x-3">
                <Thermometer size={16} className="text-orange-400" />
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-bold">Temp</p>
                  <p className="text-sm font-semibold">{node.temperature || 0}°C</p>
                </div>
              </div>
              <div className="bg-slate-900/50 p-3 rounded-lg flex items-center space-x-3">
                <Activity size={16} className="text-green-400" />
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-bold">Uptime</p>
                  <p className="text-sm font-semibold truncate max-w-[80px]">{node.uptime || '0s'}</p>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <p className="text-xs text-slate-500">Model: <span className="text-slate-300">{node.model || 'Unknown'}</span></p>
            </div>
          </div>
        ))}
        {(!nodes || nodes.length === 0) && (
          <div className="col-span-full py-12 text-center bg-slate-800 border border-slate-700 rounded-xl border-dashed">
            <p className="text-slate-400">No nodes registered yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default NodeOverview;
