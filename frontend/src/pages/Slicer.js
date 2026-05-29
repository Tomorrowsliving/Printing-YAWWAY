import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Box, CheckCircle2, ClipboardList, Copy, Loader2, Play, Plus, RefreshCw, Save, Scissors,
  Settings2, Trash2, Upload, XCircle
} from 'lucide-react';

const emptyProfile = {
  name: '',
  profile_type: 'printer',
  engine: 'orca',
  printer_id: '',
  data: '{\n  "extra_args": []\n}'
};

const statusTone = (status) => {
  if (status === 'completed') return 'text-green-300 bg-green-500/10 border-green-500/20';
  if (status === 'failed') return 'text-red-300 bg-red-500/10 border-red-500/20';
  if (status === 'running') return 'text-blue-300 bg-blue-500/10 border-blue-500/20';
  if (status === 'cancelled') return 'text-slate-300 bg-slate-500/10 border-slate-500/20';
  return 'text-orange-300 bg-orange-500/10 border-orange-500/20';
};

const Slicer = ({ addToast }) => {
  const [printers, setPrinters] = useState([]);
  const [settings, setSettings] = useState({ orca_binary_path: '' });
  const [health, setHealth] = useState(null);
  const [models, setModels] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [installInfo, setInstallInfo] = useState(null);
  const [profileForm, setProfileForm] = useState(emptyProfile);
  const [jobForm, setJobForm] = useState({
    model_id: '',
    printer_id: '',
    printer_profile_id: '',
    filament_profile_id: '',
    process_profile_id: ''
  });
  const [uploading, setUploading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [startingJob, setStartingJob] = useState(false);

  const refresh = useCallback(async () => {
    const [printerRes, settingsRes, healthRes, modelRes, profileRes, jobRes, installRes] = await Promise.all([
      axios.get('/api/printers'),
      axios.get('/api/slicer/settings'),
      axios.get('/api/slicer/health'),
      axios.get('/api/slicer/models'),
      axios.get('/api/slicer/profiles'),
      axios.get('/api/slicer/jobs'),
      axios.get('/api/slicer/install-info')
    ]);
    setPrinters(printerRes.data || []);
    setSettings(settingsRes.data || { orca_binary_path: '' });
    setHealth(healthRes.data || null);
    setModels(modelRes.data || []);
    setProfiles(profileRes.data || []);
    setJobs(jobRes.data || []);
    setInstallInfo(installRes.data || null);
  }, []);

  useEffect(() => {
    refresh().catch(() => addToast('Failed to load slicer state', 'error'));
    const interval = setInterval(() => {
      axios.get('/api/slicer/jobs').then(res => setJobs(res.data || [])).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [addToast, refresh]);

  const groupedProfiles = useMemo(() => ({
    printer: profiles.filter(profile => profile.profile_type === 'printer'),
    filament: profiles.filter(profile => profile.profile_type === 'filament'),
    process: profiles.filter(profile => profile.profile_type === 'process')
  }), [profiles]);

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await axios.post('/api/slicer/settings', settings);
      addToast('Slicer settings saved', 'success');
      await refresh();
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to save slicer settings', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const copyInstallCommand = async () => {
    const command = installInfo?.live_example || installInfo?.install_command;
    if (!command) return;
    await navigator.clipboard.writeText(command);
    addToast('Install command copied', 'success');
  };

  const uploadModel = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await axios.post('/api/slicer/models/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      addToast('Model uploaded', 'success');
      await refresh();
    } catch (err) {
      addToast(err.response?.data?.detail || 'Upload failed', 'error');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const createProfile = async () => {
    setCreatingProfile(true);
    try {
      const data = JSON.parse(profileForm.data || '{}');
      await axios.post('/api/slicer/profiles', {
        name: profileForm.name,
        profile_type: profileForm.profile_type,
        engine: 'orca',
        printer_id: profileForm.printer_id || null,
        data
      });
      setProfileForm(emptyProfile);
      addToast('Slicer profile saved', 'success');
      await refresh();
    } catch (err) {
      addToast(err.response?.data?.detail || err.message || 'Profile save failed', 'error');
    } finally {
      setCreatingProfile(false);
    }
  };

  const deleteProfile = async (profile) => {
    if (!window.confirm(`Delete ${profile.name}?`)) return;
    try {
      await axios.delete(`/api/slicer/profiles/${profile.id}`);
      addToast('Profile deleted', 'success');
      await refresh();
    } catch (err) {
      addToast('Failed to delete profile', 'error');
    }
  };

  const deleteModel = async (model) => {
    if (!window.confirm(`Delete ${model.filename}?`)) return;
    try {
      await axios.delete(`/api/slicer/models/${model.id}`);
      addToast('Model deleted', 'success');
      await refresh();
    } catch (err) {
      addToast('Failed to delete model', 'error');
    }
  };

  const startJob = async () => {
    if (!jobForm.model_id || !jobForm.printer_id) {
      addToast('Select a model and printer', 'info');
      return;
    }
    setStartingJob(true);
    try {
      await axios.post('/api/slicer/jobs', {
        model_id: Number(jobForm.model_id),
        printer_id: Number(jobForm.printer_id),
        printer_profile_id: jobForm.printer_profile_id ? Number(jobForm.printer_profile_id) : null,
        filament_profile_id: jobForm.filament_profile_id ? Number(jobForm.filament_profile_id) : null,
        process_profile_id: jobForm.process_profile_id ? Number(jobForm.process_profile_id) : null
      });
      addToast('Slice job queued', 'success');
      await refresh();
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to queue slice', 'error');
    } finally {
      setStartingJob(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Slicer</h2>
          <p className="text-sm text-slate-400">Orca-first local slicing workflow</p>
        </div>
        <button onClick={() => refresh().catch(() => addToast('Refresh failed', 'error'))} className="h-10 px-4 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 flex items-center gap-2 text-sm font-bold">
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6">
        <div className="space-y-6">
          <section className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Settings2 size={18} className="text-blue-300" />
              <h3 className="font-bold">Engine</h3>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase text-slate-500">OrcaSlicer Binary Path</label>
              <input
                value={settings.orca_binary_path || ''}
                onChange={(e) => setSettings({ ...settings, orca_binary_path: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-blue-500"
                placeholder="/usr/local/bin/orca-slicer"
              />
            </div>
            <div className={`rounded-lg border px-3 py-2 text-sm flex items-center gap-2 ${health?.available ? 'border-green-500/20 bg-green-500/10 text-green-300' : 'border-orange-500/20 bg-orange-500/10 text-orange-300'}`}>
              {health?.available ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              <span className="truncate">{health?.message || 'Not checked'}</span>
            </div>
            {installInfo && !health?.available && (
              <div className="rounded-lg border border-slate-700 bg-slate-950 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase text-slate-500">Easy server install</p>
                  <button onClick={copyInstallCommand} className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-[10px] font-bold text-blue-300 hover:bg-slate-700">
                    <Copy size={12} />
                    Copy
                  </button>
                </div>
                <code className="block break-all rounded-md bg-black/40 p-2 text-[11px] text-slate-300">
                  {installInfo.live_example || installInfo.install_command}
                </code>
              </div>
            )}
            <button onClick={saveSettings} disabled={savingSettings} className="w-full h-10 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 text-sm font-bold">
              {savingSettings ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save Engine
            </button>
          </section>

          <section className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Upload size={18} className="text-purple-300" />
                <h3 className="font-bold">Models</h3>
              </div>
              <label className="h-9 px-3 rounded-lg bg-purple-600 hover:bg-purple-700 flex items-center gap-2 text-xs font-bold cursor-pointer">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Upload
                <input type="file" accept=".stl,.3mf" className="hidden" onChange={uploadModel} />
              </label>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {models.map(model => (
                <div key={model.id} className="rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{model.filename}</p>
                    <p className="text-[10px] text-slate-500 uppercase">{model.source_format} · {Math.round((model.size || 0) / 1024)} KB</p>
                  </div>
                  <button onClick={() => deleteModel(model)} className="p-2 rounded-lg text-red-300 hover:bg-red-500/10">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {models.length === 0 && <p className="text-sm text-slate-500">No models uploaded yet.</p>}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-5">
            <div className="flex items-center gap-2">
              <Scissors size={18} className="text-green-300" />
              <h3 className="font-bold">Slice Job</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <select value={jobForm.model_id} onChange={(e) => setJobForm({ ...jobForm, model_id: e.target.value })} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Model</option>
                {models.map(model => <option key={model.id} value={model.id}>{model.filename}</option>)}
              </select>
              <select value={jobForm.printer_id} onChange={(e) => setJobForm({ ...jobForm, printer_id: e.target.value })} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Printer</option>
                {printers.map(printer => <option key={printer.id} value={printer.id}>{printer.name}</option>)}
              </select>
              <select value={jobForm.printer_profile_id} onChange={(e) => setJobForm({ ...jobForm, printer_profile_id: e.target.value })} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Printer profile</option>
                {groupedProfiles.printer.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <select value={jobForm.filament_profile_id} onChange={(e) => setJobForm({ ...jobForm, filament_profile_id: e.target.value })} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Material profile</option>
                {groupedProfiles.filament.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <select value={jobForm.process_profile_id} onChange={(e) => setJobForm({ ...jobForm, process_profile_id: e.target.value })} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Process profile</option>
                {groupedProfiles.process.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <button onClick={startJob} disabled={startingJob} className="h-10 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2 text-sm font-bold">
                {startingJob ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                Slice
              </button>
            </div>
          </section>

          <section className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ClipboardList size={18} className="text-blue-300" />
              <h3 className="font-bold">Jobs</h3>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {jobs.map(job => (
                <div key={job.id} className="rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-sm">Job #{job.id}</p>
                      <p className="text-xs text-slate-500 truncate">{job.output_path || job.message || 'Waiting'}</p>
                    </div>
                    <span className={`px-2 py-1 rounded-full border text-[10px] font-bold uppercase ${statusTone(job.status)}`}>{job.status}</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] text-slate-400 uppercase font-bold">
                    <span>Printer #{job.printer_id}</span>
                    <span>Model #{job.model_id}</span>
                    <span>{job.estimated_time || 'Time n/a'}</span>
                    <span>{job.filament_used_mm ? `${Math.round(job.filament_used_mm)} mm` : 'Filament n/a'}</span>
                  </div>
                </div>
              ))}
              {jobs.length === 0 && <p className="text-sm text-slate-500">No slicer jobs yet.</p>}
            </div>
          </section>
        </div>
      </div>

      <section className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Box size={18} className="text-orange-300" />
          <h3 className="font-bold">Profiles</h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-5">
          <div className="space-y-3">
            <input value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} placeholder="Profile name" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <select value={profileForm.profile_type} onChange={(e) => setProfileForm({ ...profileForm, profile_type: e.target.value })} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
                <option value="printer">Printer</option>
                <option value="filament">Material</option>
                <option value="process">Process</option>
              </select>
              <select value={profileForm.printer_id} onChange={(e) => setProfileForm({ ...profileForm, printer_id: e.target.value })} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Global</option>
                {printers.map(printer => <option key={printer.id} value={printer.id}>{printer.name}</option>)}
              </select>
            </div>
            <textarea value={profileForm.data} onChange={(e) => setProfileForm({ ...profileForm, data: e.target.value })} rows={8} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono" />
            <button onClick={createProfile} disabled={creatingProfile || !profileForm.name.trim()} className="w-full h-10 rounded-lg bg-orange-600 hover:bg-orange-700 disabled:opacity-50 flex items-center justify-center gap-2 text-sm font-bold">
              {creatingProfile ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Add Profile
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {['printer', 'filament', 'process'].map(type => (
              <div key={type} className="rounded-xl border border-slate-700 bg-slate-900/40 p-3 space-y-2 min-h-44">
                <p className="text-xs font-bold uppercase text-slate-500">{type === 'filament' ? 'Material' : type}</p>
                {groupedProfiles[type].map(profile => (
                  <div key={profile.id} className="rounded-lg bg-slate-950/70 border border-slate-700 px-3 py-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold truncate">{profile.name}</span>
                    <button onClick={() => deleteProfile(profile)} className="p-1.5 rounded-md text-red-300 hover:bg-red-500/10">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Slicer;
