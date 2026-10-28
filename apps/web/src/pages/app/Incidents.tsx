import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import type { IncidentSummary } from '@breakglass/shared';
import { api } from '../../lib/api';
import { useWorkspaceId } from '../../lib/auth';
import { Button, Card, EmptyState, ErrorState, LoadingBlock } from '../../components/ui';
import { IncidentStatusBadge, SeverityBadge } from '../../components/HealthBadge';
import { formatDateTime, formatDuration, relativeTime } from '../../lib/format';

type StatusFilter = 'active' | 'open' | 'acknowledged' | 'recovering' | 'resolved' | 'all';

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'open', label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

export default function Incidents() {
  const workspaceId = useWorkspaceId();
  const [params] = useSearchParams();
  const projectId = params.get('projectId') ?? undefined;
  const [status, setStatus] = useState<StatusFilter>('active');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['incidents', workspaceId, status, projectId],
    queryFn: () =>
      api.get<{ items: IncidentSummary[]; nextCursor: string | null }>(
        `/workspaces/${workspaceId}/incidents?status=${status}&limit=50${projectId ? `&projectId=${projectId}` : ''}`,
      ),
    enabled: Boolean(workspaceId),
    refetchInterval: 30_000,
  });

  const incidents = data?.items ?? [];
  const counts = useMemo(
    () => ({
      active: incidents.filter((incident) => incident.status !== 'resolved').length,
    }),
    [incidents],
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Incidents</p>
          <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-ink-900">
            Every failure, grouped
          </h1>
          <p className="mt-1 text-[13px] text-ink-500">
            One incident per ongoing problem. Continued failures update the existing record instead of creating new ones.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg border border-paper-300 bg-paper-50 p-0.5" role="tablist" aria-label="Incident status filter">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              role="tab"
              aria-selected={status === filter.value}
              onClick={() => setStatus(filter.value)}
              className={
                'rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ' +
                (status === filter.value ? 'bg-ink-900 text-paper-50' : 'text-ink-500 hover:text-ink-900')
              }
            >
              {filter.label}
              {filter.value === 'active' && counts.active > 0 ? (
                <span className="ml-1.5 rounded-full bg-white/20 px-1.5 text-[10.5px]">{counts.active}</span>
              ) : null}
            </button>
          ))}
        </div>
      </header>

      {isError ? (
        <ErrorState title="Could not load incidents" message={(error as Error).message} action={<Button size="sm" onClick={() => void refetch()}>Try again</Button>} />
      ) : null}

      {isLoading ? (
        <Card className="p-5">
          <LoadingBlock rows={5} />
        </Card>
      ) : incidents.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldCheck className="h-7 w-7" />}
            title={status === 'active' ? 'No active incidents' : 'No incidents in this view'}
            description={
              status === 'active'
                ? 'Everything is passing its configured thresholds. Failures that stay below the threshold appear as “suspicious” on the project page.'
                : 'Try a different filter to see incident history.'
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-paper-200">
            {incidents.map((incident) => (
              <li key={incident.id}>
                <Link to={`/app/incidents/${incident.id}`} className="block px-5 py-4 transition-colors hover:bg-paper-100">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <IncidentStatusBadge status={incident.status} />
                        <SeverityBadge severity={incident.severity} />
                        <span className="text-[11.5px] uppercase tracking-[0.1em] text-ink-400">{incident.checkType}</span>
                      </div>
                      <p className="mt-2 text-[13.5px] font-medium text-ink-900">{incident.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-500">{incident.summary}</p>
                      <p className="mt-1.5 text-[11.5px] text-ink-400">
                        {incident.projectName} · {incident.checkName} · first failure {formatDateTime(incident.firstFailureAt)} ·{' '}
                        {incident.failureCount} failed {incident.failureCount === 1 ? 'check' : 'checks'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      <div>
                        <p className="tabular text-[13px] font-medium text-ink-900">{formatDuration(incident.durationMs)}</p>
                        <p className="text-[11px] text-ink-400">
                          {incident.resolvedAt ? 'duration' : `open ${relativeTime(incident.firstFailureAt)}`}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-ink-300" aria-hidden />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
