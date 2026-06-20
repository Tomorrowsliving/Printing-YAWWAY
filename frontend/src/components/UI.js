import React, { useEffect, useMemo, useState } from 'react';
import { X, CheckCircle, AlertCircle, Info, ShieldAlert } from 'lucide-react';
import { ToolbarButton, cn } from './DesignSystem';

const ToastContainer = ({ toasts, removeToast }) => {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-md flex-col space-y-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'pointer-events-auto flex items-center rounded-lg border p-4 shadow-2xl shadow-black/30 backdrop-blur transition-all animate-in slide-in-from-right-full',
            toast.type === 'success' && 'border-emerald-500/30 bg-emerald-950/90 text-emerald-100',
            toast.type === 'error' && 'border-red-500/30 bg-red-950/90 text-red-100',
            toast.type !== 'success' && toast.type !== 'error' && 'border-slate-700 bg-slate-900/95 text-slate-100',
          )}
        >
          <div className="mr-3 shrink-0">
            {toast.type === 'success' ? <CheckCircle size={20} /> :
             toast.type === 'error' ? <AlertCircle size={20} /> :
             <Info size={20} />}
          </div>
          <p className="flex-1 text-sm font-medium">{toast.message}</p>
          <button onClick={() => removeToast(toast.id)} className="ml-3 p-1 hover:bg-white/10 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};

const Modal = ({ isOpen, onClose, title, children, footer }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-slate-700 bg-slate-950 shadow-2xl shadow-black/40 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between gap-4 border-b border-slate-800 p-5">
          <h3 className="min-w-0 truncate text-lg font-bold text-slate-50">{title}</h3>
          <ToolbarButton size="icon" variant="subtle" icon={X} onClick={onClose} aria-label="Close modal" />
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {children}
        </div>
        {footer && (
          <div className="rounded-b-lg border-t border-slate-800 bg-slate-900/60 p-5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

const ConfirmActionModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  actionLabel = 'Confirm',
  itemName,
  description,
  consequences = [],
  requireText,
  confirmVariant = 'danger',
  busy = false,
}) => {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (isOpen) setTyped('');
  }, [isOpen]);

  const expected = useMemo(() => String(requireText || '').trim(), [requireText]);
  const canConfirm = !expected || typed.trim() === expected;

  return (
    <Modal
      isOpen={isOpen}
      onClose={busy ? undefined : onClose}
      title={title}
      footer={(
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <ToolbarButton variant="secondary" onClick={onClose} disabled={busy}>Cancel</ToolbarButton>
          <ToolbarButton
            variant={confirmVariant}
            icon={ShieldAlert}
            busy={busy}
            disabled={!canConfirm || busy}
            onClick={onConfirm}
          >
            {actionLabel}
          </ToolbarButton>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-100">
          <p className="font-bold text-red-200">{itemName || title}</p>
          {description && <p className="mt-2 leading-6 text-red-100/80">{description}</p>}
        </div>

        {consequences.length > 0 && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">What will happen</p>
            <ul className="mt-3 space-y-2 text-sm leading-5 text-slate-300">
              {consequences.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {expected && (
          <label className="block space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Type {expected} to confirm
            </span>
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              className="app-input w-full"
              autoComplete="off"
              autoFocus
            />
          </label>
        )}
      </div>
    </Modal>
  );
};

export { ConfirmActionModal, Modal, ToastContainer };
