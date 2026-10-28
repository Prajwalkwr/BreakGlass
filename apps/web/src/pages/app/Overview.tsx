import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  CircleSlash,
  Globe2,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  CheckCircle2,
} from 'lucide-react';
import type { DashboardStats } from '@breakglass/shared';
import { api } from '../../lib/api';
import { useAuth, useWorkspaceId } from '../../lib/auth';
import { formatDateTime, formatDuration, relativeTime, hostnameOf, categoryLabel } from '../../lib/format';
import { Button, Card, CardHeader, EmptyState, ErrorState, InlineNotice, LoadingBlock, Skeleton } from '../../components/ui';
import { IncidentStatusBadge, SeverityBadge } from '../../components/HealthBadge';

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  loading,
  tone = 'default',
  to,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: typeof Globe2;
  loading?: boolean;
  tone?: 'default' | 'critical' | 'warning';
  to?: string;
}) {
  const content = (
    <div className="group flex h-full flex-col justify-between gap-6 p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">{label}</p>
        <Icon
          className={
            tone === 'critical' ? 'h-4 w-4 text-state-critical' : tone === 'warning' ? 'h-4 w-4 text-state-warning' : 'h-4 w-4 text-ink-300'
          }
          aria-hidden
        />
      </div>
      <div>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <p className="tabular text-[28px] font-semibold leading-none tracking-[-0.02em] text-ink-900">{value}</p>
        )}
        {hint ? <p className="mt-2 text-[12px] leading-relaxed text-ink-400">{hint}</p> : null}
      </div>
    </div>
  );

  const className =
    'surface overflow-hidden transition-all duration-300 ease-smooth' +
    (to ? ' hover:-translate-y-0.5 hover:border-ink-300 hover:shadow-lift' : '');

  return to ? (
    <Link to={to} className={className}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

export default function Overview() {
  const workspaceId = useWorkspaceId();
  const { activeWorkspace, user } = useAuth();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['dashboard', workspaceId],
    queryFn: () => api.get<{ stats: DashboardStats }>(`/workspaces/${workspaceId}/dashboard`),
    enabled: Boolean(workspaceId),
    refetchInterval: 30_000,
  });

  const stats = data?.stats;
  const isNewWorkspace = !isLoading && stats && stats.projectCount === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Agency overview</p>
          <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-ink-900">
            {greeting()}, {user?.name?.split(' ')[0] ?? 'there'}
          </h1>
          <p className="mt-1 text-[13px] text-ink-500">
            {activeWorkspace?.name} · updates every 30 seconds
            {stats?.last24h ? ` · ${stats.last24h.runs} checks in the last 24 hours` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className={isFetching ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />}
            onClick={() => void refetch()}
          >
            Refresh
          </Button>
          <Link
            to="/app/projects/new"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-900 bg-ink-900 px-3 text-[13px] font-medium text-paper-50 transition-colors hover:bg-ink-800"
          >
            Add website
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {isError ? (
        <ErrorState
          title="Could not load your overview"
          message={(error as Error).message}
          action={<Button size="sm" onClick={() => void refetch()}>Try again</Button>}
        />
      ) : null}

      {stats?.workspaceNotice ? (
        <InlineNotice tone="warning">
          <strong className="font-medium">Email alerts are not configured.</strong> {stats.workspaceNotice}
        </InlineNotice>
      ) : null}

      {isNewWorkspace ? (
        <Card>
          <div className="px-6 py-14 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-paper-300 bg-paper-100 text-ink-700">
              <Globe2 className="h-5 w-5" />
            </div>
            <h2 className="mt-5 text-[17px] font-semibold text-ink-900">Add your first client website</h2>
            <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-ink-500">
              Point BreakGlass at a public URL, configure what a healthy response looks like, and
              activate monitoring. Checks run from our workers — not your browser.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Link
                to="/app/projects/new"
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-ink-900 bg-ink-900 px-6 text-[15px] font-medium text-paper-50 transition-colors hover:bg-ink-800"
              >
                Add website
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/app/settings?tab=notifications"
                className="inline-flex h-12 items-center rounded-xl border border-paper-400 bg-paper-50 px-6 text-[15px] font-medium text-ink-800 transition-colors hover:border-ink-400"
              >
                Set alert destinations
              </Link>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Projects"
              value={stats?.projectCount ?? 0}
              hint={`${stats?.enabledCheckCount ?? 0} active checks`}
              icon={Globe2}
              loading={isLoading}
              to="/app/projects"
            />
            <StatCard
              label="Healthy checks"
              value={stats?.healthyCheckCount ?? 0}
              hint={
                stats && stats.failingCheckCount > 0
                  ? `${stats.failingCheckCount} currently failing`
                  : 'All checks passing'
              }
              icon={CheckCircle2}
              loading={isLoading}
            />
            <StatCard
              label="Active incidents"
              value={stats?.activeIncidentCount ?? 0}
              hint={stats?.openIncidentCount ? `${stats.openIncidentCount} unacknowledged` : 'Nothing open'}
              icon={ShieldAlert}
              loading={isLoading}
              tone={stats?.activeIncidentCount ? 'critical' : 'default'}
              to="/app/incidents"
            />
            <StatCard
              label="Needs attention"
              value={(stats?.pausedCheckCount ?? 0) + (stats?.misconfiguredCheckCount ?? 0)}
              hint={`${stats?.pausedCheckCount ?? 0} paused · ${stats?.misconfiguredCheckCount ?? 0} misconfigured`}
              icon={TriangleAlert}
              loading={isLoading}
              tone={(stats?.misconfiguredCheckCount ?? 0) > 0 ? 'warning' : 'default'}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader
                title="Recent incidents"
                description="Grouped per check — one incident per ongoing problem."
                action={
                  <Link to="/app/incidents" className="link-underline text-[12.5px]">
                    All incidents
                  </Link>
                }
              />
              {isLoading ? (
                <LoadingBlock rows={4} className="p-5" />
              ) : stats?.recentIncidents.length ? (
                <ul className="divide-y divide-paper-200">
                  {stats.recentIncidents.map((incident) => (
                    <li key={incident.id}>
                      <Link
                        to={`/app/incidents/${incident.id}`}
                        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 transition-colors hover:bg-paper-100"
                      >
                        <IncidentStatusBadge status={incident.status} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-ink-900">{incident.title}</span>
                          <span className="block truncate text-[12px] text-ink-400">
                            {incident.projectName} · {incident.checkName} · first failure {relativeTime(incident.firstFailureAt)}
                          </span>
                        </span>
                        <SeverityBadge severity={incident.severity} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={<CircleSlash className="h-6 w-6" />}
                  title="No incidents recorded"
                  description="When a check fails past its threshold, the incident appears here with its evidence and timeline."
                />
              )}
            </Card>

            <Card>
              <CardHeader
                title="Monitoring activity"
                description="Latest check runs across this workspace."
                action={
                  <Link to="/app/projects" className="link-underline text-[12.5px]">
                    Projects
                  </Link>
                }
              />
              {isLoading ? (
                <LoadingBlock rows={5} className="p-5" />
              ) : stats?.recentRuns.length ? (
                <ul className="divide-y divide-paper-200">
                  {stats.recentRuns.slice(0, 8).map((run) => (
                    <li key={run.id} className="flex items-center gap-3 px-5 py-2.5">
                      <span
                        className={
                          'h-1.5 w-1.5 shrink-0 rounded-full ' + (run.success ? 'bg-state-healthy' : 'bg-state-critical')
                        }
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium text-ink-800">{run.checkName}</p>
                        <p className="truncate text-[11.5px] text-ink-400">
                          {run.projectName} · {run.success ? 'passed' : categoryLabel(run.failureCategory)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="tabular text-[11.5px] text-ink-500">{formatDuration(run.durationMs)}</p>
                        <p className="text-[11px] text-ink-300">{relativeTime(run.startedAt)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={<Activity className="h-6 w-6" />}
                  title="No checks have run yet"
                  description="Activate a check and the scheduler will queue the first run within a few seconds."
                />
              )}
              <div className="border-t border-paper-200 px-5 py-3 text-[11.5px] text-ink-400">
                Last updated {formatDateTime(new Date().toISOString(), user?.timezone)}
                {stats && stats.checksDueSoon > 0 ? ` · ${stats.checksDueSoon} ${stats.checksDueSoon === 1 ? 'check' : 'checks'} due within 10 minutes` : ''}
              </div>
            </Card>
          </div>

          <Card className="bg-paper-50">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="text-[13px] font-medium text-ink-900">How detection timing actually works</p>
                <p className="mt-0.5 max-w-2xl text-[12.5px] leading-relaxed text-ink-500">
                  A five-minute interval means checks start every five minutes — a site can fail
                  immediately after a passing check, and retries or delivery add a little more time.
                  Incidents open only after your configured failure threshold is reached.
                </p>
              </div>
              <Link
                to="/app/settings?tab=notifications"
                className="inline-flex h-8 items-center rounded-lg border border-paper-400 bg-paper-50 px-3 text-[13px] font-medium text-ink-800 transition-colors hover:border-ink-400"
              >
                Alert destinations
              </Link>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
