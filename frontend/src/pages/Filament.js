import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Loader2, Package, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { MetricCard, PageHeader, Panel, ToolbarButton } from '../components/DesignSystem';
import { ConfirmActionModal } from '../components/UI';

const emptyForm = {
  name: '',
  material: 'PLA',
  brand: '',
  colour: '',
  diameter_mm: 1.75,
  density_g_cm3: 1.24,
  initial_weight_g: 1000,
  remaining_weight_g: 1000,
  empty_spool_weight_g: 0,
  printer_id: '',
  status: 'active',
  notes: '',
};

const materialDensity = {
  PLA: 1.24,
  PETG: 1.27,
  ABS: 1.04,
  ASA: 1.07,
  TPU: 1.21,
  NYLON: 1.14,
};

const formatWeight = (value) => {
  const grams = Number(value) || 0;
  if (grams >= 1000) return `${(grams / 1000).toFixed(2)} kg`;
  return `${grams.toFixed(0)} g`;
};

const barColour = (percent) => {
  if (percent < 15) return 'bg-red-400';
  if (percent < 30) return 'bg-orange-400';
  return 'bg-green-400';
};

const Filament = ({ addToast }) => {
  const [spools, setSpools] = useState([]);
  const [printers, setPrinters] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [adjustments, setAdjustments] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [spoolRes, printerRes] = await Promise.all([
        axios.get('/api/filaments/spools'),
        axios.get('/api/printers'),
      ]);
      setSpools(spoolRes.data || []);
      setPrinters(printerRes.data || []);
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to load filament inventory', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const summary = useMemo(() => {
    const active = spools.filter((spool) => spool.status === 'active');
    const remaining = active.reduce((sum, spool) => sum + (Number(spool.remaining_weight_g) || 0), 0);
    const low = active.filter((spool) => Number(spool.remaining_percent) < 15).length;
    return { active: active.length, remaining, low };
  }, [spools]);

  const updateMaterial = (material) => {
    setForm((current) => ({
      ...current,
      material,
      density_g_cm3: materialDensity[material] || current.density_g_cm3,
    }));
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const editSpool = (spool) => {
    setEditingId(spool.id);
    setForm({
      name: spool.name || '',
      material: spool.material || 'PLA',
      brand: spool.brand || '',
      colour: spool.colour || '',
      diameter_mm: spool.diameter_mm || 1.75,
      density_g_cm3: spool.density_g_cm3 || 1.24,
      initial_weight_g: spool.initial_weight_g || 1000,
      remaining_weight_g: spool.remaining_weight_g || 0,
      empty_spool_weight_g: spool.empty_spool_weight_g || 0,
      printer_id: spool.printer_id ? String(spool.printer_id) : '',
      status: spool.status || 'active',
      notes: spool.notes || '',
    });
  };

  const payloadFromForm = () => ({
    ...form,
    diameter_mm: Number(form.diameter_mm),
    density_g_cm3: Number(form.density_g_cm3),
    initial_weight_g: Number(form.initial_weight_g),
    remaining_weight_g: Number(form.remaining_weight_g),
    empty_spool_weight_g: Number(form.empty_spool_weight_g),
    printer_id: form.printer_id ? Number(form.printer_id) : null,
  });

  const saveSpool = async () => {
    if (!form.name.trim()) {
      addToast('Spool name is required', 'info');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await axios.put(`/api/filaments/spools/${editingId}`, payloadFromForm());
        addToast('Spool updated', 'success');
      } else {
        await axios.post('/api/filaments/spools', payloadFromForm());
        addToast('Spool added', 'success');
      }
      resetForm();
      await refresh();
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to save spool', 'error');
    } finally {
      setSaving(false);
    }
  };

  const performDeleteSpool = async (spool) => {
    try {
      await axios.delete(`/api/filaments/spools/${spool.id}`);
      addToast('Spool deleted', 'success');
      await refresh();
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to delete spool', 'error');
    }
  };

  const deleteSpool = (spool) => {
    setConfirmAction({
      action: 'delete_spool',
      spool,
      title: 'Delete Filament Spool',
      actionLabel: 'Delete Spool',
      description: 'This removes the spool record and its remaining material estimate.',
      consequences: [
        `${spool.name} will be removed from filament inventory.`,
        'Print-start usage deductions can no longer apply to this spool.',
      ],
      requireText: 'DELETE',
      confirmVariant: 'danger',
    });
  };

  const adjustSpool = async (spool, direction) => {
    const value = Number(adjustments[spool.id]);
    if (!value || value <= 0) {
      addToast('Enter a gram amount first', 'info');
      return;
    }
    try {
      await axios.post(`/api/filaments/spools/${spool.id}/adjust`, {
        delta_g: direction === 'add' ? value : -value,
        note: direction === 'add' ? 'Manual filament added' : 'Manual filament used',
      });
      setAdjustments((current) => ({ ...current, [spool.id]: '' }));
      addToast('Spool adjusted', 'success');
      await refresh();
    } catch (err) {
      addToast(err.response?.data?.detail || 'Adjustment failed', 'error');
    }
  };

  const runConfirmedAction = async () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (action?.action === 'delete_spool') await performDeleteSpool(action.spool);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Print Prep"
        title="Filament"
        description="Track loaded spools, remaining material, and print-start usage deductions."
        actions={<ToolbarButton icon={RefreshCw} variant="secondary" busy={loading} onClick={refresh}>Refresh</ToolbarButton>}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard label="Active spools" value={summary.active} helper="Available inventory" icon={Package} tone="green" />
        <MetricCard label="Remaining filament" value={formatWeight(summary.remaining)} helper="Across active spools" icon={Package} tone="blue" />
        <MetricCard label="Low spools" value={summary.low} helper="Below 15 percent" icon={Package} tone={summary.low > 0 ? 'amber' : 'slate'} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Panel title={editingId ? 'Edit Spool' : 'Add Spool'} description="Material, colour, weight, and loaded printer" icon={Plus}>
          <div className="space-y-3">
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Spool name" className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm outline-none focus:border-blue-500" />
            <div className="grid grid-cols-2 gap-3">
              <select value={form.material} onChange={(event) => updateMaterial(event.target.value)} className="h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm">
                {Object.keys(materialDensity).map((material) => <option key={material} value={material}>{material}</option>)}
              </select>
              <input value={form.colour} onChange={(event) => setForm({ ...form, colour: event.target.value })} placeholder="Colour" className="h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm outline-none focus:border-blue-500" />
            </div>
            <input value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} placeholder="Brand" className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm outline-none focus:border-blue-500" />
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-500">Starting grams</span>
                <input type="number" value={form.initial_weight_g} onChange={(event) => setForm({ ...form, initial_weight_g: event.target.value, remaining_weight_g: editingId ? form.remaining_weight_g : event.target.value })} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-500">Remaining grams</span>
                <input type="number" value={form.remaining_weight_g} onChange={(event) => setForm({ ...form, remaining_weight_g: event.target.value })} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-500">Diameter</span>
                <input type="number" step="0.01" value={form.diameter_mm} onChange={(event) => setForm({ ...form, diameter_mm: event.target.value })} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-500">Density</span>
                <input type="number" step="0.01" value={form.density_g_cm3} onChange={(event) => setForm({ ...form, density_g_cm3: event.target.value })} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm" />
              </label>
            </div>
            <select value={form.printer_id} onChange={(event) => setForm({ ...form, printer_id: event.target.value })} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm">
              <option value="">Not loaded</option>
              {printers.map((printer) => <option key={printer.id} value={printer.id}>Loaded on {printer.name}</option>)}
            </select>
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm">
              <option value="active">Active</option>
              <option value="empty">Empty</option>
              <option value="archived">Archived</option>
            </select>
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={3} placeholder="Notes" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={saveSpool} disabled={saving} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-bold hover:bg-blue-700 disabled:opacity-60">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save
              </button>
              <button onClick={resetForm} className="h-10 rounded-lg border border-slate-700 bg-slate-900 text-sm font-bold text-slate-300 hover:bg-slate-700">
                Clear
              </button>
            </div>
          </div>
        </Panel>

        <Panel title="Spools" description="Inventory and manual adjustments" icon={Package} padded={false}>
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 size={28} className="animate-spin text-blue-400" />
            </div>
          ) : spools.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No filament spools yet.</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 p-4 2xl:grid-cols-2">
              {spools.map((spool) => (
                <div key={spool.id} className="rounded-lg border border-slate-700 bg-slate-900 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-100">{spool.name}</p>
                      <p className="mt-1 text-[10px] font-bold uppercase text-slate-500">
                        {spool.material}{spool.colour ? ` | ${spool.colour}` : ''}{spool.printer_name ? ` | ${spool.printer_name}` : ''}
                      </p>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${spool.status === 'active' ? 'border-green-500/20 bg-green-500/10 text-green-300' : 'border-slate-600 bg-slate-800 text-slate-400'}`}>
                      {spool.status}
                    </span>
                  </div>
                  <div className="mt-4">
                    <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase text-slate-500">
                      <span>{formatWeight(spool.remaining_weight_g)} left</span>
                      <span>{spool.remaining_percent}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                      <div className={`h-full rounded-full ${barColour(spool.remaining_percent)}`} style={{ width: `${Math.max(0, Math.min(100, spool.remaining_percent))}%` }} />
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-[1fr_auto_auto] gap-2">
                    <input
                      type="number"
                      min="0"
                      placeholder="g"
                      value={adjustments[spool.id] || ''}
                      onChange={(event) => setAdjustments((current) => ({ ...current, [spool.id]: event.target.value }))}
                      className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm outline-none focus:border-blue-500"
                    />
                    <button onClick={() => adjustSpool(spool, 'use')} className="h-9 rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 text-xs font-bold text-orange-300 hover:bg-orange-500/20">
                      Use
                    </button>
                    <button onClick={() => adjustSpool(spool, 'add')} className="h-9 rounded-lg border border-green-500/20 bg-green-500/10 px-3 text-xs font-bold text-green-300 hover:bg-green-500/20">
                      Add
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button onClick={() => editSpool(spool)} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 text-xs font-bold text-slate-300 hover:bg-slate-700">
                      <Package size={14} />
                      Edit
                    </button>
                    <button onClick={() => deleteSpool(spool)} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 text-xs font-bold text-red-300 hover:bg-red-500/20">
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
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
        itemName={confirmAction?.spool?.name}
        description={confirmAction?.description}
        consequences={confirmAction?.consequences || []}
        requireText={confirmAction?.requireText}
        confirmVariant={confirmAction?.confirmVariant || 'danger'}
      />
    </div>
  );
};

export default Filament;
