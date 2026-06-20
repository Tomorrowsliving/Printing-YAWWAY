import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  CheckCircle,
  Eye,
  EyeOff,
  FileCode,
  Loader2,
  Move,
  Package,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import axios from 'axios';
import { EmptyState, PageHeader, Panel, StatusPill, ToolbarButton } from './DesignSystem';
import { ConfirmActionModal } from './UI';

const formatBytes = (value) => {
  const size = Number(value) || 0;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
};

const formatDate = (value) => {
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
};

const formatBounds = (analysis) => {
  if (!analysis?.has_bounds) return 'Unknown bounds';
  return `${analysis.width.toFixed(1)} x ${analysis.depth.toFixed(1)} mm`;
};

const formatWeight = (value) => {
  const grams = Number(value);
  if (!Number.isFinite(grams) || grams <= 0) return 'Unknown';
  if (grams >= 1000) return `${(grams / 1000).toFixed(2)} kg`;
  return `${grams.toFixed(1)} g`;
};

const fitTone = (status) => {
  if (status === 'fits') return 'border-green-500/30 bg-green-500/10 text-green-300';
  if (status === 'too_large') return 'border-red-500/30 bg-red-500/10 text-red-300';
  return 'border-slate-600/60 bg-slate-700/40 text-slate-300';
};

const stripComment = (line) => line.replace(/\([^)]*\)/g, '').split(';')[0].trim();

const parseWords = (line) => {
  const words = {};
  line.replace(/([A-Z])\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))/gi, (_, letter, value) => {
    words[letter.toUpperCase()] = Number(value);
    return '';
  });
  return words;
};

const parsePreview = (content) => {
  const lines = content.split(/\r?\n/);
  const maxExtrudeSegments = 180000;
  const maxTravelSegments = 25000;
  const emptyBounds = () => ({ minX: null, maxX: null, minY: null, maxY: null, minZ: null, maxZ: null });
  const motionBounds = emptyBounds();
  const extrusionBounds = emptyBounds();
  const layers = new Set();

  const updateBounds = (bounds, nextX, nextY, nextZ) => {
    if (nextX === null || nextY === null || nextZ === null) return;
    bounds.minX = bounds.minX === null ? nextX : Math.min(bounds.minX, nextX);
    bounds.maxX = bounds.maxX === null ? nextX : Math.max(bounds.maxX, nextX);
    bounds.minY = bounds.minY === null ? nextY : Math.min(bounds.minY, nextY);
    bounds.maxY = bounds.maxY === null ? nextY : Math.max(bounds.maxY, nextY);
    bounds.minZ = bounds.minZ === null ? nextZ : Math.min(bounds.minZ, nextZ);
    bounds.maxZ = bounds.maxZ === null ? nextZ : Math.max(bounds.maxZ, nextZ);
  };

  const parseMoves = (onMove) => {
    let absoluteXY = true;
    let absoluteE = true;
    let units = 1;
    let x = null;
    let y = null;
    let z = 0;
    let e = 0;

    lines.forEach((rawLine) => {
      const line = stripComment(rawLine).toUpperCase();
      if (!line) return;
      const words = parseWords(line);
      const gcode = words.G;

      if (gcode === 20) {
        units = 25.4;
        return;
      }
      if (gcode === 21) {
        units = 1;
        return;
      }
      if (gcode === 90) {
        absoluteXY = true;
        return;
      }
      if (gcode === 91) {
        absoluteXY = false;
        return;
      }
      if (words.M === 82) {
        absoluteE = true;
        return;
      }
      if (words.M === 83) {
        absoluteE = false;
        return;
      }

      if (gcode === 92) {
        if (Number.isFinite(words.X)) x = words.X * units;
        if (Number.isFinite(words.Y)) y = words.Y * units;
        if (Number.isFinite(words.Z)) z = words.Z * units;
        if (Number.isFinite(words.E)) e = words.E;
        return;
      }

      if (gcode !== 0 && gcode !== 1) return;

      const startX = x;
      const startY = y;
      const startZ = z;
      let nextX = x;
      let nextY = y;
      let nextZ = z;
      if (Number.isFinite(words.X)) {
        const value = words.X * units;
        nextX = absoluteXY || x === null ? value : x + value;
      }
      if (Number.isFinite(words.Y)) {
        const value = words.Y * units;
        nextY = absoluteXY || y === null ? value : y + value;
      }
      if (Number.isFinite(words.Z)) {
        const value = words.Z * units;
        nextZ = absoluteXY || z === null ? value : z + value;
      }

      let extruding = false;
      if (Number.isFinite(words.E)) {
        const nextE = absoluteE ? words.E : e + words.E;
        extruding = absoluteE ? nextE > e : words.E > 0;
        e = nextE;
      }

      const moved = startX !== nextX || startY !== nextY || startZ !== nextZ;
      if (startX !== null && startY !== null && nextX !== null && nextY !== null && moved) {
        onMove({ startX, startY, startZ, endX: nextX, endY: nextY, endZ: nextZ, extruding });
      }

      x = nextX;
      y = nextY;
      z = nextZ;
    });
  };

  let extrusionCount = 0;
  let travelCount = 0;
  parseMoves((segment) => {
    updateBounds(motionBounds, segment.startX, segment.startY, segment.startZ);
    updateBounds(motionBounds, segment.endX, segment.endY, segment.endZ);
    if (segment.extruding) {
      extrusionCount += 1;
      updateBounds(extrusionBounds, segment.startX, segment.startY, segment.startZ);
      updateBounds(extrusionBounds, segment.endX, segment.endY, segment.endZ);
      layers.add(segment.endZ.toFixed(3));
    } else {
      travelCount += 1;
    }
  });

  const extrudeStride = Math.max(1, Math.ceil(extrusionCount / maxExtrudeSegments));
  const travelStride = Math.max(1, Math.ceil(travelCount / maxTravelSegments));
  const segments = [];
  let extrudeIndex = 0;
  let travelIndex = 0;

  parseMoves((segment) => {
    if (segment.extruding) {
      extrudeIndex += 1;
      if ((extrudeIndex - 1) % extrudeStride === 0) {
        segments.push(segment);
      }
    } else {
      travelIndex += 1;
      if ((travelIndex - 1) % travelStride === 0) {
        segments.push(segment);
      }
    }
  });

  const bounds = extrusionBounds.minX !== null ? extrusionBounds : motionBounds;
  return {
    bounds,
    segments,
    layerCount: layers.size,
    sampled: extrudeStride > 1 || travelStride > 1,
    totalExtrusionSegments: extrusionCount,
  };
};

const VIEW_PRESETS = {
  iso: { theta: -0.75, phi: 0.92 },
  top: { theta: -Math.PI / 2, phi: 0.01 },
  front: { theta: -Math.PI / 2, phi: Math.PI / 2 },
  side: { theta: 0, phi: Math.PI / 2 },
};

const normaliseBounds = (bounds) => {
  const minX = Number.isFinite(bounds.minX) ? bounds.minX : 0;
  const maxX = Number.isFinite(bounds.maxX) ? bounds.maxX : minX + 1;
  const minY = Number.isFinite(bounds.minY) ? bounds.minY : 0;
  const maxY = Number.isFinite(bounds.maxY) ? bounds.maxY : minY + 1;
  const minZ = Number.isFinite(bounds.minZ) ? bounds.minZ : 0;
  const maxZ = Number.isFinite(bounds.maxZ) ? bounds.maxZ : minZ + 1;
  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    width: Math.max(1, maxX - minX),
    depth: Math.max(1, maxY - minY),
    height: Math.max(1, maxZ - minZ),
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    centerZ: (minZ + maxZ) / 2,
  };
};

const disposeObject = (object) => {
  if (object.geometry) object.geometry.dispose();
  if (Array.isArray(object.material)) {
    object.material.forEach((material) => material.dispose());
  } else if (object.material) {
    object.material.dispose();
  }
};

const buildLineGeometry = (segments, bounds, verticalScale, extruding) => {
  const matching = segments.filter((segment) => segment.extruding === extruding);
  const positions = new Float32Array(matching.length * 6);
  const colors = new Float32Array(matching.length * 6);
  const color = new THREE.Color();
  const zRange = Math.max(0.01, bounds.maxZ - bounds.minZ);

  matching.forEach((segment, index) => {
    const offset = index * 6;
    positions[offset] = segment.startX - bounds.centerX;
    positions[offset + 1] = (segment.startZ - bounds.minZ) * verticalScale;
    positions[offset + 2] = segment.startY - bounds.centerY;
    positions[offset + 3] = segment.endX - bounds.centerX;
    positions[offset + 4] = (segment.endZ - bounds.minZ) * verticalScale;
    positions[offset + 5] = segment.endY - bounds.centerY;

    const layerTone = (segment.endZ - bounds.minZ) / zRange;
    if (extruding) {
      color.setHSL(0.52 + layerTone * 0.18, 0.9, 0.58);
    } else {
      color.setRGB(0.36, 0.44, 0.56);
    }

    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
    colors[offset + 3] = color.r;
    colors[offset + 4] = color.g;
    colors[offset + 5] = color.b;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return { geometry, count: matching.length };
};

const GcodeScene = ({ preview, showTravel, viewPreset, interactionMode }) => {
  const mountRef = useRef(null);
  const [renderError, setRenderError] = useState('');

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    setRenderError('');
    mount.innerHTML = '';

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (error) {
      setRenderError('WebGL is not available in this browser.');
      return undefined;
    }

    const bounds = normaliseBounds(preview.bounds);
    const verticalScale = 1;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#020617');

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = `h-full w-full touch-none ${interactionMode === 'pan' ? 'cursor-move' : 'cursor-grab'}`;
    renderer.domElement.dataset.testid = 'gcode-3d-canvas';
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    const target = new THREE.Vector3(0, Math.max(4, bounds.height * verticalScale * 0.5), 0);
    const maxSpan = Math.max(bounds.width, bounds.depth, bounds.height * verticalScale);
    const radius = Math.max(90, maxSpan * 1.45);
    const preset = VIEW_PRESETS[viewPreset] || VIEW_PRESETS.iso;
    const phi = Math.max(0.01, Math.min(Math.PI - 0.01, preset.phi));
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.cos(preset.theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.sin(preset.theta)
    );
    camera.lookAt(target);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.rotateSpeed = 0.75;
    controls.panSpeed = 0.9;
    controls.zoomSpeed = 0.9;
    controls.minDistance = Math.max(8, maxSpan * 0.12);
    controls.maxDistance = 5000;
    controls.maxPolarAngle = Math.PI - 0.02;
    controls.mouseButtons = interactionMode === 'pan'
      ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = interactionMode === 'pan'
      ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }
      : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.update();

    scene.add(new THREE.HemisphereLight('#e0f2fe', '#0f172a', 2.2));
    const keyLight = new THREE.DirectionalLight('#ffffff', 1.2);
    keyLight.position.set(80, 140, 90);
    scene.add(keyLight);

    const bedSize = Math.max(bounds.width, bounds.depth) + 30;
    const grid = new THREE.GridHelper(bedSize, Math.min(60, Math.max(12, Math.round(bedSize / 10))), '#334155', '#1e293b');
    grid.position.y = 0;
    scene.add(grid);

    const bedGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-bounds.width / 2, 0.2, -bounds.depth / 2),
      new THREE.Vector3(bounds.width / 2, 0.2, -bounds.depth / 2),
      new THREE.Vector3(bounds.width / 2, 0.2, bounds.depth / 2),
      new THREE.Vector3(-bounds.width / 2, 0.2, bounds.depth / 2),
      new THREE.Vector3(-bounds.width / 2, 0.2, -bounds.depth / 2),
    ]);
    scene.add(new THREE.Line(bedGeometry, new THREE.LineBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.75 })));

    const axes = new THREE.AxesHelper(Math.min(40, Math.max(16, maxSpan * 0.15)));
    axes.position.set(-bounds.width / 2, 0.4, -bounds.depth / 2);
    scene.add(axes);

    const extrudeLine = buildLineGeometry(preview.segments, bounds, verticalScale, true);
    if (extrudeLine.count > 0) {
      scene.add(new THREE.LineSegments(extrudeLine.geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 })));
    }

    const travelLine = buildLineGeometry(preview.segments, bounds, verticalScale, false);
    if (showTravel && travelLine.count > 0) {
      scene.add(new THREE.LineSegments(travelLine.geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22 })));
    } else {
      travelLine.geometry.dispose();
    }

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const onContextMenu = (event) => event.preventDefault();
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      controls.dispose();
      scene.traverse(disposeObject);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [preview, showTravel, viewPreset, interactionMode]);

  return (
    <div className="relative h-[460px] overflow-hidden rounded-lg border border-slate-700 bg-slate-950" data-testid="gcode-3d-viewer">
      <div ref={mountRef} className="h-full w-full" />
      {renderError && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950 text-xs font-semibold text-red-300">
          {renderError}
        </div>
      )}
      {!renderError && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-slate-700/70 bg-slate-950/80 px-3 py-2 text-[10px] font-bold uppercase text-slate-400">
          {interactionMode === 'pan' ? 'Drag pan - right drag rotate - wheel zoom' : 'Drag rotate - right/shift drag pan - wheel zoom'}
        </div>
      )}
    </div>
  );
};

const GcodeViewer = ({ content, analysis }) => {
  const preview = useMemo(() => parsePreview(content || ''), [content]);
  const hasPreview = preview.segments.length > 0 && preview.bounds.minX !== null;
  const [showTravel, setShowTravel] = useState(false);
  const [viewPreset, setViewPreset] = useState('iso');
  const [interactionMode, setInteractionMode] = useState('orbit');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <Box size={13} />
            <span>3D Viewer</span>
          </p>
          <p className="mt-1 text-sm font-bold text-slate-200">{formatBounds(analysis)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[10px] font-bold uppercase text-slate-400">
            {preview.layerCount || 0} layers
          </span>
          <span className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[10px] font-bold uppercase text-slate-400">
            {analysis?.xy_move_count || 0} XY moves
          </span>
        </div>
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
            className={`rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase transition-colors ${viewPreset === value ? 'border-blue-500/40 bg-blue-500/15 text-blue-200' : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'}`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setViewPreset('iso')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-[10px] font-bold uppercase text-slate-400 transition-colors hover:text-slate-200"
        >
          <RotateCcw size={12} />
          <span>Reset</span>
        </button>
        <button
          type="button"
          onClick={() => setInteractionMode((current) => (current === 'pan' ? 'orbit' : 'pan'))}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase transition-colors ${interactionMode === 'pan' ? 'border-amber-500/40 bg-amber-500/15 text-amber-200' : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'}`}
        >
          <Move size={12} />
          <span>{interactionMode === 'pan' ? 'Panning' : 'Pan'}</span>
        </button>
        <button
          type="button"
          onClick={() => setShowTravel((current) => !current)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase transition-colors ${showTravel ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200' : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'}`}
        >
          {showTravel ? <Eye size={12} /> : <EyeOff size={12} />}
          <span>Travel</span>
        </button>
      </div>

      {hasPreview ? (
        <GcodeScene preview={preview} showTravel={showTravel} viewPreset={viewPreset} interactionMode={interactionMode} />
      ) : (
        <div className="flex h-[460px] items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-xs font-semibold text-slate-600">
          No previewable 3D moves
        </div>
      )}

      <pre className="max-h-48 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-[10px] leading-relaxed text-slate-400">
        {(content || '').split(/\r?\n/).slice(0, 120).join('\n')}
      </pre>
    </div>
  );
};

const GcodeHub = ({ addToast }) => {
  const fileInputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [targets, setTargets] = useState([]);
  const [printers, setPrinters] = useState([]);
  const [spools, setSpools] = useState([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [selectedTargetIds, setSelectedTargetIds] = useState([]);
  const [selectedSpoolId, setSelectedSpoolId] = useState('');
  const [uploadPrinterId, setUploadPrinterId] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [deletingPath, setDeletingPath] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);

  const selectedFile = useMemo(
    () => files.find((file) => file.path === selectedPath) || null,
    [files, selectedPath]
  );

  const fileGroups = useMemo(() => {
    const groups = new Map();
    files.forEach((file) => {
      const key = file.group_key || `file:${file.path}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: file.group_label || file.relative_path,
          variants: [],
          last_modified: file.last_modified,
        });
      }
      const group = groups.get(key);
      group.variants.push(file);
      group.last_modified = Math.max(group.last_modified || 0, file.last_modified || 0);
    });

    return Array.from(groups.values())
      .map((group) => {
        const sortedVariants = [...group.variants].sort((a, b) => String(a.source_printer_name).localeCompare(String(b.source_printer_name)));
        const selectedVariant = sortedVariants.find((file) => file.path === selectedPath);
        const primary = selectedVariant || sortedVariants[0];
        return {
          ...group,
          variants: sortedVariants,
          primary,
          analysis: primary?.analysis,
          compatible_printer_ids: Array.from(new Set(sortedVariants.flatMap((file) => file.compatible_printer_ids || []))),
        };
      })
      .sort((a, b) => (b.last_modified || 0) - (a.last_modified || 0));
  }, [files, selectedPath]);

  const selectedGroup = useMemo(
    () => fileGroups.find((group) => group.variants.some((file) => file.path === selectedPath)) || null,
    [fileGroups, selectedPath]
  );

  const filteredGroups = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return fileGroups.filter((group) => {
      const matchesSource = sourceFilter === 'all' || group.variants.some((file) => String(file.source_printer_id) === sourceFilter);
      const matchesSearch = !normalizedSearch
        || group.label.toLowerCase().includes(normalizedSearch)
        || group.variants.some((file) => (
          file.name.toLowerCase().includes(normalizedSearch)
          || file.relative_path.toLowerCase().includes(normalizedSearch)
          || file.source_printer_name.toLowerCase().includes(normalizedSearch)
        ));
      return matchesSource && matchesSearch;
    });
  }, [fileGroups, search, sourceFilter]);

  const compatibility = useMemo(() => {
    const rows = selectedFile?.target_statuses || [];
    return rows.reduce((acc, row) => ({ ...acc, [row.printer_id]: row }), {});
  }, [selectedFile]);

  const compatibleTargetIds = useMemo(
    () => targets
      .filter((target) => compatibility[target.id]?.status === 'fits' && target.assigned_node_id && target.moonraker_port)
      .map((target) => target.id),
    [compatibility, targets]
  );

  const selectedSpool = useMemo(
    () => spools.find((spool) => String(spool.id) === String(selectedSpoolId)) || null,
    [selectedSpoolId, spools]
  );

  const estimatedFilamentG = useMemo(
    () => Number(selectedFile?.metadata?.filament_used_g) || null,
    [selectedFile]
  );

  const fetchGcodes = useCallback(async () => {
    setLoading(true);
    try {
      const [res, spoolRes] = await Promise.all([
        axios.get('/api/printers/gcodes'),
        axios.get('/api/filaments/spools'),
      ]);
      const nextFiles = Array.isArray(res.data.files) ? res.data.files : [];
      const nextPrinters = Array.isArray(res.data.printers) ? res.data.printers : [];
      setFiles(nextFiles);
      setTargets(Array.isArray(res.data.targets) ? res.data.targets : []);
      setPrinters(nextPrinters);
      setSpools(Array.isArray(spoolRes.data) ? spoolRes.data : []);
      setUploadPrinterId((current) => current || String(nextPrinters[0]?.id || ''));
      setSelectedPath((current) => (
        nextFiles.some((file) => file.path === current) ? current : nextFiles[0]?.path || ''
      ));
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to load G-code hub', 'error');
      setFiles([]);
      setTargets([]);
      setPrinters([]);
      setSpools([]);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchGcodes();
  }, [fetchGcodes]);

  useEffect(() => {
    if (!selectedFile) {
      setContent('');
      setSelectedTargetIds([]);
      return;
    }

    setSelectedTargetIds([selectedFile.source_printer_id].filter(Boolean));
    setSelectedSpoolId(selectedFile.metadata?.filament_spool_id ? String(selectedFile.metadata.filament_spool_id) : '');
    let cancelled = false;
    setContentLoading(true);

    axios.get('/api/files/read', { params: { path: selectedFile.path } })
      .then((res) => {
        if (!cancelled) setContent(res.data.content || '');
      })
      .catch(() => {
        if (!cancelled) {
          setContent('');
          addToast('Failed to read G-code file', 'error');
        }
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [addToast, selectedFile]);

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    const printer = printers.find((item) => String(item.id) === String(uploadPrinterId));
    if (!file || !printer) return;

    const formData = new FormData();
    formData.append('file', file);
    setUploading(true);
    try {
      await axios.post('/api/files/upload', formData, {
        params: { printer_slug: printer.slug, file_type: 'gcode' },
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      addToast(`${file.name} uploaded to ${printer.name}`, 'success');
      await fetchGcodes();
    } catch (err) {
      addToast(err.response?.data?.detail || 'Upload failed', 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const performDelete = async (file) => {
    if (!file) return;
    setDeletingPath(file.path);
    try {
      await axios.delete('/api/files/delete', { params: { path: file.path } });
      addToast(`${file.name} deleted`, 'success');
      await fetchGcodes();
    } catch (err) {
      addToast(err.response?.data?.detail || 'Delete failed', 'error');
    } finally {
      setDeletingPath('');
    }
  };

  const handleDelete = (file) => {
    if (!file) return;
    setConfirmAction({
      action: 'delete',
      file,
      title: 'Delete G-code File',
      actionLabel: 'Delete File',
      description: 'This removes the G-code file from central printer storage.',
      consequences: [
        `${file.relative_path} will be deleted from ${file.source_printer_name || 'its source printer'}.`,
        'Any print workflow using this exact file path will need the file uploaded again.',
      ],
      requireText: 'DELETE',
      confirmVariant: 'danger',
    });
  };

  const toggleTarget = (printerId) => {
    setSelectedTargetIds((current) => (
      current.includes(printerId)
        ? current.filter((id) => id !== printerId)
        : [...current, printerId]
    ));
  };

  const handlePrint = async (targetIds, onlyCompatible = false, confirmedRisk = false) => {
    if (!selectedFile || targetIds.length === 0) {
      addToast('Select a file and at least one printer', 'error');
      return;
    }

    const riskyTargets = targetIds
      .map((id) => targets.find((target) => target.id === id))
      .filter((target) => target && compatibility[target.id]?.status === 'too_large');
    if (riskyTargets.length > 0 && !confirmedRisk) {
      setConfirmAction({
        action: 'print_risk',
        title: 'Start Oversized Print',
        actionLabel: 'Start Print',
        description: 'One or more selected printers appear smaller than the G-code bounds.',
        consequences: [
          `Risky targets: ${riskyTargets.map((target) => target.name).join(', ')}.`,
          'The print may exceed bed limits or fail during motion.',
          'Check the preview and printer dimensions before continuing.',
        ],
        confirmVariant: 'warning',
        onConfirm: () => handlePrint(targetIds, onlyCompatible, true),
      });
      return;
    }

    setPrinting(true);
    try {
      const res = await axios.post(`/api/printers/${selectedFile.source_printer_id}/gcodes/print`, {
        file_path: selectedFile.path,
        target_printer_ids: targetIds,
        only_compatible: onlyCompatible,
        filament_spool_id: selectedSpoolId ? Number(selectedSpoolId) : null,
        deduct_filament: true,
      });
      if (res.data.started > 0) {
        const usageRows = (res.data.results || []).map((row) => row.filament_usage).filter((row) => row?.spool_name);
        if (usageRows.length > 0) {
          const totalUsed = usageRows.reduce((sum, row) => sum + (Number(row.usage_g) || 0), 0);
          addToast(`Started ${res.data.started} print${res.data.started === 1 ? '' : 's'}; deducted ${formatWeight(totalUsed)}`, 'success');
          await fetchGcodes();
        } else {
          addToast(`Started ${res.data.started} print${res.data.started === 1 ? '' : 's'}`, 'success');
        }
      } else {
        addToast(res.data.results?.[0]?.message || 'No prints were started', 'error');
      }
    } catch (err) {
      addToast(err.response?.data?.detail || 'Print start failed', 'error');
    } finally {
      setPrinting(false);
    }
  };

  const runConfirmedAction = async () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (action?.action === 'delete') await performDelete(action.file);
    if (action?.action === 'print_risk' && action.onConfirm) await action.onConfirm();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Print Prep"
        title="G-code Hub"
        description="Central ready-to-print storage with 3D preview, grouped slicer variants, fit checks, filament deduction, and dispatch."
        actions={(
          <>
          <select
            value={uploadPrinterId}
            onChange={(event) => setUploadPrinterId(event.target.value)}
            className="app-select min-w-[190px]"
          >
            {printers.map((printer) => (
              <option key={printer.id} value={printer.id}>Upload to {printer.name}</option>
            ))}
          </select>
          <input ref={fileInputRef} type="file" accept=".gcode,.gco,.g" className="hidden" onChange={handleUpload} />
          <ToolbarButton
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || printers.length === 0}
            icon={Upload}
            variant="primary"
            busy={uploading}
          >
            Upload
          </ToolbarButton>
          <ToolbarButton onClick={fetchGcodes} icon={RefreshCw} variant="secondary" size="icon" busy={loading} title="Refresh" />
          </>
        )}
      />

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[380px_minmax(0,1fr)_320px]">
        <Panel title="Library" description="Ready files and grouped slicer outputs" icon={FileCode} padded={false}>
          <div className="space-y-3 border-b border-slate-800 p-4">
            <div className="flex items-center space-x-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
              <Search size={15} className="text-slate-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search files..."
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600"
              />
            </div>
            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
              className="app-select w-full"
            >
              <option value="all">All printer stores</option>
              {printers.map((printer) => (
                <option key={printer.id} value={printer.id}>{printer.name}</option>
              ))}
            </select>
          </div>

          <div className="max-h-[720px] overflow-y-auto">
            {loading ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 size={28} className="animate-spin text-blue-400" />
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={FileCode} title="No G-code files found" description="Upload a ready G-code file or slice a model to send output here." />
              </div>
            ) : (
              filteredGroups.map((group) => (
                <button
                  key={group.key}
                  onClick={() => setSelectedPath(group.primary.path)}
                  className={`w-full border-b border-slate-700/70 px-4 py-3 text-left transition-colors hover:bg-slate-700/40 ${selectedGroup?.key === group.key ? 'bg-blue-500/10' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <FileCode size={18} className="mt-0.5 shrink-0 text-cyan-300" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-100">{group.label}</p>
                      <p className="mt-1 truncate text-[10px] text-slate-500">
                        {group.variants.length === 1 ? group.primary.source_printer_name : `${group.variants.length} printer variants`}
                        {' - '}
                        {formatBounds(group.analysis)}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-600">{formatDate(group.last_modified)}</p>
                    </div>
                    <span className="rounded-md bg-green-500/10 px-1.5 py-0.5 text-[9px] font-bold text-green-300">{group.compatible_printer_ids.length}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </Panel>

        <Panel title="3D Preview" description={selectedFile ? formatBounds(selectedFile.analysis) : 'Select a file to inspect toolpaths'} icon={Box} className="min-w-0">
          {selectedFile ? (
            contentLoading ? (
              <div className="flex h-[420px] items-center justify-center">
                <Loader2 size={30} className="animate-spin text-blue-400" />
              </div>
            ) : (
              <GcodeViewer content={content} analysis={selectedFile.analysis} />
            )
          ) : (
            <EmptyState icon={Box} title="Select a G-code file" description="The viewer will show the build volume, extrusions, travel moves, and file bounds." />
          )}
        </Panel>

        <Panel title="Print Dispatch" description="Choose printers, filament, and start safely" icon={Play} className="2xl:sticky 2xl:top-24 2xl:self-start" bodyClassName="space-y-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Selected File</p>
            <p className="mt-2 break-all text-sm font-bold text-slate-100">{selectedGroup?.label || selectedFile?.relative_path || 'None'}</p>
            {selectedFile && <p className="mt-1 text-xs text-slate-500">{selectedFile.source_printer_name} variant</p>}
            {selectedGroup?.variants?.length > 1 && (
              <StatusPill tone="blue" icon={Package} className="mt-3">{selectedGroup.variants.length} printer variants</StatusPill>
            )}
          </div>

          {selectedGroup && selectedGroup.variants.length > 1 && (
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Printer Variants</p>
              <div className="space-y-2">
                {selectedGroup.variants.map((variant) => (
                  <button
                    key={variant.path}
                    type="button"
                    onClick={() => setSelectedPath(variant.path)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs ${variant.path === selectedPath ? 'border-blue-500/40 bg-blue-500/10 text-blue-100' : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-600'}`}
                  >
                    <span className="min-w-0 flex-1 truncate font-semibold">{variant.source_printer_name}</span>
                    <span className="shrink-0 text-[9px] font-bold uppercase text-slate-500">{formatBytes(variant.size)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedFile && (
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <Package size={13} />
                  Filament
                </p>
                <span className="text-[10px] font-bold uppercase text-slate-400">
                  {formatWeight(estimatedFilamentG)}
                </span>
              </div>
              <select
                value={selectedSpoolId}
                onChange={(event) => setSelectedSpoolId(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs outline-none focus:border-blue-500"
              >
                <option value="">Auto: loaded spool on target</option>
                {spools.filter((spool) => spool.status === 'active').map((spool) => (
                  <option key={spool.id} value={spool.id}>
                    {spool.name} - {Math.round(spool.remaining_weight_g)}g left
                  </option>
                ))}
              </select>
              {selectedSpool ? (
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase text-slate-500">
                    <span>{selectedSpool.material}{selectedSpool.printer_name ? ` on ${selectedSpool.printer_name}` : ''}</span>
                    <span>{Math.round(selectedSpool.remaining_weight_g)}g left</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full ${selectedSpool.remaining_percent < 15 ? 'bg-red-400' : selectedSpool.remaining_percent < 30 ? 'bg-orange-400' : 'bg-green-400'}`}
                      style={{ width: `${Math.max(0, Math.min(100, selectedSpool.remaining_percent))}%` }}
                    />
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-[10px] font-semibold uppercase text-slate-500">
                  The backend will deduct from each target printer's loaded spool when available.
                </p>
              )}
            </div>
          )}

          <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Print Targets</p>
              <button onClick={() => setSelectedTargetIds(compatibleTargetIds)} className="text-[10px] font-bold uppercase text-green-300 hover:text-green-200">
                Select fits
              </button>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {targets.map((target) => {
                const fit = compatibility[target.id] || { status: 'unknown', message: 'No fit data' };
                const disabled = !target.assigned_node_id || !target.moonraker_port;
                return (
                  <label key={target.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${selectedTargetIds.includes(target.id) ? 'border-blue-500/40 bg-blue-500/10' : 'border-slate-800 bg-slate-950/60'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selectedTargetIds.includes(target.id)}
                      disabled={disabled}
                      onChange={() => toggleTarget(target.id)}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-900"
                    />
                    <span className="min-w-0 flex-1 truncate font-semibold text-slate-200">{target.name}</span>
                    <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase ${fitTone(fit.status)}`}>
                      {fit.status === 'too_large' ? 'size' : fit.status}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handlePrint(selectedTargetIds)}
              disabled={printing || !selectedFile || selectedTargetIds.length === 0}
              className="inline-flex min-h-11 items-center justify-center space-x-2 rounded-lg bg-green-600 px-3 py-2 text-[10px] font-bold uppercase text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {printing ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              <span>Selected</span>
            </button>
            <button
              onClick={() => handlePrint(compatibleTargetIds, true)}
              disabled={printing || !selectedFile || compatibleTargetIds.length === 0}
              className="inline-flex min-h-11 items-center justify-center space-x-2 rounded-lg bg-cyan-600 px-3 py-2 text-[10px] font-bold uppercase text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {printing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
              <span>Fits</span>
            </button>
          </div>

          <button
            onClick={() => handleDelete(selectedFile)}
            disabled={!selectedFile || deletingPath === selectedFile?.path}
            className="inline-flex w-full items-center justify-center space-x-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] font-bold uppercase text-red-300 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deletingPath === selectedFile?.path ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            <span>Delete File</span>
          </button>

          {selectedFile?.analysis?.has_bounds && (
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
                <p className="font-bold uppercase text-slate-500">X</p>
                <p className="font-mono text-slate-300">{selectedFile.analysis.min_x.toFixed(1)} - {selectedFile.analysis.max_x.toFixed(1)}</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
                <p className="font-bold uppercase text-slate-500">Y</p>
                <p className="font-mono text-slate-300">{selectedFile.analysis.min_y.toFixed(1)} - {selectedFile.analysis.max_y.toFixed(1)}</p>
              </div>
            </div>
          )}
        </Panel>
      </div>
      <ConfirmActionModal
        isOpen={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        onConfirm={runConfirmedAction}
        title={confirmAction?.title}
        actionLabel={confirmAction?.actionLabel}
        itemName={confirmAction?.file?.name || selectedFile?.name}
        description={confirmAction?.description}
        consequences={confirmAction?.consequences || []}
        requireText={confirmAction?.requireText}
        confirmVariant={confirmAction?.confirmVariant || 'danger'}
        busy={Boolean(deletingPath) || printing}
      />
    </div>
  );
};

export default GcodeHub;
