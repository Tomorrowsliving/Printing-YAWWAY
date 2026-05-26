import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileCode2, Puzzle, RefreshCw, Save, Settings, SlidersHorizontal, Wrench } from 'lucide-react';
import { printerService } from '../services/api';

const DEFAULT_BED_PROBE = {
  enabled: true,
  probe_type: 'bltouch',
  sensor_pin: '^PB1',
  control_pin: 'PB0',
  x_offset: -44,
  y_offset: -6,
  z_offset: 0,
  probe_speed: 5,
  lift_speed: 5,
  samples: 2,
  sample_retract_dist: 2,
  use_probe_for_z_homing: true,
  safe_z_home_x: 82.5,
  safe_z_home_y: 82.5,
  safe_z_home_speed: 50,
  z_hop: 10,
  z_hop_speed: 5,
  mesh_min_x: 20,
  mesh_min_y: 20,
  mesh_max_x: 145,
  mesh_max_y: 145,
  mesh_speed: 120,
  horizontal_move_z: 5,
  probe_count_x: 5,
  probe_count_y: 5,
};

const DEFAULT_FORM = {
  probe_preset_id: 'creality-42x-probe-port',
  mesh_preset_id: 'ender-small-bed',
  bed_probe: DEFAULT_BED_PROBE,
  plugins: [],
  replace_existing: true,
  restart_services: true,
};

const numberFields = new Set([
  'x_offset',
  'y_offset',
  'z_offset',
  'probe_speed',
  'lift_speed',
  'samples',
  'sample_retract_dist',
  'safe_z_home_x',
  'safe_z_home_y',
  'safe_z_home_speed',
  'z_hop',
  'z_hop_speed',
  'mesh_min_x',
  'mesh_min_y',
  'mesh_max_x',
  'mesh_max_y',
  'mesh_speed',
  'horizontal_move_z',
  'probe_count_x',
  'probe_count_y',
]);

const fieldLabel = {
  sensor_pin: 'Sensor Pin',
  control_pin: 'Control Pin',
  x_offset: 'X Offset',
  y_offset: 'Y Offset',
  z_offset: 'Z Offset',
  safe_z_home_x: 'Safe Home X',
  safe_z_home_y: 'Safe Home Y',
  mesh_min_x: 'Mesh Min X',
  mesh_min_y: 'Mesh Min Y',
  mesh_max_x: 'Mesh Max X',
  mesh_max_y: 'Mesh Max Y',
  probe_count_x: 'Probe Count X',
  probe_count_y: 'Probe Count Y',
};

const ConfigField = ({ name, value, onChange, type = 'text' }) => (
  <label className="block">
    <span className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-slate-500">{fieldLabel[name] || name}</span>
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(name, event.target.value)}
      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100 outline-none transition-colors focus:border-blue-500"
    />
  </label>
);

const ConfigCheckbox = ({ checked, label, onChange }) => (
  <label className="flex min-h-10 items-center gap-3 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-300">
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500"
    />
    <span>{label}</span>
  </label>
);

const ConfigHelperCard = ({ printer, addToast, fetchPrinter, fetchRuntime, cardClass }) => {
  const [presets, setPresets] = useState({ probe_pin_presets: [], mesh_presets: [], plugin_presets: [] });
  const [form, setForm] = useState(DEFAULT_FORM);
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    printerService.getConfigHelperPresets()
      .then((res) => {
        if (!mounted) return;
        setPresets(res.data);
      })
      .catch((err) => {
        addToast(err.response?.data?.detail || 'Failed to load config presets', 'error');
      });
    return () => {
      mounted = false;
    };
  }, [addToast]);

  const selectedProbePreset = useMemo(
    () => presets.probe_pin_presets.find((preset) => preset.id === form.probe_preset_id),
    [form.probe_preset_id, presets.probe_pin_presets]
  );

  const selectedMeshPreset = useMemo(
    () => presets.mesh_presets.find((preset) => preset.id === form.mesh_preset_id),
    [form.mesh_preset_id, presets.mesh_presets]
  );

  const selectedPluginLabels = useMemo(
    () => presets.plugin_presets
      .filter((plugin) => form.plugins.includes(plugin.id))
      .map((plugin) => plugin.label),
    [form.plugins, presets.plugin_presets]
  );

  const updateBedProbe = (name, value) => {
    setForm((current) => ({
      ...current,
      bed_probe: {
        ...current.bed_probe,
        [name]: numberFields.has(name) && value !== '' ? Number(value) : value,
      },
    }));
    setPreview(null);
  };

  const updateFlag = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }));
    setPreview(null);
  };

  const applyProbePreset = (presetId) => {
    const preset = presets.probe_pin_presets.find((item) => item.id === presetId);
    setForm((current) => ({
      ...current,
      probe_preset_id: presetId,
      bed_probe: preset ? {
        ...current.bed_probe,
        probe_type: preset.probe_type,
        sensor_pin: preset.sensor_pin,
        control_pin: preset.control_pin,
        x_offset: preset.x_offset,
        y_offset: preset.y_offset,
        z_offset: preset.z_offset,
      } : current.bed_probe,
    }));
    setPreview(null);
  };

  const applyMeshPreset = (presetId) => {
    const preset = presets.mesh_presets.find((item) => item.id === presetId);
    setForm((current) => ({
      ...current,
      mesh_preset_id: presetId,
      bed_probe: preset ? {
        ...current.bed_probe,
        safe_z_home_x: preset.safe_z_home_x,
        safe_z_home_y: preset.safe_z_home_y,
        mesh_min_x: preset.mesh_min_x,
        mesh_min_y: preset.mesh_min_y,
        mesh_max_x: preset.mesh_max_x,
        mesh_max_y: preset.mesh_max_y,
        probe_count_x: preset.probe_count_x,
        probe_count_y: preset.probe_count_y,
      } : current.bed_probe,
    }));
    setPreview(null);
  };

  const togglePlugin = (pluginId, checked) => {
    setForm((current) => ({
      ...current,
      plugins: checked
        ? [...new Set([...current.plugins, pluginId])]
        : current.plugins.filter((id) => id !== pluginId),
    }));
    setPreview(null);
  };

  const payload = () => ({
    bed_probe: form.bed_probe.enabled ? form.bed_probe : null,
    plugins: form.plugins,
    replace_existing: form.replace_existing,
    restart_services: form.restart_services,
  });

  const runHelper = async (mode) => {
    if (!form.bed_probe.enabled && form.plugins.length === 0) {
      addToast('Select a bed probe or plugin option first', 'info');
      return;
    }

    if (mode === 'apply' && !window.confirm('Apply these Klipper config changes and create a backup first?')) {
      return;
    }

    setBusy(mode);
    try {
      const res = mode === 'preview'
        ? await printerService.previewConfigHelper(printer.id, payload())
        : await printerService.applyConfigHelper(printer.id, payload());
      setPreview(res.data);
      addToast(res.data?.message || (mode === 'preview' ? 'Preview ready' : 'Config updated'), mode === 'preview' ? 'info' : 'success');
      if (mode === 'apply') {
        await fetchPrinter();
        await fetchRuntime();
      }
    } catch (err) {
      addToast(err.response?.data?.detail || 'Config helper failed', 'error');
    } finally {
      setBusy('');
    }
  };

  const probeDisabled = !form.bed_probe.enabled;

  return (
    <div className={`${cardClass} flex flex-col overflow-hidden p-5`}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-700 pb-3">
        <div className="flex items-center space-x-2">
          <SlidersHorizontal size={18} className="text-blue-400" />
          <h3 className="font-bold text-sm">Config Helper</h3>
        </div>
        <button
          onClick={() => setSettingsOpen((value) => !value)}
          className="inline-flex items-center space-x-2 rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-300 transition-colors hover:text-blue-300"
        >
          <Settings size={14} />
          <span>Settings</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4 pr-1">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Probe</p>
            <p className="mt-1 text-sm font-bold text-slate-100">{form.bed_probe.enabled ? (selectedProbePreset?.label || 'Custom probe') : 'Disabled'}</p>
            <p className="mt-1 font-mono text-[11px] text-blue-300">{form.bed_probe.sensor_pin}{form.bed_probe.control_pin ? ` / ${form.bed_probe.control_pin}` : ''}</p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Mesh</p>
            <p className="mt-1 text-sm font-bold text-slate-100">{selectedMeshPreset?.label || 'Custom mesh'}</p>
            <p className="mt-1 font-mono text-[11px] text-green-300">{form.bed_probe.mesh_min_x},{form.bed_probe.mesh_min_y} - {form.bed_probe.mesh_max_x},{form.bed_probe.mesh_max_y}</p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
          <div className="mb-2 flex items-center space-x-2">
            <Puzzle size={14} className="text-purple-400" />
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Klipper Plugins</p>
          </div>
          <p className="text-xs font-semibold text-slate-300">{selectedPluginLabels.length ? selectedPluginLabels.join(', ') : 'None selected'}</p>
        </div>

        {settingsOpen && (
          <div className="space-y-4 rounded-lg border border-slate-700 bg-slate-900 p-3">
            <ConfigCheckbox
              checked={form.bed_probe.enabled}
              label="Bed Mesh Probe"
              onChange={(checked) => updateBedProbe('enabled', checked)}
            />

            <div className={probeDisabled ? 'pointer-events-none opacity-40' : 'space-y-4'}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-slate-500">Probe Pins</span>
                  <select
                    value={form.probe_preset_id}
                    onChange={(event) => applyProbePreset(event.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100 outline-none focus:border-blue-500"
                  >
                    {presets.probe_pin_presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-slate-500">Bed Size</span>
                  <select
                    value={form.mesh_preset_id}
                    onChange={(event) => applyMeshPreset(event.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100 outline-none focus:border-blue-500"
                  >
                    {presets.mesh_presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-slate-500">Probe Type</span>
                  <select
                    value={form.bed_probe.probe_type}
                    onChange={(event) => updateBedProbe('probe_type', event.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100 outline-none focus:border-blue-500"
                  >
                    <option value="bltouch">BLTouch / CR Touch</option>
                    <option value="probe">Generic Probe</option>
                  </select>
                </label>
                <ConfigField name="sensor_pin" value={form.bed_probe.sensor_pin} onChange={updateBedProbe} />
                <ConfigField name="control_pin" value={form.bed_probe.control_pin} onChange={updateBedProbe} />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <ConfigField type="number" name="x_offset" value={form.bed_probe.x_offset} onChange={updateBedProbe} />
                <ConfigField type="number" name="y_offset" value={form.bed_probe.y_offset} onChange={updateBedProbe} />
                <ConfigField type="number" name="z_offset" value={form.bed_probe.z_offset} onChange={updateBedProbe} />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <ConfigField type="number" name="safe_z_home_x" value={form.bed_probe.safe_z_home_x} onChange={updateBedProbe} />
                <ConfigField type="number" name="safe_z_home_y" value={form.bed_probe.safe_z_home_y} onChange={updateBedProbe} />
                <ConfigField type="number" name="mesh_min_x" value={form.bed_probe.mesh_min_x} onChange={updateBedProbe} />
                <ConfigField type="number" name="mesh_min_y" value={form.bed_probe.mesh_min_y} onChange={updateBedProbe} />
                <ConfigField type="number" name="mesh_max_x" value={form.bed_probe.mesh_max_x} onChange={updateBedProbe} />
                <ConfigField type="number" name="mesh_max_y" value={form.bed_probe.mesh_max_y} onChange={updateBedProbe} />
                <ConfigField type="number" name="probe_count_x" value={form.bed_probe.probe_count_x} onChange={updateBedProbe} />
                <ConfigField type="number" name="probe_count_y" value={form.bed_probe.probe_count_y} onChange={updateBedProbe} />
              </div>

              <ConfigCheckbox
                checked={form.bed_probe.use_probe_for_z_homing}
                label="Use probe for Z homing"
                onChange={(checked) => updateBedProbe('use_probe_for_z_homing', checked)}
              />
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {presets.plugin_presets.map((plugin) => (
                <ConfigCheckbox
                  key={plugin.id}
                  checked={form.plugins.includes(plugin.id)}
                  label={plugin.label}
                  onChange={(checked) => togglePlugin(plugin.id, checked)}
                />
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ConfigCheckbox
                checked={form.replace_existing}
                label="Replace matching sections"
                onChange={(checked) => updateFlag('replace_existing', checked)}
              />
              <ConfigCheckbox
                checked={form.restart_services}
                label="Restart Klipper after apply"
                onChange={(checked) => updateFlag('restart_services', checked)}
              />
            </div>
          </div>
        )}

        {preview && (
          <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-900 p-3">
            <div className="flex items-center space-x-2 text-green-300">
              <CheckCircle2 size={16} />
              <p className="text-xs font-bold">{preview.changed ? 'Config changes ready' : 'No config changes needed'}</p>
            </div>
            {preview.changes?.length > 0 && (
              <ul className="space-y-1 text-xs text-slate-300">
                {preview.changes.map((change, index) => <li key={index}>{change}</li>)}
              </ul>
            )}
            {preview.warnings?.length > 0 && (
              <ul className="space-y-1 text-xs text-amber-200">
                {preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
              </ul>
            )}
            {preview.snippet && (
              <details className="rounded-lg border border-slate-700 bg-slate-950 p-3">
                <summary className="cursor-pointer text-xs font-bold text-blue-300">Generated snippet</summary>
                <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-300">{preview.snippet}</pre>
              </details>
            )}
          </div>
        )}

        <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 text-[11px] leading-relaxed text-orange-100">
          <div className="mb-1 flex items-center space-x-2 font-bold">
            <Wrench size={14} />
            <span>Check wiring and offsets before homing Z.</span>
          </div>
          Probe pins and Z offsets are hardware-specific, so the helper always backs up the config before applying changes.
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-700 pt-4">
        <button
          onClick={() => runHelper('preview')}
          disabled={Boolean(busy)}
          className="inline-flex items-center space-x-2 rounded-lg bg-slate-700 px-4 py-2 text-xs font-bold text-slate-200 transition-colors hover:bg-slate-600 disabled:cursor-wait disabled:opacity-60"
        >
          {busy === 'preview' ? <RefreshCw size={15} className="animate-spin" /> : <FileCode2 size={15} />}
          <span>Preview</span>
        </button>
        <button
          onClick={() => runHelper('apply')}
          disabled={Boolean(busy)}
          className="inline-flex items-center space-x-2 rounded-lg bg-green-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-green-500 disabled:cursor-wait disabled:opacity-60"
        >
          {busy === 'apply' ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
          <span>Apply</span>
        </button>
      </div>
    </div>
  );
};

export default ConfigHelperCard;
