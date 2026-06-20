import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  HelpCircle,
  Info,
  Loader2,
  Search,
} from 'lucide-react';

export const cn = (...classes) => classes.filter(Boolean).join(' ');

const toneStyles = {
  slate: 'border-slate-700/80 bg-slate-800/80 text-slate-200',
  blue: 'border-blue-500/25 bg-blue-500/10 text-blue-200',
  cyan: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200',
  green: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
  amber: 'border-amber-500/25 bg-amber-500/10 text-amber-200',
  orange: 'border-orange-500/25 bg-orange-500/10 text-orange-200',
  red: 'border-red-500/25 bg-red-500/10 text-red-200',
  purple: 'border-violet-500/25 bg-violet-500/10 text-violet-200',
};

const buttonStyles = {
  primary: 'border-blue-500/50 bg-blue-600 text-white shadow-lg shadow-blue-950/25 hover:bg-blue-500',
  secondary: 'border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-600 hover:bg-slate-750',
  subtle: 'border-transparent bg-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-100',
  success: 'border-emerald-500/40 bg-emerald-600 text-white shadow-lg shadow-emerald-950/20 hover:bg-emerald-500',
  warning: 'border-amber-500/35 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20',
  danger: 'border-red-500/35 bg-red-500/10 text-red-200 hover:bg-red-500/20',
};

const statusToneMap = {
  assigned: 'green',
  configured: 'green',
  online: 'green',
  ready: 'green',
  idle: 'green',
  complete: 'green',
  completed: 'green',
  success: 'green',
  printing: 'blue',
  running: 'blue',
  updating: 'blue',
  rebooting: 'blue',
  restarting: 'blue',
  restarting_services: 'blue',
  starting: 'blue',
  queued: 'amber',
  connecting: 'amber',
  warning: 'amber',
  installing: 'amber',
  discovered: 'amber',
  unassigned: 'amber',
  identity_unknown: 'amber',
  offline: 'red',
  error: 'red',
  failed: 'red',
  critical: 'red',
  cancelled: 'slate',
  unknown: 'slate',
};

const statusIconMap = {
  green: CheckCircle2,
  blue: Loader2,
  amber: AlertTriangle,
  orange: AlertTriangle,
  red: AlertTriangle,
  slate: Circle,
  cyan: Info,
  purple: Info,
};

export const StatusPill = ({ children, status, tone, pulse = false, icon: Icon, className = '', title, ...props }) => {
  const resolvedTone = tone || statusToneMap[String(status || '').toLowerCase()] || 'slate';
  const FallbackIcon = statusIconMap[resolvedTone] || Circle;
  const DisplayIcon = Icon === false ? null : (Icon || FallbackIcon);

  return (
    <span className={cn(
      'inline-flex min-h-[28px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide',
      toneStyles[resolvedTone] || toneStyles.slate,
      className,
    )} title={title} {...props}>
      {DisplayIcon && <DisplayIcon size={13} className={cn(pulse || resolvedTone === 'blue' ? 'animate-pulse' : '', 'shrink-0')} />}
      <span className="truncate">{children || status || 'Unknown'}</span>
    </span>
  );
};

export const ToolbarButton = ({
  children,
  icon: Icon,
  variant = 'secondary',
  size = 'md',
  className = '',
  busy = false,
  ...props
}) => {
  const sizes = {
    sm: 'h-8 px-3 text-[11px]',
    md: 'h-10 px-4 text-sm',
    lg: 'h-11 px-5 text-sm',
    icon: 'h-10 w-10 justify-center px-0',
  };

  return (
    <button
      type="button"
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border font-bold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        sizes[size] || sizes.md,
        buttonStyles[variant] || buttonStyles.secondary,
        className,
      )}
      {...props}
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : Icon ? <Icon size={16} /> : null}
      {children && <span className="truncate">{children}</span>}
    </button>
  );
};

export const PageHeader = ({
  eyebrow,
  title,
  description,
  children,
  actions,
  className = '',
}) => (
  <header className={cn('mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between', className)}>
    <div className="min-w-0">
      {eyebrow && <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-300">{eyebrow}</p>}
      <h2 className="text-2xl font-bold tracking-tight text-slate-50 md:text-[28px]">{title}</h2>
      {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{description}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

export const Panel = ({
  title,
  description,
  icon: Icon,
  actions,
  children,
  className = '',
  bodyClassName = '',
  padded = true,
}) => (
  <section className={cn('overflow-hidden rounded-lg border border-slate-700/80 bg-slate-850/80 shadow-xl shadow-black/10', className)}>
    {(title || actions) && (
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/70 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon size={18} className="shrink-0 text-blue-300" />}
          <div className="min-w-0">
            {title && <h3 className="truncate text-sm font-bold text-slate-100">{title}</h3>}
            {description && <p className="mt-0.5 truncate text-xs text-slate-500">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    )}
    <div className={cn(padded ? 'p-4' : '', bodyClassName)}>{children}</div>
  </section>
);

export const MetricCard = ({ label, value, helper, icon: Icon, tone = 'slate', className = '' }) => (
  <div className={cn('rounded-lg border p-4', toneStyles[tone] || toneStyles.slate, className)}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">{label}</p>
        <p className="mt-2 truncate text-2xl font-bold tabular-nums text-slate-50">{value}</p>
      </div>
      {Icon && <Icon size={20} className="shrink-0 opacity-70" />}
    </div>
    {helper && <p className="mt-2 text-xs leading-5 opacity-75">{helper}</p>}
  </div>
);

export const EmptyState = ({ icon: Icon = Info, title, description, action }) => (
  <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
    <Icon size={34} className="mb-3 text-slate-600" />
    <p className="font-bold text-slate-300">{title}</p>
    {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const HelpText = ({ children, icon: Icon = Info, className = '' }) => (
  <p className={cn('flex items-start gap-2 text-xs leading-5 text-slate-500', className)}>
    {Icon && <Icon size={14} className="mt-0.5 shrink-0 text-blue-300/80" />}
    <span>{children}</span>
  </p>
);

export const HelpIcon = ({ label }) => (
  <HelpCircle
    size={14}
    className="inline-block shrink-0 text-slate-500"
    title={label}
    aria-label={label}
  />
);

export const SearchBox = ({ value, onChange, placeholder = 'Search...', className = '' }) => (
  <div className={cn('relative min-w-0', className)}>
    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="app-input w-full pl-9"
    />
  </div>
);

export const DetailGrid = ({ items, className = '' }) => (
  <div className={cn('grid grid-cols-1 gap-2 sm:grid-cols-2', className)}>
    {items.filter(Boolean).map((item) => (
      <div key={item.label} className="min-w-0 rounded-lg border border-slate-700/70 bg-slate-900/45 p-3">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{item.label}</p>
        <p className={cn('mt-1 truncate text-sm font-semibold text-slate-200', item.mono && 'font-mono text-[12px]')}>
          {item.value || '--'}
        </p>
        {item.helper && <p className="mt-1 text-[10px] leading-4 text-slate-500">{item.helper}</p>}
      </div>
    ))}
  </div>
);

export const ProgressBar = ({ value, tone = 'blue', className = '' }) => {
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  const fill = {
    blue: 'bg-blue-400',
    green: 'bg-emerald-400',
    amber: 'bg-amber-400',
    red: 'bg-red-400',
  }[tone] || 'bg-blue-400';

  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-slate-950/80', className)}>
      <div className={cn('h-full rounded-full transition-all duration-700', fill)} style={{ width: `${percent}%` }} />
    </div>
  );
};
