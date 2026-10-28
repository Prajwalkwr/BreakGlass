import type { FailureCategory, IncidentStatus, CheckRuntimeStatus } from '@breakglass/shared';

export function formatDateTime(iso: string | null | undefined, timezone?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || undefined,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function formatTime(iso: string | null | undefined, timezone?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || undefined,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 19);
  }
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const diff = Date.now() - then;
  const future = diff < 0;
  const abs = Math.abs(diff);

  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [1000, 'second'],
    [60_000, 'minute'],
    [3_600_000, 'hour'],
    [86_400_000, 'day'],
    [604_800_000, 'week'],
    [2_592_000_000, 'month'],
  ];

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  let value = Math.round(abs / 1000);
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  for (let i = units.length - 1; i >= 0; i -= 1) {
    if (abs >= units[i][0]) {
      value = Math.round(abs / units[i][0]);
      unit = units[i][1];
      break;
    }
  }
  return formatter.format(future ? value : -value, unit);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatIntervalLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? 'every minute' : `every ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'every hour' : `every ${hours} hours`;
}

export const STATUS_LABELS: Record<CheckRuntimeStatus, string> = {
  pending: 'Awaiting first run',
  healthy: 'Healthy',
  suspected: 'Suspicious',
  failing: 'Failing',
  paused: 'Paused',
  misconfigured: 'Configuration problem',
  auth_failure: 'Test login rejected',
  worker_error: 'Monitor error',
};

export const INCIDENT_LABELS: Record<IncidentStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  recovering: 'Recovery verifying',
  resolved: 'Resolved',
};

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function categoryLabel(category: FailureCategory | null): string {
  if (!category) return '—';
  return category.replace(/_/g, ' ');
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural ?? `${singular}s`;
}
