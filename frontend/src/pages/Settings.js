import React, { useState } from 'react';
import { Mail, ShieldCheck, Save, Send } from 'lucide-react';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const Settings = () => {
  const [smtp, setSmtp] = useState({
    host: '',
    port: '587',
    user: '',
    pass: '',
    from: 'noreply@klipperfarm.local'
  });
  const [testEmail, setTestEmail] = useState('');
  const [status, setStatus] = useState(null);

  const handleTestEmail = async () => {
    setStatus({ type: 'info', text: 'Sending test email...' });
    try {
      await axios.post(`${API_BASE_URL}/notifications/test`, { email: testEmail, config: smtp });
      setStatus({ type: 'success', text: 'Test email sent!' });
    } catch (err) {
      setStatus({ type: 'error', text: 'Failed to send test email' });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <h2 className="text-2xl font-bold">Settings</h2>

      {status && (
        <div className={`p-4 rounded-xl text-sm font-medium ${
          status.type === 'success' ? 'bg-green-500/10 text-green-500' :
          status.type === 'error' ? 'bg-red-500/10 text-red-500' : 'bg-blue-500/10 text-blue-500'
        }`}>
          {status.text}
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-6">
        <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
          <Mail size={20} className="text-blue-400" />
          <h3 className="font-bold text-lg">Email Notifications (SMTP)</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">SMTP Host</label>
            <input
              type="text"
              value={smtp.host}
              onChange={(e) => setSmtp({...smtp, host: e.target.value})}
              placeholder="smtp.gmail.com"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-blue-500"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">SMTP Port</label>
            <input
              type="text"
              value={smtp.port}
              onChange={(e) => setSmtp({...smtp, port: e.target.value})}
              placeholder="587"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-blue-500"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">Username</label>
            <input
              type="text"
              value={smtp.user}
              onChange={(e) => setSmtp({...smtp, user: e.target.value})}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-blue-500"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">Password / App Key</label>
            <input
              type="password"
              value={smtp.pass}
              onChange={(e) => setSmtp({...smtp, pass: e.target.value})}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-slate-700 flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex-1 space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">Send Test To</label>
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="your-email@example.com"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={handleTestEmail}
            className="flex items-center justify-center space-x-2 bg-slate-700 hover:bg-slate-600 px-6 py-2 rounded-lg font-bold transition-colors"
          >
            <Send size={18} />
            <span>Send Test</span>
          </button>
          <button className="flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg font-bold transition-colors">
            <Save size={18} />
            <span>Save Settings</span>
          </button>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4">
        <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
          <ShieldCheck size={20} className="text-green-400" />
          <h3 className="font-bold text-lg">System Status</h3>
        </div>
        <div className="text-sm space-y-2">
          <p className="flex justify-between"><span>Backend Version:</span> <span className="text-slate-400 font-mono text-xs">v1.0.0-mvp</span></p>
          <p className="flex justify-between"><span>Database:</span> <span className="text-green-500 font-bold">Connected</span></p>
          <p className="flex justify-between"><span>Storage Root:</span> <span className="text-slate-400 font-mono text-xs">/srv/klipper-farm</span></p>
        </div>
      </div>
    </div>
  );
};

export default Settings;
