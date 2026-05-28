import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Crosshair,
  FileCode2,
  Home,
  Info,
  Map,
  Minus,
  Plus,
  PlugZap,
  Puzzle,
  RefreshCw,
  Ruler,
  Save,
  Settings,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react';
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
  probe_speed: 'Probe Speed',
  lift_speed: 'Lift Speed',
  samples: 'Samples',
  sample_retract_dist: 'Sample Retract',
  safe_z_home_x: 'Safe Home X',
  safe_z_home_y: 'Safe Home Y',
  safe_z_home_speed: 'Safe Home Speed',
  z_hop: 'Z Hop',
  z_hop_speed: 'Z Hop Speed',
  mesh_min_x: 'Mesh Min X',
  mesh_min_y: 'Mesh Min Y',
  mesh_max_x: 'Mesh Max X',
  mesh_max_y: 'Mesh Max Y',
  mesh_speed: 'Mesh Speed',
  horizontal_move_z: 'Move Z',
  probe_count_x: 'Probe Count X',
  probe_count_y: 'Probe Count Y',
};

const BED_PREVIEW_SIZES = {
  'ender-small-bed': { width: 165, height: 165, label: '165 x 165 mm' },
  'ender-235-bed': { width: 235, height: 235, label: '235 x 235 mm' },
};

const PLUGIN_DETAILS = {
  exclude_object: {
    label: 'Exclude Object',
    description: 'Enables object cancellation for slicers that emit object metadata.',
  },
  respond: {
    label: 'Respond',
    description: 'Allows macros to send messages back to the console and UI.',
  },
  gcode_arcs: {
    label: 'G-code Arcs',
    description: 'Adds G2/G3 arc support for smoother curved motion.',
  },
  firmware_retraction: {
    label: 'Firmware Retraction',
    description: 'Moves retraction settings into firmware-controlled Klipper config.',
  },
};

const selectClass = 'w-full rounded-lg border border-slate-700/80 bg-slate-950/80 px-3 py-2 text-sm font-semibold text-slate-100 outline-none transition-colors hover:border-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));

const roundConfigNumber = (value, digits = 1) => Number(Number(value).toFixed(digits));

const formatNumber = (value, digits = 2) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  const text = number.toFixed(digits);
  return digits > 0 ? (text.replace(/\.?0+$/, '') || '0') : text;
};

const apiErrorMessage = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail?.message) return detail.message;
  return fallback;
};

const getBedSize = (bedProbe, selectedMeshPreset) => {
  const presetSize = BED_PREVIEW_SIZES[selectedMeshPreset?.id];
  if (presetSize) return presetSize;

  const width = Math.max(
    120,
    toNumber(bedProbe.mesh_max_x, 0),
    toNumber(bedProbe.safe_z_home_x, 0),
    toNumber(bedProbe.mesh_min_x, 0)
  ) + 20;
  const height = Math.max(
    120,
    toNumber(bedProbe.mesh_max_y, 0),
    toNumber(bedProbe.safe_z_home_y, 0),
    toNumber(bedProbe.mesh_min_y, 0)
  ) + 20;
  return { width, height, label: `${formatNumber(width, 0)} x ${formatNumber(height, 0)} mm` };
};

const buildValidationIssues = (bedProbe, selectedMeshPreset) => {
  if (!bedProbe.enabled) return [];

  const issues = [];
  const bed = getBedSize(bedProbe, selectedMeshPreset);
  const values = {
    x_offset: toNumber(bedProbe.x_offset),
    y_offset: toNumber(bedProbe.y_offset),
    z_offset: toNumber(bedProbe.z_offset),
    safe_z_home_x: toNumber(bedProbe.safe_z_home_x),
    safe_z_home_y: toNumber(bedProbe.safe_z_home_y),
    mesh_min_x: toNumber(bedProbe.mesh_min_x),
    mesh_min_y: toNumber(bedProbe.mesh_min_y),
    mesh_max_x: toNumber(bedProbe.mesh_max_x),
    mesh_max_y: toNumber(bedProbe.mesh_max_y),
    probe_count_x: toNumber(bedProbe.probe_count_x),
    probe_count_y: toNumber(bedProbe.probe_count_y),
    horizontal_move_z: toNumber(bedProbe.horizontal_move_z),
    z_hop: toNumber(bedProbe.z_hop),
  };

  const addIssue = (severity, message, fields = []) => {
    issues.push({ severity, message, fields });
  };

  if (!String(bedProbe.sensor_pin || '').trim()) {
    addIssue('error', 'Sensor pin is required for the probe.', ['sensor_pin']);
  }

  if (bedProbe.probe_type === 'bltouch' && !String(bedProbe.control_pin || '').trim()) {
    addIssue('error', 'BLTouch / CR Touch requires a control pin.', ['control_pin']);
  }

  if (values.mesh_min_x >= values.mesh_max_x) {
    addIssue('error', 'Mesh Min X must be lower than Mesh Max X.', ['mesh_min_x', 'mesh_max_x']);
  }

  if (values.mesh_min_y >= values.mesh_max_y) {
    addIssue('error', 'Mesh Min Y must be lower than Mesh Max Y.', ['mesh_min_y', 'mesh_max_y']);
  }

  if (values.mesh_min_x < 0 || values.mesh_min_y < 0 || values.mesh_max_x > bed.width || values.mesh_max_y > bed.height) {
    addIssue('warning', `Mesh area is outside the selected bed size (${bed.label}).`, ['mesh_min_x', 'mesh_min_y', 'mesh_max_x', 'mesh_max_y']);
  }

  if (values.safe_z_home_x < 0 || values.safe_z_home_y < 0 || values.safe_z_home_x > bed.width || values.safe_z_home_y > bed.height) {
    addIssue('error', 'Safe home position is outside the selected bed area.', ['safe_z_home_x', 'safe_z_home_y']);
  }

  const safeProbe = {
    x: values.safe_z_home_x + values.x_offset,
    y: values.safe_z_home_y + values.y_offset,
  };
  if (safeProbe.x < 0 || safeProbe.x > bed.width || safeProbe.y < 0 || safeProbe.y > bed.height) {
    addIssue('warning', 'The probe position at safe home is outside the selected bed area.', ['safe_z_home_x', 'safe_z_home_y', 'x_offset', 'y_offset']);
  }

  if (values.probe_count_x < 2 || values.probe_count_x > 15) {
    addIssue('error', 'Probe Count X must be between 2 and 15.', ['probe_count_x']);
  }

  if (values.probe_count_y < 2 || values.probe_count_y > 15) {
    addIssue('error', 'Probe Count Y must be between 2 and 15.', ['probe_count_y']);
  }

  if (Math.abs(values.x_offset) > 80 || Math.abs(values.y_offset) > 80) {
    addIssue('warning', 'Probe XY offset looks unusually large. Check the probe mount measurement.', ['x_offset', 'y_offset']);
  }

  if (Math.abs(values.z_offset) > 5) {
    addIssue('warning', 'Z offset looks unusually large. Usually this is calibrated carefully after the probe is installed.', ['z_offset']);
  }

  if (values.horizontal_move_z < 1) {
    addIssue('warning', 'Move Z below 1mm can drag the nozzle or probe during mesh moves.', ['horizontal_move_z']);
  }

  if (values.z_hop < 0) {
    addIssue('error', 'Z hop cannot be negative.', ['z_hop']);
  }

  return issues;
};

const groupValidationByField = (issues) => issues.reduce((acc, issue) => {
  issue.fields.forEach((field) => {
    if (!acc[field] || issue.severity === 'error') {
      acc[field] = issue;
    }
  });
  return acc;
}, {});

const Section = ({ icon: Icon, title, description, children, aside }) => (
  <section className="space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 rounded-lg border border-slate-700/70 bg-slate-900/80 p-2 text-blue-300">
          <Icon size={16} />
        </div>
        <div>
          <h4 className="text-sm font-bold text-slate-100">{title}</h4>
          {description && <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>}
        </div>
      </div>
      {aside}
    </div>
    <div className="rounded-lg border border-slate-700/70 bg-slate-900/45 p-3 shadow-inner shadow-slate-950/20">
      {children}
    </div>
  </section>
);

const FieldHint = ({ issue }) => {
  if (!issue) return null;
  const tone = issue.severity === 'error' ? 'text-red-300' : 'text-amber-300';
  return <p className={`mt-1 text-[11px] leading-snug ${tone}`}>{issue.message}</p>;
};

const TextField = ({ name, value, onChange, issue, placeholder }) => {
  const invalid = issue?.severity === 'error';
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-slate-500">{fieldLabel[name] || name}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(name, event.target.value)}
        className={`w-full rounded-lg border bg-slate-950/80 px-3 py-2 text-sm font-semibold text-slate-100 outline-none transition-colors placeholder:text-slate-700 focus:ring-2 ${invalid ? 'border-red-500/60 focus:border-red-400 focus:ring-red-500/20' : 'border-slate-700/80 hover:border-slate-600 focus:border-blue-500 focus:ring-blue-500/20'}`}
      />
      <FieldHint issue={issue} />
    </label>
  );
};

const NumberGrid = ({ children, className = '' }) => (
  <div className={`grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3 ${className}`}>
    {children}
  </div>
);

const NumberControl = ({
  label,
  name,
  value,
  onChange,
  onNudge,
  step = 1,
  unit = 'mm',
  issue,
  compact = false,
}) => {
  const invalid = issue?.severity === 'error';
  const warning = issue?.severity === 'warning';
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-slate-500">{label || fieldLabel[name] || name}</span>
      <div className={`grid min-w-0 grid-cols-[2rem_minmax(5.25rem,1fr)_auto_2rem] overflow-hidden rounded-lg border bg-slate-950/80 transition-colors ${invalid ? 'border-red-500/60' : warning ? 'border-amber-500/50' : 'border-slate-700/80 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 hover:border-slate-600'}`}>
        {onNudge && (
          <button
            type="button"
            onClick={() => onNudge(name, -step)}
            className="flex min-w-0 items-center justify-center border-r border-slate-700/70 text-slate-400 transition-colors hover:bg-slate-800 hover:text-blue-300"
            title={`Decrease ${label || fieldLabel[name] || name}`}
          >
            <Minus size={compact ? 12 : 14} />
          </button>
        )}
        <input
          type="number"
          step={step}
          value={value}
          onChange={(event) => onChange(name, event.target.value)}
          className="min-w-0 bg-transparent px-2 py-2 text-center font-mono text-sm font-bold text-slate-100 outline-none"
        />
        <span className="flex min-w-10 items-center justify-center whitespace-nowrap border-l border-slate-700/60 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">{unit}</span>
        {onNudge && (
          <button
            type="button"
            onClick={() => onNudge(name, step)}
            className="flex min-w-0 items-center justify-center border-l border-slate-700/70 text-slate-400 transition-colors hover:bg-slate-800 hover:text-blue-300"
            title={`Increase ${label || fieldLabel[name] || name}`}
          >
            <Plus size={compact ? 12 : 14} />
          </button>
        )}
      </div>
      <FieldHint issue={issue} />
    </label>
  );
};

const SwitchRow = ({ checked, label, description, onChange, disabled = false }) => (
  <button
    type="button"
    onClick={() => !disabled && onChange(!checked)}
    disabled={disabled}
    className={`flex w-full items-center justify-between gap-4 rounded-lg border px-3 py-3 text-left transition-colors ${checked ? 'border-blue-500/40 bg-blue-500/10 text-slate-100' : 'border-slate-700/80 bg-slate-950/60 text-slate-300 hover:border-slate-600 hover:bg-slate-900/70'} disabled:cursor-not-allowed disabled:opacity-50`}
  >
    <span>
      <span className="block text-xs font-bold">{label}</span>
      {description && <span className="mt-1 block text-[11px] leading-snug text-slate-500">{description}</span>}
    </span>
    <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-blue-500' : 'bg-slate-700'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </span>
  </button>
);

const SummaryTile = ({ icon: Icon, label, value, detail, tone = 'blue', issue }) => {
  const toneClass = {
    blue: 'border-blue-500/25 bg-blue-500/10 text-blue-300',
    green: 'border-green-500/25 bg-green-500/10 text-green-300',
    purple: 'border-purple-500/25 bg-purple-500/10 text-purple-300',
    amber: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    red: 'border-red-500/25 bg-red-500/10 text-red-300',
  }[issue?.severity === 'error' ? 'red' : issue?.severity === 'warning' ? 'amber' : tone];

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon size={15} />
          <p className="text-[9px] font-bold uppercase tracking-widest opacity-80">{label}</p>
        </div>
        {issue ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
      </div>
      <p className="text-sm font-bold text-slate-100">{value}</p>
      {detail && <p className="mt-1 min-h-4 truncate font-mono text-[11px] text-slate-400">{detail}</p>}
    </div>
  );
};

const ValidationSummary = ({ issues }) => {
  if (!issues.length) {
    return (
      <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs font-semibold text-green-200">
        Config checks look good.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
      <div className="flex items-center gap-2 text-xs font-bold text-amber-200">
        <AlertTriangle size={15} />
        <span>{issues.some((issue) => issue.severity === 'error') ? 'Fix required before apply' : 'Review before apply'}</span>
      </div>
      <ul className="space-y-1 text-[11px] leading-relaxed text-amber-100">
        {issues.slice(0, 4).map((issue, index) => (
          <li key={`${issue.message}-${index}`}>{issue.message}</li>
        ))}
      </ul>
    </div>
  );
};

const MeshVisualPreview = ({ bedProbe, selectedMeshPreset, issues, onBedProbeChange }) => {
  const svgRef = useRef(null);
  const [dragState, setDragState] = useState(null);
  const bed = getBedSize(bedProbe, selectedMeshPreset);
  const pad = 26;
  const size = 248;
  const mapX = (value) => pad + (toNumber(value) / bed.width) * size;
  const mapY = (value) => pad + size - (toNumber(value) / bed.height) * size;
  const safeX = toNumber(bedProbe.safe_z_home_x);
  const safeY = toNumber(bedProbe.safe_z_home_y);
  const probeAtHomeX = safeX + toNumber(bedProbe.x_offset);
  const probeAtHomeY = safeY + toNumber(bedProbe.y_offset);
  const meshMinX = toNumber(bedProbe.mesh_min_x);
  const meshMinY = toNumber(bedProbe.mesh_min_y);
  const meshMaxX = toNumber(bedProbe.mesh_max_x);
  const meshMaxY = toNumber(bedProbe.mesh_max_y);
  const meshLeft = mapX(Math.min(meshMinX, meshMaxX));
  const meshRight = mapX(Math.max(meshMinX, meshMaxX));
  const meshTop = mapY(Math.max(meshMinY, meshMaxY));
  const meshBottom = mapY(Math.min(meshMinY, meshMaxY));
  const countX = clampNumber(Math.round(toNumber(bedProbe.probe_count_x, 5)), 2, 15);
  const countY = clampNumber(Math.round(toNumber(bedProbe.probe_count_y, 5)), 2, 15);
  const points = [];

  for (let y = 0; y < countY; y += 1) {
    for (let x = 0; x < countX; x += 1) {
      const px = countX === 1 ? meshMinX : meshMinX + ((meshMaxX - meshMinX) * x) / (countX - 1);
      const py = countY === 1 ? meshMinY : meshMinY + ((meshMaxY - meshMinY) * y) / (countY - 1);
      points.push({ x: mapX(px), y: mapY(py) });
    }
  }

  const safePoint = {
    x: clampNumber(mapX(safeX), pad, pad + size),
    y: clampNumber(mapY(safeY), pad, pad + size),
  };
  const probePoint = {
    x: clampNumber(mapX(probeAtHomeX), pad, pad + size),
    y: clampNumber(mapY(probeAtHomeY), pad, pad + size),
  };
  const hasSeriousIssue = issues.some((issue) => issue.severity === 'error');
  const probeReachIssue = issues.find((issue) => issue.message.includes('Probe offset makes the probe miss'));

  const pointFromEvent = (event) => {
    if (!svgRef.current) return null;
    const svgPoint = svgRef.current.createSVGPoint();
    svgPoint.x = event.clientX;
    svgPoint.y = event.clientY;
    const point = svgPoint.matrixTransform(svgRef.current.getScreenCTM().inverse());
    return {
      x: clampNumber(((point.x - pad) / size) * bed.width, 0, bed.width),
      y: clampNumber(((pad + size - point.y) / size) * bed.height, 0, bed.height),
    };
  };

  const applyDrag = (updates) => {
    if (!onBedProbeChange) return;
    onBedProbeChange(Object.entries(updates).reduce((acc, [key, value]) => ({
      ...acc,
      [key]: roundConfigNumber(value, key === 'x_offset' || key === 'y_offset' ? 2 : 1),
    }), {}));
  };

  const beginDrag = (target, event) => {
    if (!onBedProbeChange) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragState({
      target,
      start: point,
      initial: {
        mesh_min_x: meshMinX,
        mesh_min_y: meshMinY,
        mesh_max_x: meshMaxX,
        mesh_max_y: meshMaxY,
        safe_z_home_x: safeX,
        safe_z_home_y: safeY,
        x_offset: toNumber(bedProbe.x_offset),
        y_offset: toNumber(bedProbe.y_offset),
      },
    });
  };

  const handleDrag = (event) => {
    if (!dragState) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    const dx = point.x - dragState.start.x;
    const dy = point.y - dragState.start.y;
    const initial = dragState.initial;

    if (dragState.target === 'mesh') {
      const meshWidth = Math.max(1, initial.mesh_max_x - initial.mesh_min_x);
      const meshHeight = Math.max(1, initial.mesh_max_y - initial.mesh_min_y);
      const nextMinX = clampNumber(initial.mesh_min_x + dx, 0, Math.max(0, bed.width - meshWidth));
      const nextMinY = clampNumber(initial.mesh_min_y + dy, 0, Math.max(0, bed.height - meshHeight));
      applyDrag({
        mesh_min_x: nextMinX,
        mesh_max_x: nextMinX + meshWidth,
        mesh_min_y: nextMinY,
        mesh_max_y: nextMinY + meshHeight,
      });
      return;
    }

    if (dragState.target === 'mesh-min') {
      applyDrag({
        mesh_min_x: clampNumber(point.x, 0, initial.mesh_max_x - 1),
        mesh_min_y: clampNumber(point.y, 0, initial.mesh_max_y - 1),
      });
      return;
    }

    if (dragState.target === 'mesh-max') {
      applyDrag({
        mesh_max_x: clampNumber(point.x, initial.mesh_min_x + 1, bed.width),
        mesh_max_y: clampNumber(point.y, initial.mesh_min_y + 1, bed.height),
      });
      return;
    }

    if (dragState.target === 'safe-home') {
      applyDrag({
        safe_z_home_x: point.x,
        safe_z_home_y: point.y,
      });
      return;
    }

    if (dragState.target === 'probe-offset') {
      applyDrag({
        x_offset: point.x - safeX,
        y_offset: point.y - safeY,
      });
    }
  };

  const stopDrag = (event) => {
    if (!dragState) return;
    setDragState(null);
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-700/70 bg-slate-900/45 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-100">Bed Mesh Preview</p>
          <p className="mt-1 text-xs text-slate-500">{bed.label} selected bed, live from current values</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${hasSeriousIssue ? 'bg-red-500/15 text-red-300' : 'bg-green-500/10 text-green-300'}`}>
          {hasSeriousIssue ? 'Check' : 'Valid'}
        </span>
      </div>

      {probeReachIssue && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold leading-relaxed text-amber-100">
          {probeReachIssue.message}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700/60 bg-slate-950/50 px-3 py-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Drag mode</div>
        <div className="rounded-md bg-blue-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-300">Config only</div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-700/70 bg-slate-950/60">
        <svg
          ref={svgRef}
          viewBox="0 0 300 300"
          className="block h-auto w-full touch-none select-none"
          onPointerMove={handleDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onPointerLeave={stopDrag}
        >
          <defs>
            <pattern id="mesh-grid" width="16" height="16" patternUnits="userSpaceOnUse">
              <path d="M 16 0 L 0 0 0 16" fill="none" stroke="#1e293b" strokeWidth="1" />
            </pattern>
          </defs>
          <rect x={pad} y={pad} width={size} height={size} rx="8" fill="#0f172a" stroke="#334155" strokeWidth="2" />
          <rect x={pad} y={pad} width={size} height={size} rx="8" fill="url(#mesh-grid)" opacity="0.7" />
          <rect
            x={meshLeft}
            y={meshTop}
            width={Math.max(0, meshRight - meshLeft)}
            height={Math.max(0, meshBottom - meshTop)}
            rx="5"
            fill="#0ea5e9"
            opacity="0.14"
            stroke="#38bdf8"
            strokeWidth="2"
            className={onBedProbeChange ? 'cursor-grab active:cursor-grabbing' : ''}
            onPointerDown={(event) => beginDrag('mesh', event)}
          />
          {points.map((point, index) => (
            <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r="2.6" fill="#7dd3fc" opacity="0.95" />
          ))}
          <line x1={safePoint.x} y1={safePoint.y} x2={probePoint.x} y2={probePoint.y} stroke="#a78bfa" strokeWidth="2" strokeDasharray="5 5" />
          <circle
            cx={meshLeft}
            cy={meshBottom}
            r="6"
            fill="#0f172a"
            stroke="#38bdf8"
            strokeWidth="2.5"
            className={onBedProbeChange ? 'cursor-nwse-resize' : ''}
            onPointerDown={(event) => beginDrag('mesh-min', event)}
          />
          <circle
            cx={meshRight}
            cy={meshTop}
            r="6"
            fill="#0f172a"
            stroke="#38bdf8"
            strokeWidth="2.5"
            className={onBedProbeChange ? 'cursor-nwse-resize' : ''}
            onPointerDown={(event) => beginDrag('mesh-max', event)}
          />
          <circle
            cx={safePoint.x}
            cy={safePoint.y}
            r="8"
            fill="#2563eb"
            stroke="#bfdbfe"
            strokeWidth="2"
            className={onBedProbeChange ? 'cursor-grab active:cursor-grabbing' : ''}
            onPointerDown={(event) => beginDrag('safe-home', event)}
          />
          <circle
            cx={probePoint.x}
            cy={probePoint.y}
            r="7"
            fill="#06b6d4"
            stroke="#cffafe"
            strokeWidth="2"
            className={onBedProbeChange ? 'cursor-grab active:cursor-grabbing' : ''}
            onPointerDown={(event) => beginDrag('probe-offset', event)}
          />
          <text x={pad} y="18" fill="#94a3b8" fontSize="9" fontWeight="700">Y+</text>
          <text x="270" y="292" fill="#94a3b8" fontSize="9" fontWeight="700">X+</text>
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
        <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-sky-300" /> Probe points</div>
        <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-blue-500" /> Safe home/nozzle</div>
        <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-cyan-500" /> Probe at home</div>
        <div className="flex items-center gap-2"><span className="h-2 w-5 rounded-sm border border-sky-300/70 bg-sky-400/20" /> Mesh area</div>
      </div>
    </div>
  );
};

const PluginToggle = ({ plugin, checked, onChange }) => {
  const details = PLUGIN_DETAILS[plugin.id] || plugin;
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex min-h-24 items-start gap-3 rounded-lg border p-3 text-left transition-colors ${checked ? 'border-purple-500/40 bg-purple-500/10' : 'border-slate-700/80 bg-slate-950/60 hover:border-slate-600 hover:bg-slate-900/70'}`}
    >
      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${checked ? 'border-purple-400/40 bg-purple-500/20 text-purple-200' : 'border-slate-700 bg-slate-900 text-slate-500'}`}>
        <Puzzle size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-slate-100">{details.label}</span>
          <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-purple-500' : 'bg-slate-700'}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </span>
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-slate-500">{details.description}</span>
      </span>
    </button>
  );
};

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
      .map((plugin) => (PLUGIN_DETAILS[plugin.id]?.label || plugin.label)),
    [form.plugins, presets.plugin_presets]
  );

  const validationIssues = useMemo(
    () => buildValidationIssues(form.bed_probe, selectedMeshPreset),
    [form.bed_probe, selectedMeshPreset]
  );
  const validationByField = useMemo(() => groupValidationByField(validationIssues), [validationIssues]);
  const hasBlockingValidation = validationIssues.some((issue) => issue.severity === 'error');

  const probePresetChanged = useMemo(() => {
    if (!selectedProbePreset) return false;
    return ['probe_type', 'sensor_pin', 'control_pin'].some((field) => selectedProbePreset[field] !== form.bed_probe[field])
      || ['x_offset', 'y_offset', 'z_offset'].some((field) => Number(selectedProbePreset[field]) !== Number(form.bed_probe[field]));
  }, [form.bed_probe, selectedProbePreset]);

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

  const updateBedProbeValues = (updates) => {
    setForm((current) => ({
      ...current,
      bed_probe: {
        ...current.bed_probe,
        ...updates,
      },
    }));
    setPreview(null);
  };

  const nudgeBedProbeNumber = (name, amount) => {
    setForm((current) => {
      const currentValue = Number(current.bed_probe[name]);
      const nextValue = Number.isFinite(currentValue) ? currentValue + amount : amount;
      return {
        ...current,
        bed_probe: {
          ...current.bed_probe,
          [name]: Number(nextValue.toFixed(3)),
        },
      };
    });
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

  const fitMeshToProbeReach = () => {
    const bed = getBedSize(form.bed_probe, selectedMeshPreset);
    const margin = 5;
    const reachMinX = clampNumber(margin, 0, bed.width - 1);
    const reachMaxX = clampNumber(bed.width - margin, reachMinX + 1, bed.width);
    const reachMinY = clampNumber(margin, 0, bed.height - 1);
    const reachMaxY = clampNumber(bed.height - margin, reachMinY + 1, bed.height);
    const nextMinX = clampNumber(toNumber(form.bed_probe.mesh_min_x), reachMinX, reachMaxX - 1);
    const nextMinY = clampNumber(toNumber(form.bed_probe.mesh_min_y), reachMinY, reachMaxY - 1);

    updateBedProbeValues({
      mesh_min_x: roundConfigNumber(nextMinX, 1),
      mesh_min_y: roundConfigNumber(nextMinY, 1),
      mesh_max_x: roundConfigNumber(clampNumber(toNumber(form.bed_probe.mesh_max_x), nextMinX + 1, reachMaxX), 1),
      mesh_max_y: roundConfigNumber(clampNumber(toNumber(form.bed_probe.mesh_max_y), nextMinY + 1, reachMaxY), 1),
    });
  };

  const runProbeReachFinder = async () => {
    if (!form.bed_probe.enabled) {
      addToast('Enable the bed probe before finding probe reach', 'info');
      return;
    }

    if (hasBlockingValidation) {
      setSettingsOpen(true);
      addToast('Fix config validation errors before moving the printer', 'error');
      return;
    }

    const confirmed = window.confirm(
      'Run probe reach finder now?\n\nThis will physically move X/Y/Z, retract before each attempt, and probe the mesh corners. Home X/Y/Z first and keep a hand near power.'
    );
    if (!confirmed) return;

    const bed = getBedSize(form.bed_probe, selectedMeshPreset);
    setBusy('probe-reach');
    try {
      const res = await printerService.findProbeReach(printer.id, {
        bed_probe: form.bed_probe,
        bed_width: bed.width,
        bed_height: bed.height,
        margin_mm: 5,
        step_mm: 10,
        max_attempts: 20,
      });
      const suggested = res.data?.suggested_bed_probe;
      if (suggested) updateBedProbeValues(suggested);
      setPreview({
        changed: true,
        changes: [
          `Mesh min: ${formatNumber(suggested?.mesh_min_x, 1)}, ${formatNumber(suggested?.mesh_min_y, 1)}`,
          `Mesh max: ${formatNumber(suggested?.mesh_max_x, 1)}, ${formatNumber(suggested?.mesh_max_y, 1)}`,
          `${res.data?.successful_edges?.length || 0} edges confirmed`,
        ],
        warnings: [],
        snippet: (res.data?.attempts || [])
          .map((attempt) => `${attempt.edge || attempt.corner} #${attempt.attempt}: ${attempt.status} nozzle ${attempt.nozzle_x},${attempt.nozzle_y} probe ${attempt.probe_x},${attempt.probe_y}`)
          .join('\n'),
      });
      addToast(res.data?.message || 'Probe reach finder completed', 'success');
      await fetchRuntime();
    } catch (err) {
      addToast(apiErrorMessage(err, 'Probe reach finder failed'), 'error');
    } finally {
      setBusy('');
    }
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

    if (mode === 'apply' && hasBlockingValidation) {
      setSettingsOpen(true);
      addToast('Fix config validation errors before applying', 'error');
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
  const probeSummary = form.bed_probe.enabled
    ? `${selectedProbePreset?.label || 'Custom probe'}${probePresetChanged ? ' + custom' : ''}`
    : 'Disabled';
  const offsetSummary = `X ${formatNumber(form.bed_probe.x_offset)} / Y ${formatNumber(form.bed_probe.y_offset)} / Z ${formatNumber(form.bed_probe.z_offset)}`;
  const meshSummary = `${formatNumber(form.bed_probe.mesh_min_x, 0)},${formatNumber(form.bed_probe.mesh_min_y, 0)} -> ${formatNumber(form.bed_probe.mesh_max_x, 0)},${formatNumber(form.bed_probe.mesh_max_y, 0)}`;
  const pluginSummary = selectedPluginLabels.length ? selectedPluginLabels.join(', ') : 'None selected';
  const seriousIssue = validationIssues.find((issue) => issue.severity === 'error');
  const warningIssue = validationIssues.find((issue) => issue.severity === 'warning');

  return (
    <div className={`${cardClass} flex flex-col overflow-hidden bg-slate-800/95 p-5`}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-700/70 pb-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-2 text-blue-300">
            <SlidersHorizontal size={18} />
          </div>
          <div>
            <h3 className="font-bold text-base text-slate-100">Config Helper</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">Probe, mesh, homing, and Klipper feature sections generated from guided controls.</p>
          </div>
        </div>
        <button
          onClick={() => setSettingsOpen((value) => !value)}
          className={`inline-flex items-center space-x-2 rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${settingsOpen ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'bg-slate-900 text-slate-300 hover:text-blue-300'}`}
        >
          <Settings size={14} />
          <span>{settingsOpen ? 'Close' : 'Settings'}</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto py-5 pr-1">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          <SummaryTile
            icon={Crosshair}
            label="Probe Pins"
            value={probeSummary}
            detail={`${form.bed_probe.sensor_pin || '--'}${form.bed_probe.control_pin ? ` / ${form.bed_probe.control_pin}` : ''}`}
            tone="blue"
            issue={validationByField.sensor_pin || validationByField.control_pin}
          />
          <SummaryTile
            icon={Ruler}
            label="Offset"
            value="Probe to nozzle"
            detail={offsetSummary}
            tone="purple"
            issue={validationByField.x_offset || validationByField.y_offset || validationByField.z_offset}
          />
          <SummaryTile
            icon={Map}
            label="Mesh Area"
            value={selectedMeshPreset?.label || 'Custom mesh'}
            detail={meshSummary}
            tone="green"
            issue={validationByField.mesh_min_x || validationByField.mesh_min_y || validationByField.mesh_max_x || validationByField.mesh_max_y}
          />
          <SummaryTile
            icon={PlugZap}
            label="Plugins"
            value={`${form.plugins.length} selected`}
            detail={pluginSummary}
            tone="amber"
          />
        </div>

        {settingsOpen ? (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
            <div className={probeDisabled ? 'space-y-5 opacity-70' : 'space-y-5'}>
              <Section
                icon={Crosshair}
                title="Probe Hardware"
                description="Select the probe wiring profile, then adjust pins or probe type only if your board differs."
                aside={(
                  <SwitchRow
                    checked={form.bed_probe.enabled}
                    label="Bed Mesh Probe"
                    onChange={(checked) => updateBedProbe('enabled', checked)}
                  />
                )}
              >
                <div className={probeDisabled ? 'pointer-events-none opacity-40' : 'grid grid-cols-1 gap-3 lg:grid-cols-3'}>
                  <label className="block lg:col-span-1">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-slate-500">Probe Pins</span>
                    <select
                      value={form.probe_preset_id}
                      onChange={(event) => applyProbePreset(event.target.value)}
                      className={selectClass}
                    >
                      {presets.probe_pin_presets.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-slate-500">Probe Type</span>
                    <select
                      value={form.bed_probe.probe_type}
                      onChange={(event) => updateBedProbe('probe_type', event.target.value)}
                      className={selectClass}
                    >
                      <option value="bltouch">BLTouch / CR Touch</option>
                      <option value="probe">Generic Probe</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-3">
                    <TextField name="sensor_pin" value={form.bed_probe.sensor_pin} onChange={updateBedProbe} issue={validationByField.sensor_pin} />
                    <TextField name="control_pin" value={form.bed_probe.control_pin} onChange={updateBedProbe} issue={validationByField.control_pin} />
                  </div>
                </div>
              </Section>

              <Section
                icon={Ruler}
                title="Probe Offsets"
                description="Measure probe location relative to the nozzle. Z is usually calibrated carefully after the probe is mounted."
              >
                <div className={probeDisabled ? 'pointer-events-none opacity-40' : 'space-y-3'}>
                  <NumberGrid>
                    <NumberControl label="X Offset" name="x_offset" value={form.bed_probe.x_offset} onChange={updateBedProbe} onNudge={nudgeBedProbeNumber} step={1} issue={validationByField.x_offset} compact />
                    <NumberControl label="Y Offset" name="y_offset" value={form.bed_probe.y_offset} onChange={updateBedProbe} onNudge={nudgeBedProbeNumber} step={1} issue={validationByField.y_offset} compact />
                    <NumberControl label="Z Offset" name="z_offset" value={form.bed_probe.z_offset} onChange={updateBedProbe} onNudge={nudgeBedProbeNumber} step={0.01} issue={validationByField.z_offset} compact />
                  </NumberGrid>
                  <div className="rounded-lg border border-slate-700/60 bg-slate-950/50 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
                    Positive X/Y means the probe is to the right/back of the nozzle. Negative X/Y means left/front.
                  </div>
                </div>
              </Section>

              <Section
                icon={Home}
                title="Homing"
                description="Set where XY moves before probing Z and whether Klipper should use the probe as the Z endstop."
              >
                <div className={probeDisabled ? 'pointer-events-none opacity-40' : 'space-y-3'}>
                  <NumberGrid>
                    <NumberControl name="safe_z_home_x" value={form.bed_probe.safe_z_home_x} onChange={updateBedProbe} onNudge={nudgeBedProbeNumber} step={1} issue={validationByField.safe_z_home_x} compact />
                    <NumberControl name="safe_z_home_y" value={form.bed_probe.safe_z_home_y} onChange={updateBedProbe} onNudge={nudgeBedProbeNumber} step={1} issue={validationByField.safe_z_home_y} compact />
                    <NumberControl name="z_hop" value={form.bed_probe.z_hop} onChange={updateBedProbe} onNudge={nudgeBedProbeNumber} step={1} issue={validationByField.z_hop} compact />
                    <NumberControl name="z_hop_speed" value={form.bed_probe.z_hop_speed} onChange={updateBedProbe} onNudge={nudgeBedProbeNumber} step={1} unit="mm/s" compact />
                  </NumberGrid>
                  <SwitchRow
                    checked={form.bed_probe.use_probe_for_z_homing}
                    label="Use probe for Z homing"
                    description="Sets stepper_z endstop_pin to probe:z_virtual_endstop and comments position_endstop."
                    onChange={(checked) => updateBedProbe('use_probe_for_z_homing', checked)}
                  />
                </div>
              </Section>

              <Section
                icon={Map}
                title="Mesh Area"
                description="Define the reachable probing rectangle, grid density, and travel height."
                aside={(
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={fitMeshToProbeReach}
                      disabled={Boolean(busy)}
                      className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Fit Probe Reach
                    </button>
                    <button
                      type="button"
                      onClick={runProbeReachFinder}
                      disabled={Boolean(busy)}
                      className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-wait disabled:opacity-50"
                    >
                      {busy === 'probe-reach' ? <RefreshCw size={13} className="animate-spin" /> : <Crosshair size={13} />}
                      <span>Probe Find Reach</span>
                    </button>
                  </div>
                )}
              >
                <div className={probeDisabled ? 'pointer-events-none opacity-40' : 'space-y-3'}>
                  <label className="block">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-slate-500">Bed Size</span>
                    <select
                      value={form.mesh_preset_id}
                      onChange={(event) => applyMeshPreset(event.target.value)}
                      className={selectClass}
                    >
                      {presets.mesh_presets.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.label}</option>
                      ))}
                    </select>
                  </label>
                  <NumberGrid>
                    <NumberControl name="mesh_min_x" value={form.bed_probe.mesh_min_x} onChange={updateBedProbe} onNudge={nudgeBedProbeNumber} step={1} issue={validationByField.mesh_min_x} compact />
                    <NumberControl name="mesh_min_y" value={form.bed_probe.mesh_min_y} onChange={updateBedProbe} onNudge={nudgeBedProbeNumber} step={1} issue={validationByField.mesh_min_y} compact />
                    <NumberControl name="mesh_max_x" value={form.bed_probe.mesh_max_x} onChange={updateBedProbe} onNudge={nudgeBedProbeNumber} step={1} issue={validationByField.mesh_max_x} compact />
                    <NumberControl name="mesh_max_y" value={form.bed_probe.mesh_max_y} onChange={updateBedProbe} onNudge={nudgeBedProbeNumber} step={1} issue={validationByField.mesh_max_y} compact />
                    <NumberControl name="probe_count_x" value={form.bed_probe.probe_count_x} onChange={updateBedProbe} onNudge={nudgeBedProbeNumber} step={1} unit="pts" issue={validationByField.probe_count_x} compact />
                    <NumberControl name="probe_count_y" value={form.bed_probe.probe_count_y} onChange={updateBedProbe} onNudge={nudgeBedProbeNumber} step={1} unit="pts" issue={validationByField.probe_count_y} compact />
                    <NumberControl name="mesh_speed" value={form.bed_probe.mesh_speed} onChange={updateBedProbe} onNudge={nudgeBedProbeNumber} step={5} unit="mm/s" compact />
                    <NumberControl name="horizontal_move_z" value={form.bed_probe.horizontal_move_z} onChange={updateBedProbe} onNudge={nudgeBedProbeNumber} step={0.5} issue={validationByField.horizontal_move_z} compact />
                  </NumberGrid>
                </div>
              </Section>

              <Section
                icon={PlugZap}
                title="Klipper Plugins"
                description="Optional config sections for common Mainsail and slicer workflows."
              >
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {presets.plugin_presets.map((plugin) => (
                    <PluginToggle
                      key={plugin.id}
                      plugin={plugin}
                      checked={form.plugins.includes(plugin.id)}
                      onChange={(checked) => togglePlugin(plugin.id, checked)}
                    />
                  ))}
                </div>
              </Section>
            </div>

            <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
              <MeshVisualPreview bedProbe={form.bed_probe} selectedMeshPreset={selectedMeshPreset} issues={validationIssues} onBedProbeChange={updateBedProbeValues} />
              <ValidationSummary issues={validationIssues} />
            </aside>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <MeshVisualPreview bedProbe={form.bed_probe} selectedMeshPreset={selectedMeshPreset} issues={validationIssues} onBedProbeChange={updateBedProbeValues} />
            <ValidationSummary issues={validationIssues} />
          </div>
        )}

        {preview && (
          <div className="space-y-3 rounded-lg border border-slate-700/70 bg-slate-900/55 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-green-300">
                <CheckCircle2 size={16} />
                <p className="text-sm font-bold">{preview.changed ? 'Generated config preview' : 'No config changes needed'}</p>
              </div>
              <span className="rounded-full bg-slate-950/70 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {preview.changes?.length || 0} changes
              </span>
            </div>
            {preview.changes?.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {preview.changes.map((change, index) => (
                  <div key={index} className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs font-semibold text-green-100">{change}</div>
                ))}
              </div>
            )}
            {preview.warnings?.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100">
                {preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
              </ul>
            )}
            {preview.snippet && (
              <details className="overflow-hidden rounded-lg border border-slate-700/80 bg-slate-950/80" open>
                <summary className="flex cursor-pointer items-center gap-2 border-b border-slate-800 px-3 py-2 text-xs font-bold text-blue-300">
                  <Code2 size={14} />
                  Generated Klipper snippet
                </summary>
                <pre className="max-h-96 overflow-auto p-3 text-[11px] leading-relaxed text-slate-300">
                  <code>{preview.snippet}</code>
                </pre>
              </details>
            )}
          </div>
        )}

        <div className="rounded-lg border border-orange-500/25 bg-orange-500/10 p-3 text-[11px] leading-relaxed text-orange-100">
          <div className="mb-1 flex items-center space-x-2 font-bold">
            <Wrench size={14} />
            <span>Check wiring and offsets before homing Z.</span>
          </div>
          Probe pins and Z offsets are hardware-specific. The helper backs up printer.cfg before applying changes.
        </div>
      </div>

      <div className="sticky bottom-0 -mx-5 -mb-5 border-t border-slate-700/70 bg-slate-800/95 px-5 py-4 shadow-2xl shadow-slate-950/40 backdrop-blur">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <SwitchRow
              checked={form.replace_existing}
              label="Replace matching sections"
              description="Updates existing probe, mesh, and plugin sections when present."
              onChange={(checked) => updateFlag('replace_existing', checked)}
            />
            <SwitchRow
              checked={form.restart_services}
              label="Restart Klipper after apply"
              description="Restarts the printer services after writing the config."
              onChange={(checked) => updateFlag('restart_services', checked)}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasBlockingValidation && (
              <div className="flex max-w-sm items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200">
                <AlertTriangle size={15} />
                <span>{seriousIssue?.message || 'Fix validation errors before applying.'}</span>
              </div>
            )}
            {!hasBlockingValidation && warningIssue && (
              <div className="flex max-w-sm items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-100">
                <Info size={15} />
                <span>{warningIssue.message}</span>
              </div>
            )}
            <button
              onClick={() => runHelper('preview')}
              disabled={Boolean(busy)}
              className="inline-flex items-center space-x-2 rounded-lg bg-slate-700 px-4 py-2 text-xs font-bold text-slate-100 transition-colors hover:bg-slate-600 disabled:cursor-wait disabled:opacity-60"
            >
              {busy === 'preview' ? <RefreshCw size={15} className="animate-spin" /> : <FileCode2 size={15} />}
              <span>Preview</span>
            </button>
            <button
              onClick={() => runHelper('apply')}
              disabled={Boolean(busy) || hasBlockingValidation}
              className="inline-flex items-center space-x-2 rounded-lg bg-green-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-green-950/20 transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none"
            >
              {busy === 'apply' ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
              <span>Apply</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigHelperCard;
