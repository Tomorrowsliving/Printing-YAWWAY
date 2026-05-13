import React, { useState } from 'react';
import { Mail, ShieldCheck, Save, Send, Loader2 } from 'lucide-react';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || '/api';

const Settings = ({ addToast }) => {
  const [smtp, setSmtp] = useState({
    host: '',
    port: '587',
    user: '',
    pass: '',
    from: 'noreply@klipperfarm.local'
  });
  const [testEmail, setTestEmail] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await axios.post(`${API_BASE_URL}/settings/email`, smtp);
      addToast("Settings saved successfully", "success");
    } catch (err) {
      addToast("Failed to save settings", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmail) return addToast("Enter a test email address", "info");
    setIsTesting(true);
    try {
      await axios.post(`${API_BASE_URL}/notifications/test`, { email: testEmail, config: smtp });
      addToast("Test email sent!", "success");
    } catch (err) {
      addToast("Failed to send test email", "error");
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h2 className="text-2xl font-bold">Settings</h2>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-6 shadow-sm">
        <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
          <Mail size={20} className="text-blue-400" />
          <h3 className="font-bold text-lg">Email Notifications (SMTP)</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">SMTP Host</label>
            <input
              type="text"
              value={smtp.host}
              onChange={(e) => setSmtp({...smtp, host: e.target.value})}
              placeholder="smtp.gmail.com"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">SMTP Port</label>
            <input
              type="text"
              value={smtp.port}
              onChange={(e) => setSmtp({...smtp, port: e.target.value})}
              placeholder="587"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Username</label>
            <input
              type="text"
              value={smtp.user}
              onChange={(e) => setSmtp({...smtp, user: e.target.value})}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Password / App Key</label>
            <input
              type="password"
              value={smtp.pass}
              onChange={(e) => setSmtp({...smtp, pass: e.target.value})}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-slate-700 flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex-1 space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Send Test To</label>
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="your-email@example.com"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <button
            onClick={handleTestEmail}
            disabled={isTesting}
            className="flex items-center justify-center space-x-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-6 py-2 rounded-lg font-bold transition-colors text-sm"
          >
            {isTesting ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
            <span>Send Test</span>
          </button>
          <button
            onClick={handleSaveSettings}
            disabled={isSaving}
            className="flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-6 py-2 rounded-lg font-bold transition-colors text-sm shadow-lg shadow-blue-900/20"
          >
            {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
            <span>Save Settings</span>
          </button>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4 shadow-sm">
        <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
          <ShieldCheck size={20} className="text-green-400" />
          <h3 className="font-bold text-lg">System Information</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div className="p-3 bg-slate-900/50 rounded-lg">
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Backend Version</p>
            <p className="font-mono text-slate-300">v1.0.0-mvp</p>
          </div>
          <div className="p-3 bg-slate-900/50 rounded-lg">
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Database Status</p>
            <p className="text-green-500 font-bold flex items-center space-x-1">
              <span className="w-2 h-2 bg-green-500 rounded-full inline-block animate-pulse"></span>
              <span>Connected</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
