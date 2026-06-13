import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import {
  Box,
  CheckCircle2,
  ClipboardList,
  Copy,
  Cpu,
  FileBox,
  Gauge,
  Layers3,
  Loader2,
  Move3D,
  Package,
  Play,
  Plus,
  RefreshCw,
  Save,
  Scissors,
  Settings2,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import ModelBuildPlateViewer from '../components/ModelBuildPlateViewer';

const emptyProfile = {
  name: '',
  profile_type: 'printer',
  printer_id: '',
  config_file: '',
  extra_args: '',
};

const statusTone = (status) => {
  if (status === 'completed') return 'text-green-300 bg-green-500/10 border-green-500/20';
  if (status === 'failed') return 'text-red-300 bg-red-500/10 border-red-500/20';
  if (status === 'running') return 'text-blue-300 bg-blue-500/10 border-blue-500/20';
  if (status === 'cancelled') return 'text-slate-300 bg-slate-500/10 border-slate-500/20';
  return 'text-orange-300 bg-orange-500/10 border-orange-500/20';
};

const formatBytes = (value) => {
  const size = Number(value) || 0;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
};

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
};

const profileTypeLabel = (type) => {
  if (type === 'filament') return 'Material';
  if (type === 'process') return 'Process';
  return 'Printer';
};

const profileSummary = (profile) => {
  const args = Array.isArray(profile?.data?.extra_args) ? profile.data.extra_args : [];
  if (profile?.data?.config_file) return profile.data.config_file;
  if (args.length) return `${args.length} Orca argument${args.length === 1 ? '' : 's'}`;
  return 'No overrides';
};

const Slicer = ({ addToast }) => {
  const [printers, setPrinters] = useState([]);
  const [settings, setSettings] = useState({ orca_binary_path: '' });
  const [health, setHealth] = useState(null);
  const [models, setModels] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [spools, setSpools] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [installInfo, setInstallInfo] = useState(null);
  const [profileForm, setProfileForm] = useState(emptyProfile);
  const [jobForm, setJobForm] = useState({
    model_id: '',
    printer_id: '',
    printer_profile_id: '',
    filament_profile_id: '',
    process_profile_id: '',
    filament_spool_id: '',
    centre_on_bed: true,
    slice_for_all_printers: false,
  });
  const [viewPreset, setViewPreset] = useState('iso');
  const [uploading, setUploading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [startingJob, setStartingJob] = useState(false);

  const refresh = useCallback(async () => {
    const [printerRes, settingsRes, healthRes, modelRes, profileRes, spoolRes, jobRes, installRes] = await Promise.all([
      axios.get('/api/printers'),
      axios.get('/api/slicer/settings'),
      axios.get('/api/slicer/health'),
      axios.get('/api/slicer/models'),
      axios.get('/api/slicer/profiles'),
      axios.get('/api/filaments/spools'),
      axios.get('/api/slicer/jobs'),
      axios.get('/api/slicer/install-info'),
    ]);
    setPrinters(printerRes.data || []);
    setSettings(settingsRes.data || { orca_binary_path: '' });
    setHealth(healthRes.data || null);
    setModels(modelRes.data || []);
    setProfiles(profileRes.data || []);
    setSpools(spoolRes.data || []);
    setJobs(jobRes.data || []);
    setInstallInfo(installRes.data || null);
  }, []);

  useEffect(() => {
    refresh().catch(() => addToast('Failed to load slicer state', 'error'));
    const interval = setInterval(() => {
      axios.get('/api/slicer/jobs').then((res) => setJobs(res.data || [])).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [addToast, refresh]);

  useEffect(() => {
    setJobForm((current) => ({
      ...current,
      model_id: current.model_id && models.some((model) => String(model.id) === String(current.model_id))
        ? current.model_id
        : String(models[0]?.id || ''),
      printer_id: current.printer_id && printers.some((printer) => String(printer.id) === String(current.printer_id))
        ? current.printer_id
        : String(printers[0]?.id || ''),
    }));
  }, [models, printers]);

  useEffect(() => {
    setJobForm((current) => {
      const pickProfile = (type, currentValue) => {
        if (currentValue && profiles.some((profile) => String(profile.id) === String(currentValue) && profile.profile_type === type)) {
          return currentValue;
        }
        const printerScoped = profiles.find((profile) => (
          profile.profile_type === type
          && profile.printer_id
          && String(profile.printer_id) === String(current.printer_id)
        ));
        const globalProfile = profiles.find((profile) => profile.profile_type === type && !profile.printer_id);
        const anyProfile = profiles.find((profile) => profile.profile_type === type);
        return String((printerScoped || globalProfile || anyProfile)?.id || '');
      };

      return {
        ...current,
        printer_profile_id: pickProfile('printer', current.printer_profile_id),
        filament_profile_id: pickProfile('filament', current.filament_profile_id),
        process_profile_id: pickProfile('process', current.process_profile_id),
      };
    });
  }, [profiles, jobForm.printer_id]);

  useEffect(() => {
    setJobForm((current) => {
      if (current.filament_spool_id && spools.some((spool) => String(spool.id) === String(current.filament_spool_id))) {
        return current;
      }
      const loaded = spools.find((spool) => (
        spool.status === 'active'
        && spool.printer_id
        && String(spool.printer_id) === String(current.printer_id)
      ));
      const active = spools.find((spool) => spool.status === 'active');
      return { ...current, filament_spool_id: String((loaded || active)?.id || '') };
    });
  }, [spools, jobForm.printer_id]);

  const groupedProfiles = useMemo(() => ({
    printer: profiles.filter((profile) => profile.profile_type === 'printer'),
    filament: profiles.filter((profile) => profile.profile_type === 'filament'),
    process: profiles.filter((profile) => profile.profile_type === 'process'),
  }), [profiles]);

  const selectedModel = useMemo(
    () => models.find((model) => String(model.id) === String(jobForm.model_id)) || null,
    [jobForm.model_id, models]
  );

  const selectedPrinter = useMemo(
    () => printers.find((printer) => String(printer.id) === String(jobForm.printer_id)) || null,
    [jobForm.printer_id, printers]
  );

  const stlNeedsProfiles = selectedModel?.source_format === 'stl';
  const missingProfiles = stlNeedsProfiles && (!jobForm.printer_profile_id || !jobForm.filament_profile_id || !jobForm.process_profile_id);
  const latestJob = jobs[0] || null;
  const selectedSpool = useMemo(
    () => spools.find((spool) => String(spool.id) === String(jobForm.filament_spool_id)) || null,
    [jobForm.filament_spool_id, spools]
  );

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
      const res = await axios.post('/api/slicer/models/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      addToast('Model uploaded', 'success');
      setJobForm((current) => ({ ...current, model_id: String(res.data?.id || current.model_id) }));
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
      const extraArgs = profileForm.extra_args
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      await axios.post('/api/slicer/profiles', {
        name: profileForm.name.trim(),
        profile_type: profileForm.profile_type,
        engine: 'orca',
        printer_id: profileForm.printer_id ? Number(profileForm.printer_id) : null,
        data: {
          config_file: profileForm.config_file.trim() || null,
          extra_args: extraArgs,
        },
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
    if (missingProfiles) {
      addToast('Select printer, material and process profiles before slicing an STL model', 'info');
      return;
    }
    setStartingJob(true);
    try {
      const targetPrinterIds = jobForm.slice_for_all_printers
        ? printers.map((printer) => printer.id)
        : [Number(jobForm.printer_id)];
      const endpoint = targetPrinterIds.length > 1 ? '/api/slicer/jobs/batch' : '/api/slicer/jobs';
      const payload = {
        model_id: Number(jobForm.model_id),
        printer_profile_id: jobForm.printer_profile_id ? Number(jobForm.printer_profile_id) : null,
        filament_profile_id: jobForm.filament_profile_id ? Number(jobForm.filament_profile_id) : null,
        process_profile_id: jobForm.process_profile_id ? Number(jobForm.process_profile_id) : null,
        filament_spool_id: jobForm.filament_spool_id ? Number(jobForm.filament_spool_id) : null,
        centre_on_bed: Boolean(jobForm.centre_on_bed),
      };
      if (targetPrinterIds.length > 1) {
        payload.printer_ids = targetPrinterIds;
      } else {
        payload.printer_id = targetPrinterIds[0];
      }
      const res = await axios.post(endpoint, payload);
      const queued = Array.isArray(res.data) ? res.data.length : 1;
      addToast(`${queued} slice job${queued === 1 ? '' : 's'} queued`, 'success');
      await refresh();
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to queue slice', 'error');
    } finally {
      setStartingJob(false);
    }
  };

  const cancelJob = async (job) => {
    try {
      await axios.post(`/api/slicer/jobs/${job.id}/cancel`);
      addToast('Slice job cancelled', 'success');
      await refresh();
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to cancel job', 'error');
    }
  };

  const profileSelect = (type, value, keyName) => (
    <label className="space-y-1">
      <span className="text-[10px] font-bold uppercase text-slate-500">{profileTypeLabel(type)} profile</span>
      <select
        value={value}
        onChange={(event) => setJobForm({ ...jobForm, [keyName]: event.target.value })}
        className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm outline-none focus:border-blue-500"
      >
        <option value="">{type === 'filament' ? 'Select material' : `Select ${profileTypeLabel(type).toLowerCase()}`}</option>
        {groupedProfiles[type].map((profile) => (
          <option key={profile.id} value={profile.id}>{profile.name}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Slicer</h2>
          <p className="text-sm text-slate-400">OrcaSlicer local workspace</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold ${health?.available ? 'border-green-500/20 bg-green-500/10 text-green-300' : 'border-orange-500/20 bg-orange-500/10 text-orange-300'}`}>
            {health?.available ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            {health?.available ? 'Engine ready' : 'Engine unavailable'}
          </span>
          <button onClick={() => refresh().catch(() => addToast('Refresh failed', 'error'))} className="h-10 px-4 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 flex items-center gap-2 text-sm font-bold">
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileBox size={18} className="text-blue-300" />
                <h3 className="font-bold">Models</h3>
              </div>
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-bold hover:bg-blue-700">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Upload
                <input type="file" accept=".stl,.3mf" className="hidden" onChange={uploadModel} />
              </label>
            </div>
            <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
              {models.map((model) => {
                const selected = String(model.id) === String(jobForm.model_id);
                return (
                  <div
                    key={model.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setJobForm({ ...jobForm, model_id: String(model.id) })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        setJobForm({ ...jobForm, model_id: String(model.id) });
                      }
                    }}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${selected ? 'border-blue-500/50 bg-blue-500/10' : 'border-slate-700 bg-slate-900/60 hover:border-slate-500'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-100">{model.filename}</p>
                        <p className="mt-1 text-[10px] font-bold uppercase text-slate-500">
                          {(model.source_format || 'model').toUpperCase()} | {formatBytes(model.size)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteModel(model);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.stopPropagation();
                            deleteModel(model);
                          }
                        }}
                        className="rounded-md p-1.5 text-red-300 hover:bg-red-500/10"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {models.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/50 p-5 text-center text-sm font-semibold text-slate-500">
                  No models uploaded
                </div>
              )}
            </div>
          </section>
        </aside>

        <main className="space-y-4">
          <section className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Box size={18} className="text-cyan-300" />
                  <h3 className="font-bold">Build Plate</h3>
                </div>
                <p className="mt-1 truncate text-sm text-slate-400">{selectedModel?.filename || 'No model selected'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {[
                  ['iso', 'Iso'],
                  ['top', 'Top'],
                  ['front', 'Front'],
                  ['side', 'Side'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setViewPreset(value)}
                    className={`h-8 rounded-lg border px-3 text-[10px] font-bold uppercase ${viewPreset === value ? 'border-blue-500/40 bg-blue-500/15 text-blue-200' : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <ModelBuildPlateViewer model={selectedModel} printer={selectedPrinter} viewPreset={viewPreset} />
          </section>
        </main>

        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <div className="mb-4 flex items-center gap-2">
              <Scissors size={18} className="text-green-300" />
              <h3 className="font-bold">Slice Setup</h3>
            </div>
            <div className="space-y-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-500">Printer</span>
                <select
                  value={jobForm.printer_id}
                  onChange={(event) => setJobForm({ ...jobForm, printer_id: event.target.value })}
                  className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm outline-none focus:border-blue-500"
                >
                  <option value="">Select printer</option>
                  {printers.map((printer) => (
                    <option key={printer.id} value={printer.id}>{printer.name}</option>
                  ))}
                </select>
              </label>
              {profileSelect('printer', jobForm.printer_profile_id, 'printer_profile_id')}
              {profileSelect('filament', jobForm.filament_profile_id, 'filament_profile_id')}
              {profileSelect('process', jobForm.process_profile_id, 'process_profile_id')}
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-500">Filament spool</span>
                <select
                  value={jobForm.filament_spool_id}
                  onChange={(event) => setJobForm({ ...jobForm, filament_spool_id: event.target.value })}
                  className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm outline-none focus:border-blue-500"
                >
                  <option value="">No spool tracking</option>
                  {spools.filter((spool) => spool.status === 'active').map((spool) => (
                    <option key={spool.id} value={spool.id}>
                      {spool.name} - {Math.round(spool.remaining_weight_g)}g left
                    </option>
                  ))}
                </select>
              </label>
              {selectedSpool && (
                <div className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2">
                  <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-bold uppercase text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Package size={12} />
                      {selectedSpool.material}
                    </span>
                    <span>{Math.round(selectedSpool.remaining_weight_g)}g / {Math.round(selectedSpool.initial_weight_g)}g</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full ${selectedSpool.remaining_percent < 15 ? 'bg-red-400' : selectedSpool.remaining_percent < 30 ? 'bg-orange-400' : 'bg-green-400'}`}
                      style={{ width: `${Math.max(0, Math.min(100, selectedSpool.remaining_percent))}%` }}
                    />
                  </div>
                </div>
              )}
              <label className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 ${jobForm.centre_on_bed ? 'border-blue-500/30 bg-blue-500/10' : 'border-slate-700 bg-slate-950/70'}`}>
                <input
                  type="checkbox"
                  checked={jobForm.centre_on_bed}
                  onChange={(event) => setJobForm({ ...jobForm, centre_on_bed: event.target.checked })}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold text-slate-200">Centre on bed</span>
                  <span className="mt-0.5 block text-[10px] font-semibold uppercase text-slate-500">Arrange and keep inside build volume</span>
                </span>
              </label>
              <label className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 ${jobForm.slice_for_all_printers ? 'border-cyan-500/30 bg-cyan-500/10' : 'border-slate-700 bg-slate-950/70'}`}>
                <input
                  type="checkbox"
                  checked={jobForm.slice_for_all_printers}
                  onChange={(event) => setJobForm({ ...jobForm, slice_for_all_printers: event.target.checked })}
                  disabled={printers.length < 2}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 disabled:opacity-40"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold text-slate-200">One variant per printer</span>
                  <span className="mt-0.5 block text-[10px] font-semibold uppercase text-slate-500">
                    {printers.length < 2 ? 'Add more printers to enable batch slicing' : 'Grouped as one item in G-code Hub'}
                  </span>
                </span>
              </label>
              {missingProfiles && (
                <div className="rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-xs font-semibold text-orange-200">
                  STL models need a printer, material and process profile.
                </div>
              )}
              <button
                onClick={startJob}
                disabled={startingJob || !health?.available || !selectedModel || !selectedPrinter || missingProfiles}
                className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-green-600 text-sm font-bold hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {startingJob ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                Slice
              </button>
              <Link to="/gcode" className="flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 text-sm font-bold text-slate-300 hover:bg-slate-700">
                <Layers3 size={16} />
                G-code Hub
              </Link>
            </div>
          </section>

          <section className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ClipboardList size={18} className="text-purple-300" />
                <h3 className="font-bold">Recent Jobs</h3>
              </div>
              {latestJob && <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${statusTone(latestJob.status)}`}>{latestJob.status}</span>}
            </div>
            <div className="space-y-2 max-h-[390px] overflow-y-auto pr-1">
              {jobs.map((job) => {
                const model = models.find((item) => item.id === job.model_id);
                const printer = printers.find((item) => item.id === job.printer_id);
                return (
                  <div key={job.id} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">#{job.id} {model?.filename || `Model ${job.model_id}`}</p>
                        <p className="mt-1 truncate text-xs text-slate-500">{printer?.name || `Printer ${job.printer_id}`}</p>
                      </div>
                      <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${statusTone(job.status)}`}>{job.status}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-bold uppercase text-slate-500">
                      <span>{job.estimated_time || 'Time n/a'}</span>
                      <span>{job.filament_used_mm ? `${Math.round(job.filament_used_mm)} mm` : 'Filament n/a'}</span>
                    </div>
                    {job.message && <p className="mt-2 line-clamp-2 text-xs text-slate-400">{job.message}</p>}
                    {(job.status === 'queued' || job.status === 'running') && (
                      <button onClick={() => cancelJob(job)} className="mt-3 h-8 w-full rounded-lg border border-red-500/20 bg-red-500/10 text-xs font-bold text-red-300 hover:bg-red-500/15">
                        Cancel
                      </button>
                    )}
                  </div>
                );
              })}
              {jobs.length === 0 && <p className="text-sm text-slate-500">No slicer jobs yet.</p>}
            </div>
          </section>
        </aside>
      </div>

      <details className="rounded-lg border border-slate-700 bg-slate-800">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-center gap-2 font-bold">
            <Settings2 size={18} className="text-blue-300" />
            Engine and Profiles
          </span>
          <span className="text-xs font-bold uppercase text-slate-500">Advanced</span>
        </summary>
        <div className="grid grid-cols-1 gap-4 border-t border-slate-700 p-4 xl:grid-cols-[360px_1fr]">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Cpu size={17} className="text-blue-300" />
              <h3 className="font-bold">Engine</h3>
            </div>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-slate-500">OrcaSlicer binary path</span>
              <input
                value={settings.orca_binary_path || ''}
                onChange={(event) => setSettings({ ...settings, orca_binary_path: event.target.value })}
                className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 font-mono text-sm outline-none focus:border-blue-500"
                placeholder="/usr/local/bin/orca-slicer"
              />
            </label>
            <div className={`rounded-lg border px-3 py-2 text-sm ${health?.available ? 'border-green-500/20 bg-green-500/10 text-green-300' : 'border-orange-500/20 bg-orange-500/10 text-orange-300'}`}>
              {health?.message || 'Not checked'}
            </div>
            {installInfo && !health?.available && (
              <div className="rounded-lg border border-slate-700 bg-slate-950 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase text-slate-500">Server install</p>
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
            <button onClick={saveSettings} disabled={savingSettings} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
              {savingSettings ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save Engine
            </button>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Gauge size={17} className="text-orange-300" />
              <h3 className="font-bold">Profiles</h3>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
              <div className="space-y-3">
                <input
                  value={profileForm.name}
                  onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })}
                  placeholder="Profile name"
                  className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm outline-none focus:border-blue-500"
                />
                <div className="grid grid-cols-2 gap-3">
                  <select value={profileForm.profile_type} onChange={(event) => setProfileForm({ ...profileForm, profile_type: event.target.value })} className="h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm">
                    <option value="printer">Printer</option>
                    <option value="filament">Material</option>
                    <option value="process">Process</option>
                  </select>
                  <select value={profileForm.printer_id} onChange={(event) => setProfileForm({ ...profileForm, printer_id: event.target.value })} className="h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm">
                    <option value="">Global</option>
                    {printers.map((printer) => <option key={printer.id} value={printer.id}>{printer.name}</option>)}
                  </select>
                </div>
                <input
                  value={profileForm.config_file}
                  onChange={(event) => setProfileForm({ ...profileForm, config_file: event.target.value })}
                  placeholder="Orca config file path"
                  className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm outline-none focus:border-blue-500"
                />
                <textarea
                  value={profileForm.extra_args}
                  onChange={(event) => setProfileForm({ ...profileForm, extra_args: event.target.value })}
                  rows={4}
                  placeholder="Extra Orca arguments"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono outline-none focus:border-blue-500"
                />
                <button onClick={createProfile} disabled={creatingProfile || !profileForm.name.trim()} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-orange-600 text-sm font-bold hover:bg-orange-700 disabled:opacity-50">
                  {creatingProfile ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Add Profile
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {['printer', 'filament', 'process'].map((type) => (
                  <div key={type} className="min-h-44 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                    <p className="mb-2 text-xs font-bold uppercase text-slate-500">{profileTypeLabel(type)}</p>
                    <div className="space-y-2">
                      {groupedProfiles[type].map((profile) => (
                        <div key={profile.id} className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{profile.name}</p>
                              <p className="truncate text-[10px] uppercase text-slate-500">{profileSummary(profile)}</p>
                            </div>
                            <button onClick={() => deleteProfile(profile)} className="rounded-md p-1.5 text-red-300 hover:bg-red-500/10">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                      {groupedProfiles[type].length === 0 && <p className="text-xs text-slate-600">No profiles</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </details>

      {selectedModel && selectedPrinter && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[10px] font-bold uppercase text-slate-500">
          <Move3D size={13} />
          <span>{selectedModel.filename}</span>
          <span>|</span>
          <span>{selectedPrinter.name}</span>
          {formatDate(selectedModel.created_at) && (
            <>
              <span>|</span>
              <span>{formatDate(selectedModel.created_at)}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default Slicer;
