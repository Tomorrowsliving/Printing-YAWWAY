import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Printer,
  Activity,
  FileText,
  Camera,
  ShieldAlert,
  RefreshCw,
  Power,
  Wrench,
  Navigation,
  Thermometer,
  Gauge,
  SlidersHorizontal,
  Settings,
  Eye,
  EyeOff,
  RotateCcw,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { printerService } from '../services/api';
import ConfigHelperCard from '../components/ConfigHelperCard';
import axios from 'axios';

const WIDGET_SIZE_OPTIONS = [
  { id: '1x1', label: '1x1', cols: 1, rows: 1 },
  { id: '2x1', label: '2x1', cols: 2, rows: 1 },
  { id: '1x2', label: '1x2', cols: 1, rows: 2 },
  { id: '2x2', label: '2x2', cols: 2, rows: 2 },
];

const WIDGET_SIZE_BY_ID = WIDGET_SIZE_OPTIONS.reduce((acc, size) => ({ ...acc, [size.id]: size }), {});

const WIDGETS = [
  { id: 'status', title: 'Status', defaultSize: '2x1', visible: true },
  { id: 'mainsail', title: 'Mainsail', defaultSize: '2x2', visible: true },
  { id: 'toolhead', title: 'Toolhead', defaultSize: '1x2', visible: true },
  { id: 'webcam', title: 'Webcam', defaultSize: '1x1', visible: true },
  { id: 'configuration', title: 'Configuration', defaultSize: '1x1', visible: true },
  { id: 'config-helper', title: 'Config Helper', defaultSize: '2x1', visible: true },
];

const WIDGET_BY_ID = WIDGETS.reduce((acc, widget) => ({ ...acc, [widget.id]: widget }), {});

const ORIGINAL_DEFAULT_ORDER = ['status', 'toolhead', 'mainsail', 'webcam', 'configuration'];

const defaultLayout = () => ({
  version: 3,
  widgets: WIDGETS.map((widget) => ({
    id: widget.id,
    visible: widget.visible !== false,
    size: widget.defaultSize,
  })),
});

const layoutFromOrderedItems = (items) => {
  const visibleItems = items.filter((item) => item.visible !== false && WIDGET_BY_ID[item.id]);
  const visibleIds = visibleItems.map((item) => item.id);
  const useNewDefault = visibleIds.length === ORIGINAL_DEFAULT_ORDER.length
    && visibleIds.every((widgetId, index) => widgetId === ORIGINAL_DEFAULT_ORDER[index]);

  if (useNewDefault) return defaultLayout();

  const seen = new Set();
  const widgets = [
    ...visibleItems.map((item) => ({
      id: item.id,
      visible: true,
      size: WIDGET_SIZE_BY_ID[item.size] ? item.size : WIDGET_BY_ID[item.id].defaultSize,
    })),
    ...WIDGETS
      .filter((widget) => !visibleIds.includes(widget.id))
      .map((widget) => ({ id: widget.id, visible: widget.visible !== false, size: widget.defaultSize })),
  ].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return { version: 3, widgets };
};

const normalizeLayout = (saved) => {
  const fallback = defaultLayout();
  if (!saved) return fallback;

  if (Array.isArray(saved)) {
    const known = saved
      .filter((item) => item && WIDGET_BY_ID[item.id])
      .map((item) => ({ id: item.id, visible: item.visible !== false, size: item.size }));
    const knownIds = new Set(known.map((item) => item.id));
    const missing = WIDGETS
      .filter((widget) => !knownIds.has(widget.id))
      .map((widget) => ({ id: widget.id, visible: widget.visible !== false, size: widget.defaultSize }));
    return layoutFromOrderedItems([...known, ...missing]);
  }

  if (saved.widgets && Array.isArray(saved.widgets)) {
    const seen = new Set();
    const widgets = saved.widgets
      .filter((item) => item && WIDGET_BY_ID[item.id] && !seen.has(item.id))
      .map((item) => {
        seen.add(item.id);
        return {
          id: item.id,
          visible: item.visible !== false,
          size: WIDGET_SIZE_BY_ID[item.size] ? item.size : WIDGET_BY_ID[item.id].defaultSize,
        };
      });

    WIDGETS.forEach((widget) => {
      if (!seen.has(widget.id)) {
        widgets.push({ id: widget.id, visible: widget.visible !== false, size: widget.defaultSize });
      }
    });

    return { version: 3, widgets };
  }

  if (saved.placements && typeof saved.placements === 'object') {
    const slotOrder = ['top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-middle', 'bottom-right'];
    const placed = [];
    const usedWidgets = new Set();

    slotOrder.forEach((slotId) => {
      const widgetId = saved.placements[slotId];
      if (widgetId && WIDGET_BY_ID[widgetId] && !usedWidgets.has(widgetId)) {
        placed.push({ id: widgetId, visible: true, size: WIDGET_BY_ID[widgetId].defaultSize });
        usedWidgets.add(widgetId);
      }
    });

    WIDGETS.forEach((widget) => {
      if (!usedWidgets.has(widget.id)) {
        placed.push({ id: widget.id, visible: widget.visible !== false, size: widget.defaultSize });
      }
    });

    return { version: 3, widgets: placed };
  }

  return fallback;
};

const widgetSizeClass = (sizeId) => {
  const size = WIDGET_SIZE_BY_ID[sizeId] || WIDGET_SIZE_BY_ID['1x1'];
  const colClass = size.cols === 2 ? 'printer-widget--2-cols' : '';
  const rowClass = size.rows === 2 ? 'printer-widget--2-rows' : '';
  return `${colClass} ${rowClass}`;
};

const moveWidgetItem = (widgets, widgetId, direction) => {
  const index = widgets.findIndex((widget) => widget.id === widgetId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= widgets.length) return widgets;

  const next = [...widgets];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
};

const formatNumber = (value, digits = 2) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return number.toFixed(digits);
};

const axisValue = (position, index) => formatNumber(Array.isArray(position) ? position[index] : null);

const tempText = (heater) => {
  if (!heater) return '--';
  const current = formatNumber(heater.temperature, 1);
  const target = formatNumber(heater.target, 0);
  return `${current} / ${target} C`;
};

const PrinterDetail = ({ addToast }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const settingsRequested = useMemo(() => (
    searchParams.get('panel') === 'settings' || searchParams.has('settings') || searchParams.has('settingsverify')
  ), [searchParams]);
  const [printer, setPrinter] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [loading, setLoading] = useState(true);
  const [repairingMoonraker, setRepairingMoonraker] = useState(false);
  const [homingAxis, setHomingAxis] = useState('');
  const [mainsailFrameNonce, setMainsailFrameNonce] = useState(0);
  const previousMainsailUrl = useRef('');
  const previousMainsailReady = useRef(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('panel') === 'settings' || params.has('settings') || params.has('settingsverify');
  });
  const [layout, setLayout] = useState(() => {
    try {
      return normalizeLayout(JSON.parse(window.localStorage.getItem(`printer-layout-${id}`)));
    } catch {
      return defaultLayout();
    }
  });

  const fetchPrinter = useCallback(async () => {
    try {
      const res = await printerService.getPrinterDetail(id);
      setPrinter(res.data);
    } catch (err) {
      if (err.response?.status === 404) {
        try {
          const res = await printerService.getPrinters();
          const printers = Array.isArray(res.data) ? res.data : (res.data?.value || []);
          if (printers.length === 1) {
            addToast(`Printer record changed, opening ${printers[0].name}`, "info");
            navigate(`/printers/${printers[0].id}`, { replace: true });
            return;
          }
        } catch (fallbackErr) {
          console.error("Error recovering printer route:", fallbackErr);
        }
      }
      console.error("Error fetching printer:", err);
      setPrinter(null);
    } finally {
      setLoading(false);
    }
  }, [id, navigate, addToast]);

  const fetchRuntime = useCallback(async () => {
    try {
      const res = await axios.get(`/api/printers/${id}/runtime`);
      setRuntime(res.data);
      setRuntimeError('');
    } catch (err) {
      setRuntimeError(err.response?.data?.detail || 'Runtime unavailable');
    }
  }, [id]);

  useEffect(() => {
    fetchPrinter();
    fetchRuntime();
    const printerInterval = window.setInterval(fetchPrinter, 10000);
    const runtimeInterval = window.setInterval(fetchRuntime, 3000);
    return () => {
      window.clearInterval(printerInterval);
      window.clearInterval(runtimeInterval);
    };
  }, [fetchPrinter, fetchRuntime]);

  useEffect(() => {
    try {
      setLayout(normalizeLayout(JSON.parse(window.localStorage.getItem(`printer-layout-${id}`))));
    } catch {
      setLayout(defaultLayout());
    }
  }, [id]);

  useEffect(() => {
    window.localStorage.setItem(`printer-layout-${id}`, JSON.stringify(layout));
  }, [id, layout]);

  useEffect(() => {
    if (settingsRequested) setSettingsOpen(true);
  }, [settingsRequested]);

  const handleAction = async (name) => {
    const targetMap = {
      'Restart Klipper': 'klipper',
      'Restart Moonraker': 'moonraker',
      'Firmware Restart': 'all',
      'Power Cycle': 'all'
    };

    const target = targetMap[name];
    if (!target) {
      addToast(`${name} not implemented yet`, "info");
      return;
    }

    if (!window.confirm(`Initiate ${name}?`)) return;

    try {
      await axios.post(`/api/printers/${id}/restart`, { target });
      addToast(`${name} initiated`, "success");
    } catch (err) {
      addToast(err.response?.data?.detail || "Action failed", "error");
    }
  };

  const handleRepairMoonraker = async () => {
    if (!window.confirm("Auto-fix printer config warnings and restart the affected printer services?")) return;

    setRepairingMoonraker(true);
    try {
      const res = await axios.post(`/api/printers/${id}/repair-moonraker`);
      addToast(res.data?.message || "Printer config repaired", "success");
      await fetchPrinter();
      await fetchRuntime();
    } catch (err) {
      addToast(err.response?.data?.detail || "Auto fix failed", "error");
    } finally {
      setRepairingMoonraker(false);
    }
  };

  const handleHomeAxis = async (axis) => {
    const targetAxis = String(axis || '').toUpperCase();
    if (!['X', 'Y', 'Z'].includes(targetAxis)) return;
    if (!window.confirm(`Home ${targetAxis} axis now?`)) return;

    setHomingAxis(targetAxis);
    try {
      await axios.post(`/api/printers/${id}/home`, { axis: targetAxis });
      addToast(`Homing ${targetAxis} axis`, "success");
      await fetchRuntime();
    } catch (err) {
      addToast(err.response?.data?.detail || `Failed to home ${targetAxis} axis`, "error");
    } finally {
      setHomingAxis('');
    }
  };

  const hideWidget = (widgetId) => {
    setLayout((current) => {
      const widgets = current.widgets.map((widget) => (
        widget.id === widgetId ? { ...widget, visible: false } : widget
      ));
      return { ...current, widgets };
    });
  };

  const showWidget = (widgetId) => {
    setLayout((current) => {
      const widgets = current.widgets.map((widget) => (
        widget.id === widgetId ? { ...widget, visible: true } : widget
      ));
      return { ...current, widgets };
    });
  };

  const resizeWidget = (widgetId, size) => {
    setLayout((current) => ({
      ...current,
      widgets: current.widgets.map((widget) => (
        widget.id === widgetId ? { ...widget, size: WIDGET_SIZE_BY_ID[size] ? size : widget.size } : widget
      )),
    }));
  };

  const moveWidget = (widgetId, direction) => {
    setLayout((current) => ({
      ...current,
      widgets: moveWidgetItem(current.widgets, widgetId, direction),
    }));
  };

  const resetLayout = () => {
    setLayout(defaultLayout());
  };

  const toggleSettingsPanel = () => {
    const nextOpen = !settingsOpen;
    setSettingsOpen(nextOpen);

    const nextParams = new URLSearchParams(searchParams);
    if (nextOpen) {
      nextParams.set('panel', 'settings');
    } else {
      nextParams.delete('panel');
      nextParams.delete('settings');
      nextParams.delete('settingsverify');
    }
    setSearchParams(nextParams, { replace: true });
  };

  const buildMainsailUrl = (baseUrl, printerSlug) => {
    if (!baseUrl) return null;
    try {
      const url = new URL(baseUrl);
      if (printerSlug) url.searchParams.set('printer', printerSlug);
      return url.toString();
    } catch {
      const separator = baseUrl.includes('?') ? '&' : '?';
      return printerSlug ? `${baseUrl}${separator}printer=${encodeURIComponent(printerSlug)}` : baseUrl;
    }
  };

  const nodeIp = printer?.node?.ip_address;
  const mainsailBaseUrl = printer ? (nodeIp ? `http://${nodeIp}` : printer.embedded_ui_url) : null;
  const mainsailUrl = printer ? buildMainsailUrl(mainsailBaseUrl, printer.slug) : null;
  const moonrakerApiUrl = nodeIp && printer?.moonraker_port ? `http://${nodeIp}:${printer.moonraker_port}/server/info` : null;
  const status = (printer?.status || '').toLowerCase();
  const runtimeStatus = runtime?.status || {};
  const toolhead = runtimeStatus.toolhead || {};
  const gcodeMove = runtimeStatus.gcode_move || {};
  const printStats = runtimeStatus.print_stats || {};
  const webhooks = runtimeStatus.webhooks || {};
  const position = gcodeMove.gcode_position || gcodeMove.position || toolhead.position || [];
  const homedAxes = (toolhead.homed_axes || '').toUpperCase();
  const visibleLayoutWidgets = useMemo(
    () => layout.widgets.filter((widget) => widget.visible !== false && WIDGET_BY_ID[widget.id]),
    [layout.widgets]
  );
  const hiddenWidgets = useMemo(
    () => layout.widgets.filter((widget) => widget.visible === false && WIDGET_BY_ID[widget.id]),
    [layout.widgets]
  );

  useEffect(() => {
    if (!mainsailUrl) return;

    const ready = ['idle', 'online', 'ready'].includes(status);
    const urlChanged = previousMainsailUrl.current !== mainsailUrl;
    const becameReady = ready && !previousMainsailReady.current;

    if (urlChanged || becameReady) {
      setMainsailFrameNonce((value) => value + 1);
    }

    previousMainsailUrl.current = mainsailUrl;
    previousMainsailReady.current = ready;
  }, [mainsailUrl, status]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <RefreshCw className="text-blue-500 animate-spin" size={32} />
        <div className="text-slate-400 font-medium">Loading printer details...</div>
      </div>
    );
  }

  if (!printer) return <div className="text-red-500 font-bold p-8 bg-red-500/10 rounded-xl border border-red-500/20">Printer not found.</div>;

  const statusMessage = (printer.status_message || '').trim();
  const readyMessage = statusMessage.toLowerCase() === 'printer is ready';
  const showStatusMessage = Boolean(statusMessage && !(readyMessage && ['idle', 'online', 'ready'].includes(status)));
  const isErrorStatus = ['error', 'shutdown'].includes(status);
  const isOfflineStatus = status === 'offline';
  const statusMessageTone = isErrorStatus
    ? {
        border: 'border-red-500/30',
        bg: 'bg-red-500/10',
        text: 'text-red-100',
        accent: 'text-red-400',
        title: 'text-red-300',
        label: 'Klipper Error'
      }
    : isOfflineStatus
      ? {
          border: 'border-amber-500/30',
          bg: 'bg-amber-500/10',
          text: 'text-amber-100',
          accent: 'text-amber-400',
          title: 'text-amber-300',
          label: 'Connection Issue'
        }
      : {
          border: 'border-blue-500/30',
          bg: 'bg-blue-500/10',
          text: 'text-blue-100',
          accent: 'text-blue-400',
          title: 'text-blue-300',
          label: 'Printer Message'
        };

  const cardClass = "h-full bg-slate-800 border border-slate-700 rounded-xl shadow-sm";

  const renderStatusCard = () => (
    <div className={`${cardClass} overflow-y-auto p-6`}>
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-blue-500/10 text-blue-500 rounded-xl shadow-inner">
            <Activity size={32} />
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Current Status</p>
            <p className="text-xl font-bold capitalize text-slate-200">{printer.status || 'offline'}</p>
          </div>
        </div>
        <button
          onClick={() => handleAction("Emergency Stop")}
          className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-bold transition-colors shadow-lg shadow-red-900/20 text-white"
        >
          <ShieldAlert size={18} />
          <span>EMERGENCY STOP</span>
        </button>
      </div>

      {showStatusMessage && (
        <div className={`mb-6 rounded-xl border ${statusMessageTone.border} ${statusMessageTone.bg} p-4 ${statusMessageTone.text}`}>
          <div className="flex items-start space-x-3">
            <ShieldAlert size={18} className={`mt-0.5 shrink-0 ${statusMessageTone.accent}`} />
            <div>
              <p className={`text-[10px] font-bold uppercase tracking-widest ${statusMessageTone.title} mb-2`}>{statusMessageTone.label}</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{statusMessage}</p>
            </div>
          </div>
        </div>
      )}

      {printer.moonraker_warnings?.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-100">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-300">Moonraker Warnings</p>
            <button
              onClick={handleRepairMoonraker}
              disabled={repairingMoonraker || !printer.assigned_node_id}
              className="inline-flex items-center space-x-2 rounded-lg bg-amber-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-amber-100 transition-colors hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {repairingMoonraker ? <RefreshCw size={14} className="animate-spin" /> : <Wrench size={14} />}
              <span>{repairingMoonraker ? 'Fixing' : 'Auto Fix'}</span>
            </button>
          </div>
          <div className="space-y-2">
            {printer.moonraker_warnings.map((warning, index) => (
              <p key={index} className="whitespace-pre-wrap text-xs leading-relaxed">
                {warning.replace(/<br\s*\/?>/gi, '\n')}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { name: 'Restart Klipper', icon: RefreshCw, color: 'text-blue-400' },
          { name: 'Restart Moonraker', icon: RefreshCw, color: 'text-green-400' },
          { name: 'Firmware Restart', icon: RefreshCw, color: 'text-orange-400' },
          { name: 'Power Cycle', icon: Power, color: 'text-red-400' }
        ].map((btn) => (
          <button
            key={btn.name}
            onClick={() => handleAction(btn.name)}
            className="flex min-h-20 flex-col items-center justify-center rounded-xl border border-transparent bg-slate-900 p-4 transition-all hover:border-slate-600 hover:bg-slate-700 group"
          >
            <btn.icon size={24} className={`${btn.color} mb-2 group-hover:scale-110 transition-transform`} />
            <span className="text-center text-[10px] font-bold uppercase tracking-normal text-slate-400 group-hover:text-slate-200">{btn.name}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const renderToolheadCard = () => (
    <div className={`${cardClass} space-y-5 overflow-y-auto p-5`}>
      <div className="flex items-center justify-between border-b border-slate-700 pb-3">
        <div className="flex items-center space-x-2">
          <Navigation size={18} className="text-cyan-400" />
          <h3 className="font-bold text-sm">Toolhead</h3>
        </div>
        <button onClick={fetchRuntime} className="p-2 rounded-lg bg-slate-900 text-slate-400 hover:text-blue-300" title="Refresh toolhead">
          <RefreshCw size={15} />
        </button>
      </div>

      {runtimeError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{runtimeError}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {[
              ['X', axisValue(position, 0)],
              ['Y', axisValue(position, 1)],
              ['Z', axisValue(position, 2)],
              ['E', axisValue(position, 3)],
            ].map(([axis, value]) => (
              <div key={axis} className="rounded-lg border border-slate-700 bg-slate-900 p-3">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{axis}</p>
                <p className="mt-1 font-mono text-lg font-bold text-slate-100">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {['X', 'Y', 'Z'].map((axis) => {
              const homed = homedAxes.includes(axis);
              return (
                <button
                  key={axis}
                  onClick={() => handleHomeAxis(axis)}
                  disabled={homingAxis === axis}
                  className={`min-h-12 rounded-lg border px-3 py-2 text-center text-[10px] font-bold uppercase transition-colors disabled:cursor-wait disabled:opacity-70 ${homed ? 'border-green-500/30 bg-green-500/10 text-green-300 hover:bg-green-500/20' : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-blue-500/40 hover:text-blue-300'}`}
                  title={`Home ${axis} axis`}
                >
                  {homingAxis === axis ? `${axis} Homing` : `${axis} ${homed ? 'Homed' : 'Not Homed'}`}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
              <div className="mb-2 flex items-center space-x-2 text-slate-400">
                <Gauge size={14} />
                <p className="text-[9px] font-bold uppercase tracking-widest">Motion</p>
              </div>
              <p className="text-xs text-slate-300">Velocity <span className="font-mono text-blue-300">{formatNumber(toolhead.max_velocity, 0)} mm/s</span></p>
              <p className="text-xs text-slate-300">Accel <span className="font-mono text-blue-300">{formatNumber(toolhead.max_accel, 0)} mm/s2</span></p>
              <p className="text-xs text-slate-300">Speed <span className="font-mono text-blue-300">{gcodeMove.speed ? formatNumber(gcodeMove.speed / 60, 1) : '--'} mm/s</span></p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
              <div className="mb-2 flex items-center space-x-2 text-slate-400">
                <Thermometer size={14} />
                <p className="text-[9px] font-bold uppercase tracking-widest">Temps</p>
              </div>
              <p className="text-xs text-slate-300">Extruder <span className="font-mono text-orange-300">{tempText(runtimeStatus.extruder)}</span></p>
              <p className="text-xs text-slate-300">Bed <span className="font-mono text-purple-300">{tempText(runtimeStatus.heater_bed)}</span></p>
              <p className="text-xs text-slate-300">State <span className="font-mono text-green-300">{webhooks.state || printer.status || '--'}</span></p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Print State</p>
            <p className="mt-1 text-sm font-semibold capitalize text-slate-200">{printStats.state || 'standby'}</p>
          </div>
        </>
      )}
    </div>
  );

  const renderMainsailCard = () => (
    <div className={`${cardClass} flex flex-col overflow-hidden`}>
      <div className="p-4 border-b border-slate-700 flex flex-wrap justify-between items-center gap-3 bg-slate-800/50">
        <div className="flex items-center space-x-2 text-blue-400">
          <Printer size={18} />
          <h3 className="font-bold text-sm">Mainsail</h3>
        </div>
        <div className="flex items-center space-x-3">
          {mainsailUrl && (
            <button
              onClick={() => setMainsailFrameNonce((value) => value + 1)}
              className="text-slate-400 hover:text-blue-300"
              title="Reload embedded Mainsail"
            >
              <RefreshCw size={15} />
            </button>
          )}
          {mainsailUrl && (
            <a href={mainsailUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs font-bold uppercase tracking-wider">Open Mainsail</a>
          )}
          {moonrakerApiUrl && (
            <a href={moonrakerApiUrl} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:text-green-300 text-xs font-bold uppercase tracking-wider">Open Moonraker API</a>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-slate-900">
        {mainsailUrl ? (
          <iframe key={`${mainsailUrl}-${mainsailFrameNonce}`} src={mainsailUrl} className="w-full h-full border-none" title="Mainsail"></iframe>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 space-y-2 italic">
            <ShieldAlert size={48} className="opacity-10" />
            <p>No assigned node or UI URL configured for this printer</p>
          </div>
        )}
      </div>
    </div>
  );

  const renderWebcamCard = () => (
    <div className={`${cardClass} space-y-4 overflow-hidden p-5`}>
      <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
        <Camera size={18} className="text-purple-400" />
        <h3 className="font-bold text-sm">Webcam Stream</h3>
      </div>
      <div className="aspect-video bg-slate-900 rounded-lg overflow-hidden border border-slate-800">
        {printer.webcam_url ? (
          <img src={printer.webcam_url} alt="Webcam" className="w-full h-full object-cover" />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-700 italic text-xs">Stream Unavailable</div>
        )}
      </div>
    </div>
  );

  const renderConfigurationCard = () => (
    <div className={`${cardClass} space-y-4 overflow-y-auto p-5`}>
      <div className="flex items-center space-x-2 border-b border-slate-700 pb-3">
        <FileText size={18} className="text-green-400" />
        <h3 className="font-bold text-sm">Configuration</h3>
      </div>
      <div className="space-y-4">
        <div>
          <p className="text-slate-500 uppercase text-[9px] font-bold tracking-widest mb-1">Config Path</p>
          <p className="truncate font-mono bg-slate-900 p-2 rounded text-[11px] text-blue-300 border border-slate-700">{printer.config_path || '/mnt/klipper-farm/default/config'}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-slate-500 uppercase text-[9px] font-bold tracking-widest mb-1">Moonraker Port</p>
            <p className="font-mono text-sm">{printer.moonraker_port || '7125'}</p>
          </div>
          <div>
            <p className="text-slate-500 uppercase text-[9px] font-bold tracking-widest mb-1">Last Seen</p>
            <p className="text-xs">{printer.last_seen ? new Date(printer.last_seen).toLocaleTimeString() : 'Never'}</p>
          </div>
        </div>
      </div>
      <Link to="/files" className="block w-full text-center bg-slate-700 hover:bg-slate-600 py-2 rounded-lg text-xs font-bold transition-colors text-slate-300">
        Manage Config Files
      </Link>
    </div>
  );

  const renderWidget = (widgetId) => {
    switch (widgetId) {
      case 'status': return renderStatusCard();
      case 'toolhead': return renderToolheadCard();
      case 'mainsail': return renderMainsailCard();
      case 'webcam': return renderWebcamCard();
      case 'configuration': return renderConfigurationCard();
      case 'config-helper': return (
        <ConfigHelperCard
          printer={printer}
          addToast={addToast}
          fetchPrinter={fetchPrinter}
          fetchRuntime={fetchRuntime}
          cardClass={cardClass}
        />
      );
      default: return null;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <Link to="/" className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h2 className="text-2xl font-bold">{printer.name}</h2>
            <p className="text-xs text-slate-500 font-mono mt-0.5">SLUG: {printer.slug} - MCU: {printer.mcu_serial || 'NOT CONNECTED'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={toggleSettingsPanel}
            className={`inline-flex items-center space-x-2 rounded-lg px-4 py-2 text-sm font-bold transition-colors ${settingsOpen ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20 hover:bg-blue-500' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
          >
            <Settings size={17} />
            <span>Printer Settings</span>
          </button>
          <button
            onClick={() => setLayoutOpen((value) => !value)}
            className="inline-flex items-center space-x-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-slate-200 transition-colors hover:bg-slate-700"
          >
            <SlidersHorizontal size={17} />
            <span>Customize</span>
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div className={`${cardClass} p-5`}>
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-700 pb-3">
            <div className="flex items-center space-x-2">
              <Settings size={18} className="text-blue-400" />
              <h3 className="font-bold text-sm">Printer Settings</h3>
            </div>
            <span className="rounded-md bg-slate-900 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{printer.status || 'offline'}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Printer</p>
              <p className="text-sm font-bold text-slate-100">{printer.name}</p>
              <p className="mt-1 font-mono text-[11px] text-slate-400">{printer.slug}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Node</p>
              <p className="text-sm font-bold text-slate-100">{printer.node?.hostname || printer.node?.name || 'Unassigned'}</p>
              <p className="mt-1 font-mono text-[11px] text-slate-400">{printer.node?.ip_address || '--'}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Moonraker</p>
              <p className="font-mono text-sm font-bold text-slate-100">{printer.moonraker_port || '7125'}</p>
              {moonrakerApiUrl && <a href={moonrakerApiUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block text-[11px] font-bold text-green-300 hover:text-green-200">Open API</a>}
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-500">Configuration</p>
              <p className="truncate font-mono text-[11px] text-blue-300">{printer.config_path || '--'}</p>
              <Link to="/files" className="mt-1 block text-[11px] font-bold text-slate-300 hover:text-blue-300">Manage Files</Link>
            </div>
          </div>
        </div>
      )}

      {layoutOpen && (
        <div className={`${cardClass} p-4 space-y-4`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Printer Dashboard Layout</p>
            <button onClick={resetLayout} className="inline-flex items-center space-x-2 rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:text-blue-300">
              <RotateCcw size={14} />
              <span>Reset</span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {layout.widgets.map((item, index) => {
              const widget = WIDGET_BY_ID[item.id];
              if (!widget) return null;
              return (
                <div key={item.id} className="rounded-lg border border-slate-700 bg-slate-900 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{widget.title}</p>
                      <p className="mt-1 text-[10px] font-semibold text-slate-600">{item.visible === false ? 'Hidden' : `Visible - ${item.size || widget.defaultSize}`}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => moveWidget(item.id, -1)}
                        disabled={index === 0}
                        className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-800 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-30"
                        title={`Move ${widget.title} earlier`}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() => moveWidget(item.id, 1)}
                        disabled={index === layout.widgets.length - 1}
                        className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-800 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-30"
                        title={`Move ${widget.title} later`}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        onClick={() => (item.visible === false ? showWidget(item.id) : hideWidget(item.id))}
                        className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-800 hover:text-red-300"
                        title={`${item.visible === false ? 'Show' : 'Hide'} ${widget.title}`}
                      >
                        {item.visible === false ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                    </div>
                  </div>
                  <select
                    value={item.size || widget.defaultSize}
                    onChange={(event) => resizeWidget(item.id, event.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100 outline-none transition-colors focus:border-blue-500"
                  >
                    {WIDGET_SIZE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          {hiddenWidgets.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">Hidden</p>
              <div className="flex flex-wrap gap-2">
                {hiddenWidgets.map((item) => {
                  const widget = WIDGET_BY_ID[item.id];
                  return (
                    <button
                      key={item.id}
                      onClick={() => showWidget(item.id)}
                      className="inline-flex items-center space-x-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-400 transition-colors hover:border-blue-500/40 hover:text-blue-300"
                    >
                      <Eye size={14} />
                      <span>{widget.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Printer Dashboards</h3>
          <p className="text-xs font-medium text-slate-500">Dashboard cards use fixed 1x1, 2x1, 1x2, or 2x2 sizes with a minimum card footprint.</p>
        </div>
        <span className="rounded-lg bg-slate-800 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {visibleLayoutWidgets.length} active
        </span>
      </div>

      <div className="printer-dashboard-grid">
        {visibleLayoutWidgets.map((item) => {
          const widget = WIDGET_BY_ID[item.id];
          if (!widget) return null;
          return (
            <div key={item.id} className={`${widgetSizeClass(item.size || widget.defaultSize)} min-h-0`}>
              {renderWidget(widget.id)}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PrinterDetail;
