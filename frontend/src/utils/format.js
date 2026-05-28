export const clampPercent = (value) => Math.min(100, Math.max(0, Number(value) || 0));

export const formatLastSeen = (value) => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 20) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

export const formatPercent = (value) => {
  const percent = clampPercent(value);
  return `${percent.toFixed(percent < 10 ? 1 : 0)}%`;
};

export const formatMb = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '';
  if (number >= 1024) return `${(number / 1024).toFixed(number >= 10240 ? 0 : 1)} GB`;
  return `${number.toFixed(0)} MB`;
};

export const formatUptime = (value, secondsValue) => {
  let seconds = Number(secondsValue);
  if (!Number.isFinite(seconds) && typeof value === 'string') {
    const match = value.match(/^(\d+)s$/);
    if (match) seconds = Number(match[1]);
  }
  if (!Number.isFinite(seconds)) return value || 'Unknown';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
};
