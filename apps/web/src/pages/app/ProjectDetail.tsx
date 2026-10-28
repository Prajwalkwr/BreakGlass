import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  GitBranch,
  Globe2,
  KeyRound,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { clsx } from 'clsx';
import type {
  CheckRunSummary,
  CheckSummary,
  DeploymentDto,
  IncidentSummary,
  PageScanReport,
  PageScanSnapshot,
  ProjectSummary,
} from '@breakglass/shared';
import { api, ApiRequestError } from '../../lib/api';
import { useWorkspaceId } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  InlineNotice,
  Input,
  LoadingBlock,
  Modal,
  Skeleton,
  Switch,
} from '../../components/ui';
import { CheckStatusBadge, IncidentStatusBadge, ProjectHealthBadge, SeverityBadge } from '../../components/HealthBadge';
import { CheckForm } from '../../components/check/CheckForm';
import { formatDateTime, formatDuration, formatIntervalLabel, relativeTime, categoryLabel, hostnameOf } from '../../lib/format';

interface ProjectDetailResponse {
  project: {
    id: string;
    name: string;
    url: string;
    clientName: string | null;
    notes: string | null;
    status: 'active' | 'paused';
    createdAt: string;
    health: ProjectSummary['health'];
    githubRepository: string | null;
  };
  checks: CheckSummary[];
  incidents: IncidentSummary[];
  deployments: DeploymentDto[];
  recentRuns: (CheckRunSummary & { checkName: string })[];
  responseTimeSeries: { at: string; durationMs: number; checkName: string }[];
  lastPageScan: PageScanSnapshot | null;
}

export default function ProjectDetail() {
  const { projectId = '' } = useParams();
  const workspaceId = useWorkspaceId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [showAddCheck, setShowAddCheck] = useState(false);
  const [editingCheck, setEditingCheck] = useState<CheckSummary | null>(null);
  const [showCredentials, setShowCredentials] = useState(false);
  const [showGithub, setShowGithub] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [runFilter, setRunFilter] = useState<'all' | 'failure'>('all');
  const [pageScanReport, setPageScanReport] = useState<PageScanReport | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['project', workspaceId, projectId],
    queryFn: () => api.get<ProjectDetailResponse>(`/workspaces/${workspaceId}/projects/${projectId}`),
    enabled: Boolean(workspaceId && projectId),
    refetchInterval: 20_000,
  });

  const toggleCheck = useMutation({
    mutationFn: async ({ check, enabled }: { check: CheckSummary; enabled: boolean }) =>
      api.patch(`/workspaces/${workspaceId}/checks/${check.id}`, { enabled }),
    onSuccess: async (_result, variables) => {
      toast.success(variables.enabled ? 'Check activated' : 'Check paused');
      await queryClient.invalidateQueries({ queryKey: ['project', workspaceId, projectId] });
    },
    onError: (caught) => toast.error('Could not update the check', (caught as Error).message),
  });

  const runNow = useMutation({
    mutationFn: (check: CheckSummary) =>
      api.post<{ success: boolean; failureMessage: string | null }>(`/workspaces/${workspaceId}/checks/${check.id}/run`),
    onSuccess: async (result) => {
      if (result.success) toast.success('Check passed');
      else toast.error('Check failed', result.failureMessage ?? undefined);
      await queryClient.invalidateQueries({ queryKey: ['project', workspaceId, projectId] });
    },
    onError: (caught) => toast.error('Could not run the check', (caught as Error).message),
  });

  const scanPages = useMutation({
    mutationFn: () =>
      api.post<PageScanReport>(`/workspaces/${workspaceId}/projects/${projectId}/scan`, {}),
    onSuccess: async (report) => {
      setPageScanReport(report);
      const failures = report.pages.filter((page) => !page.success).length;
      toast.success(
        'Page scan complete',
        `${report.pages.length} ${report.pages.length === 1 ? 'page' : 'pages'} scanned; ${failures} need attention; ${report.createdChecks} new checks scheduled; ${report.unscheduledPages} not monitored.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['project', workspaceId, projectId] });
    },
    onError: (caught) => toast.error('Could not scan pages', (caught as Error).message),
  });

  const toggleProject = useMutation({
    mutationFn: (status: 'active' | 'paused') =>
      api.patch(`/workspaces/${workspaceId}/projects/${projectId}`, { status }),
    onSuccess: async (_result, status) => {
      toast.success(status === 'paused' ? 'Project paused' : 'Project resumed');
      await queryClient.invalidateQueries({ queryKey: ['project', workspaceId, projectId] });
    },
  });

  const deleteProject = useMutation({
    mutationFn: () => api.del(`/workspaces/${workspaceId}/projects/${projectId}`),
    onSuccess: async () => {
      toast.success('Project deleted');
      await queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] });
      navigate('/app/projects');
    },
    onError: (caught) => toast.error('Could not delete the project', (caught as Error).message),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Card key={index} className="p-5">
              <LoadingBlock rows={2} />
            </Card>
          ))}
        </div>
        <Card className="p-5">
          <LoadingBlock rows={6} />
        </Card>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ErrorState
        title="Could not load this project"
        message={(error as Error)?.message}
        action={<Button size="sm" onClick={() => void refetch()}>Try again</Button>}
      />
    );
  }

  const { project, checks, incidents, deployments, recentRuns, responseTimeSeries } = data;
  const latestPageScan = pageScanReport ?? data.lastPageScan?.report ?? null;
  const activeIncidents = incidents.filter((incident) => incident.status !== 'resolved');
  const runs = runFilter === 'failure' ? recentRuns.filter((run) => !run.success) : recentRuns;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link to="/app/projects" className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-500 hover:text-ink-900">
          <ArrowLeft className="h-3.5 w-3.5" /> Projects
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink-900">{project.name}</h1>
            <ProjectHealthBadge health={project.health} />
            {project.status === 'paused' ? <Badge tone="neutral">Project paused</Badge> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-500">
            <a
              href={project.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 font-mono text-[12px] hover:text-ink-900"
            >
              {hostnameOf(project.url)}
              <ExternalLink className="h-3 w-3" />
            </a>
            {project.clientName ? <span>· {project.clientName}</span> : null}
            <span>· added {formatDateTime(project.createdAt)}</span>
          </div>
          {project.notes ? <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-ink-500">{project.notes}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className={isFetching ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />}
            onClick={() => void refetch()}
          >
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Globe2 className="h-3.5 w-3.5" />}
            onClick={() => scanPages.mutate()}
            loading={scanPages.isPending}
            disabled={project.status !== 'active'}
          >
            Scan pages
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={project.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            onClick={() => toggleProject.mutate(project.status === 'active' ? 'paused' : 'active')}
            loading={toggleProject.isPending}
          >
            {project.status === 'active' ? 'Pause project' : 'Resume project'}
          </Button>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setShowAddCheck(true)}>
            Add check
          </Button>
        </div>
      </header>

      {project.status === 'paused' ? (
        <InlineNotice tone="warning">
          This project is paused, so no checks are scheduled. Incident history and evidence are preserved.
        </InlineNotice>
      ) : null}

      {latestPageScan ? (
        <Card>
          <CardHeader
            title="Public page scan"
            description={`${data.lastPageScan ? `Last scanned ${formatDateTime(data.lastPageScan.scannedAt)}. ` : ''}Scheduled HTTP checks remain active. Scans passively inventory controls and page-load API calls; they do not click or submit.`}
          />
          <div className="space-y-3 p-5">
            {(latestPageScan.warnings ?? []).map((warning) => (
              <InlineNotice key={warning} tone="warning">{warning} Some scan details may be incomplete.</InlineNotice>
            ))}
            <div className="flex flex-wrap gap-2">
              <Badge tone="healthy" dot>
                {latestPageScan.pages.filter((page) => page.success).length}{' '}
                {latestPageScan.pages.filter((page) => page.success).length === 1 ? 'page' : 'pages'} responded
              </Badge>
              {latestPageScan.pages.some((page) => !page.success) ? (
                <Badge tone="critical" dot>{latestPageScan.pages.filter((page) => !page.success).length} need attention</Badge>
              ) : null}
              <Badge tone="neutral">{latestPageScan.createdChecks} new checks</Badge>
              {latestPageScan.activatedChecks ? (
                <Badge tone="neutral">{latestPageScan.activatedChecks} paused checks reactivated</Badge>
              ) : null}
              {latestPageScan.alreadyMonitored ? (
                <Badge tone="neutral">{latestPageScan.alreadyMonitored} already monitored</Badge>
              ) : null}
              {latestPageScan.unscheduledPages > 0 ? (
                <Badge tone="warning">{latestPageScan.unscheduledPages} pages scanned, not monitored</Badge>
              ) : null}
              {latestPageScan.truncated ? <Badge tone="warning">Stopped at 50 pages</Badge> : null}
            </div>
            <p className="text-[12px] leading-relaxed text-ink-500">
              Each page HTTP check runs every 30 minutes. Scanned controls and API calls are observations only; configure API assertions or browser journeys for recurring behavioral checks and incident alerts.
            </p>
            <div className="max-h-80 overflow-auto rounded-lg border border-paper-300">
              <table className="w-full text-left text-[12px]">
                <thead className="sticky top-0 bg-paper-100 text-ink-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Page</th>
                    <th className="px-3 py-2 font-medium">Result</th>
                    <th className="px-3 py-2 font-medium">Signals observed</th>
                    <th className="px-3 py-2 text-right font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper-200">
                  {latestPageScan.pages.map((page) => (
                    <tr key={page.url}>
                      <td className="max-w-[360px] truncate px-3 py-2 font-mono text-[11px]" title={page.url}>
                        {new URL(page.url).pathname}
                      </td>
                      <td className="px-3 py-2">
                        <span className={page.success ? 'text-state-healthy' : 'text-state-critical'}>
                          {page.httpStatus ? `HTTP ${page.httpStatus}` : page.failureCategory ?? 'Could not check'}
                        </span>
                        <span className="ml-2 text-ink-400">{page.checkName ? '· monitored' : ''}</span>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-ink-500">
                        {page.features ? (
                          <div>
                            {page.features.formCount} forms · {page.features.buttonCount} buttons · {page.features.fieldCount} fields · {page.features.linkCount} links · {page.features.apiCalls.length} API calls
                            {page.features.passwordFieldCount > 0 ? <span className="ml-1 text-ink-600">· password field found; authentication not tested</span> : null}
                            {page.features.runtimeErrorCount > 0 ? (
                              <span className="ml-1 text-state-critical">· {page.features.runtimeErrorCount} runtime errors</span>
                            ) : null}
                            {page.features.apiCalls.some((call) => call.status === null || call.status >= 400) ? (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-state-critical">API HTTP errors observed</summary>
                                <ul className="mt-1 space-y-0.5 font-mono">
                                  {page.features.apiCalls
                                    .filter((call) => call.status === null || call.status >= 400)
                                    .map((call) => (
                                      <li key={`${call.method}:${call.path}`}>{call.method} {call.path} · {call.status ?? 'no response'}</li>
                                    ))}
                                </ul>
                              </details>
                            ) : null}
                          </div>
                        ) : 'Not inspected'}
                      </td>
                      <td className="tabular px-3 py-2 text-right text-ink-500">{page.durationMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      ) : null}

      {activeIncidents.length > 0 ? (
        <div className="rounded-xl2 border border-[#efd2ce] bg-state-criticalSoft/50 p-4">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-state-critical" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-state-critical">
                {activeIncidents.length} active {activeIncidents.length === 1 ? 'incident' : 'incidents'}
              </p>
              <ul className="mt-2 space-y-1.5">
                {activeIncidents.map((incident) => (
                  <li key={incident.id}>
                    <Link to={`/app/incidents/${incident.id}`} className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-700 hover:text-ink-900">
                      <IncidentStatusBadge status={incident.status} />
                      <span className="font-medium">{incident.checkName}</span>
                      <span className="text-ink-400">· {incident.summary.slice(0, 90)}…</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        {/* Checks */}
        <Card>
          <CardHeader
            title="Checks"
            description={`${checks.filter((check) => check.enabled).length} of ${checks.length} active`}
            action={
              <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setShowAddCheck(true)}>
                Add
              </Button>
            }
          />
          {checks.length === 0 ? (
            <EmptyState
              title="No checks configured"
              description="Add an HTTP, API or browser journey check to start monitoring this site."
              action={<Button size="sm" onClick={() => setShowAddCheck(true)}>Add a check</Button>}
            />
          ) : (
            <ul className="divide-y divide-paper-200">
              {checks.map((check) => (
                <li key={check.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13.5px] font-medium text-ink-900">{check.name}</p>
                        <CheckStatusBadge status={check.runtimeStatus} />
                        <Badge tone="neutral" className="uppercase">{check.type}</Badge>
                      </div>
                      <p className="mt-1 text-[12px] text-ink-400">
                        {formatIntervalLabel(check.intervalSeconds)} · timeout {check.timeoutMs / 1000}s · opens an incident
                        after {check.failureThreshold} {check.failureThreshold === 1 ? 'failure' : 'failures'} · resolves after{' '}
                        {check.recoveryThreshold}
                      </p>
                      <p className="mt-1 text-[12px] text-ink-500">
                        {check.lastRunAt ? (
                          <>
                            Last run {relativeTime(check.lastRunAt)} · {formatDuration(check.lastResult?.durationMs)}
                            {check.lastResult && !check.lastResult.success ? (
                              <span className="text-state-critical"> · {categoryLabel(check.lastResult.failureCategory)}</span>
                            ) : null}
                            {check.enabled && check.nextRunAt ? <span className="text-ink-400"> · next {relativeTime(check.nextRunAt)}</span> : null}
                          </>
                        ) : (
                          <span className="text-ink-400">{check.enabled ? 'First run queued' : 'Not running'}</span>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => runNow.mutate(check)}
                        loading={runNow.isPending && runNow.variables?.id === check.id}
                        disabled={!check.enabled}
                        title={check.enabled ? 'Run this check now' : 'Activate the check to run it'}
                      >
                        Run now
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingCheck(check)}>
                        Edit
                      </Button>
                      <Switch
                        checked={check.enabled}
                        onChange={(enabled) => toggleCheck.mutate({ check, enabled })}
                        label=""
                        disabled={project.status === 'paused'}
                        id={`toggle-${check.id}`}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Response time */}
        <Card>
          <CardHeader title="Response time" description="Successful runs from the last 40 checks." />
          {responseTimeSeries.length >= 2 ? (
            <div className="h-[190px] w-full px-2 pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={responseTimeSeries} margin={{ top: 4, right: 12, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="responseGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#17171A" stopOpacity={0.16} />
                      <stop offset="100%" stopColor="#17171A" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E4DD" vertical={false} />
                  <XAxis dataKey="at" hide />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#A9A9B2' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value: number) => `${Math.round(value)}ms`}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: '1px solid #E4E4DD',
                      fontSize: 12,
                      boxShadow: '0 10px 30px -18px rgba(0,0,0,0.3)',
                    }}
                    labelFormatter={(value: string) => formatDateTime(String(value))}
                    formatter={(value: number) => [`${Math.round(value)} ms`, 'Response']}
                  />
                  <Area type="monotone" dataKey="durationMs" stroke="#17171A" strokeWidth={1.6} fill="url(#responseGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title="Not enough data yet"
              description="Response-time history appears once at least two successful checks have been recorded."
            />
          )}
        </Card>
      </div>

      {/* Recent runs */}
      <Card>
        <CardHeader
          title="Recent check runs"
          description="Every run is stored with its observed result and failure category."
          action={
            <div className="flex rounded-lg border border-paper-300 p-0.5">
              {(
                [
                  ['all', 'All'],
                  ['failure', 'Failures'],
                ] as ['all' | 'failure', string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setRunFilter(value)}
                  className={clsx(
                    'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                    runFilter === value ? 'bg-ink-900 text-paper-50' : 'text-ink-500 hover:text-ink-900',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        />
        {runs.length === 0 ? (
          <EmptyState title="No runs recorded" description="Runs appear here as soon as a check executes." />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[620px] text-left">
              <thead>
                <tr className="border-b border-paper-200 text-[10.5px] uppercase tracking-[0.12em] text-ink-400">
                  <th className="px-5 py-2 font-medium">Check</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Duration</th>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Trigger</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-200">
                {runs.map((run) => (
                  <tr key={run.id} className="text-[12.5px] transition-colors hover:bg-paper-100">
                    <td className="px-5 py-2.5 font-medium text-ink-800">{run.checkName}</td>
                    <td className="px-3 py-2.5">
                      <span className={run.success ? 'text-state-healthy' : 'text-state-critical'}>
                        {run.success ? 'Passed' : categoryLabel(run.failureCategory)}
                      </span>
                    </td>
                    <td className="tabular px-3 py-2.5 text-ink-500">{run.httpStatus ?? '—'}</td>
                    <td className="tabular px-3 py-2.5 text-ink-500">{formatDuration(run.durationMs)}</td>
                    <td className="px-3 py-2.5 text-ink-500" title={formatDateTime(run.startedAt)}>
                      {relativeTime(run.startedAt)}
                    </td>
                    <td className="px-3 py-2.5 text-[11.5px] uppercase tracking-[0.08em] text-ink-400">{run.triggeredBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Incidents + deployments */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Incident history"
            description="Newest first. Resolved incidents keep their full timeline."
            action={<Link to={`/app/incidents?projectId=${project.id}`} className="link-underline text-[12.5px]">All</Link>}
          />
          {incidents.length === 0 ? (
            <EmptyState title="No incidents" description="This project has not breached a failure threshold yet." />
          ) : (
            <ul className="divide-y divide-paper-200">
              {incidents.slice(0, 6).map((incident) => (
                <li key={incident.id}>
                  <Link to={`/app/incidents/${incident.id}`} className="flex flex-wrap items-center gap-2 px-5 py-3 hover:bg-paper-100">
                    <IncidentStatusBadge status={incident.status} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-700">{incident.checkName}</span>
                    <SeverityBadge severity={incident.severity} />
                    <span className="text-[11.5px] text-ink-400">{relativeTime(incident.firstFailureAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Deployments"
            description="Verified webhook events, correlated by time only."
            action={
              <Button size="sm" variant="ghost" icon={<GitBranch className="h-3.5 w-3.5" />} onClick={() => setShowGithub(true)}>
                Connect
              </Button>
            }
          />
          {deployments.length === 0 ? (
            <EmptyState
              title="No deployments recorded"
              description="Connect a GitHub webhook to correlate failures with recent changes."
              action={<Button size="sm" variant="secondary" onClick={() => setShowGithub(true)}>Set up GitHub</Button>}
            />
          ) : (
            <ul className="divide-y divide-paper-200">
              {deployments.slice(0, 6).map((deployment) => (
                <li key={deployment.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium text-ink-800">
                        {deployment.commitMessage ?? deployment.commitSha?.slice(0, 8) ?? 'Deployment'}
                      </p>
                      <p className="text-[11.5px] text-ink-400">
                        {deployment.environment} · {relativeTime(deployment.deployedAt)}
                        {deployment.commitSha ? ` · ${deployment.commitSha.slice(0, 7)}` : ''}
                      </p>
                    </div>
                    {deployment.verified ? <Badge tone="healthy">verified</Badge> : <Badge tone="neutral">unverified</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Project actions */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setShowCredentials(true)}>
              Credentials
            </Button>
            <Button variant="secondary" size="sm" icon={<GitBranch className="h-3.5 w-3.5" />} onClick={() => setShowGithub(true)}>
              GitHub deployments
            </Button>
          </div>
          <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmDelete(true)}>
            Delete project
          </Button>
        </div>
      </Card>

      {/* Modals */}
      <Modal
        open={showAddCheck}
        onClose={() => setShowAddCheck(false)}
        title="Add a check"
        description="Run a test before activating. Nothing is scheduled until you activate."
        size="lg"
      >
        <CheckForm
          projectId={project.id}
          projectUrl={project.url}
          onSaved={() => {
            setShowAddCheck(false);
            void queryClient.invalidateQueries({ queryKey: ['project', workspaceId, projectId] });
          }}
          onCancel={() => setShowAddCheck(false)}
        />
      </Modal>

      <Modal
        open={Boolean(editingCheck)}
        onClose={() => setEditingCheck(null)}
        title={`Edit ${editingCheck?.name ?? 'check'}`}
        description="Configuration changes bump the config version and reset the current verdict."
        size="lg"
      >
        {editingCheck ? (
          <CheckForm
            projectId={project.id}
            projectUrl={project.url}
            existing={editingCheck}
            onSaved={() => {
              setEditingCheck(null);
              void queryClient.invalidateQueries({ queryKey: ['project', workspaceId, projectId] });
            }}
            onCancel={() => setEditingCheck(null)}
          />
        ) : null}
      </Modal>

      <CredentialsModal open={showCredentials} onClose={() => setShowCredentials(false)} projectId={project.id} />

      <GithubModal
        open={showGithub}
        onClose={() => setShowGithub(false)}
        projectId={project.id}
        repository={project.githubRepository}
      />

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this project?"
        description="This removes its checks and credentials. Incident history is retained but no longer updates."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" loading={deleteProject.isPending} onClick={() => deleteProject.mutate()}>
              Delete project
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-600">
          Monitoring will stop immediately for <strong>{project.name}</strong>. This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Credentials modal                                                   */
/* ------------------------------------------------------------------ */

function CredentialsModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [purpose, setPurpose] = useState<'login_username' | 'login_password' | 'basic_auth' | 'api_header'>('login_password');
  const [value, setValue] = useState('');

  const { data } = useQuery({
    queryKey: ['secrets', workspaceId, projectId],
    queryFn: () =>
      api.get<{ secrets: { id: string; label: string; purpose: string; lastUsedAt: string | null; createdAt: string }[] }>(
        `/workspaces/${workspaceId}/projects/${projectId}/secrets`,
      ),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () => api.post(`/workspaces/${workspaceId}/projects/${projectId}/secrets`, { label, purpose, value }),
    onSuccess: async () => {
      toast.success('Credential encrypted and saved');
      setLabel('');
      setValue('');
      await queryClient.invalidateQueries({ queryKey: ['secrets', workspaceId, projectId] });
    },
    onError: (caught) => toast.error('Could not save the credential', (caught as Error).message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/workspaces/${workspaceId}/projects/${projectId}/secrets/${id}`),
    onSuccess: async () => {
      toast.success('Credential deleted');
      await queryClient.invalidateQueries({ queryKey: ['secrets', workspaceId, projectId] });
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Test account credentials"
      description="Encrypted with AES-256-GCM before storage. Values are never returned by the API or written to logs."
      size="md"
    >
      <div className="space-y-4">
        <InlineNotice tone="info">
          Use a dedicated, least-privileged test account on the client site — not a personal admin login.
        </InlineNotice>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Label" htmlFor="secret-label">
            <Input id="secret-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Client portal test account" />
          </Field>
          <Field label="Purpose" htmlFor="secret-purpose">
            <select
              id="secret-purpose"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value as 'login_password')}
              className="w-full rounded-lg border border-paper-400 bg-paper-50 px-3 py-2.5 text-sm"
            >
              <option value="login_password">Test account password</option>
              <option value="login_username">Test account username</option>
              <option value="basic_auth">Basic auth credential</option>
              <option value="api_header">API header value</option>
            </select>
          </Field>
        </div>

        <Field label="Secret value" htmlFor="secret-value" hint="Stored encrypted; shown masked in all responses.">
          <Input
            id="secret-value"
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="••••••••••••"
            autoComplete="new-password"
          />
        </Field>

        <Button
          size="sm"
          onClick={() => create.mutate()}
          loading={create.isPending}
          disabled={!label.trim() || !value.trim()}
        >
          Encrypt and save
        </Button>

        <div className="border-t border-paper-300 pt-3">
          <p className="mb-2 text-[12.5px] font-medium text-ink-800">Saved credentials</p>
          {data?.secrets.length ? (
            <ul className="space-y-1.5">
              {data.secrets.map((secret) => (
                <li key={secret.id} className="flex items-center justify-between gap-3 rounded-lg border border-paper-300 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-ink-800">{secret.label}</p>
                    <p className="text-[11px] text-ink-400">
                      {secret.purpose.replace(/_/g, ' ')} · last used {secret.lastUsedAt ? relativeTime(secret.lastUsedAt) : 'never'}
                    </p>
                  </div>
                  <button
                    onClick={() => remove.mutate(secret.id)}
                    className="rounded p-1 text-ink-400 hover:text-state-critical"
                    aria-label={`Delete ${secret.label}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-ink-400">No credentials saved for this project yet.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* GitHub modal                                                        */
/* ------------------------------------------------------------------ */

function GithubModal({
  open,
  onClose,
  projectId,
  repository,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  repository: string | null;
}) {
  const workspaceId = useWorkspaceId();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [repo, setRepo] = useState(repository ?? '');
  const [secret, setSecret] = useState('');
  const [result, setResult] = useState<{ webhookUrl: string; webhookConfigured: boolean } | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.put<{ webhookUrl: string; webhookConfigured: boolean }>(`/workspaces/${workspaceId}/projects/${projectId}/github`, {
        ...(repo ? { repository: repo } : {}),
        ...(secret ? { secret } : {}),
      }),
    onSuccess: async (data) => {
      setResult({ webhookUrl: data.webhookUrl, webhookConfigured: data.webhookConfigured });
      toast.success('GitHub integration updated');
      await queryClient.invalidateQueries({ queryKey: ['project', workspaceId, projectId] });
    },
    onError: (caught) => toast.error('Could not save the GitHub settings', (caught as Error).message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="GitHub deployment events"
      description="Verified webhooks let BreakGlass show deployments next to incidents in time."
      size="md"
    >
      <div className="space-y-4">
        <Field label="Repository (optional)" htmlFor="gh-repo" hint="For example acme/client-website">
          <Input id="gh-repo" value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="acme/client-website" />
        </Field>
        <Field
          label="Webhook secret"
          htmlFor="gh-secret"
          hint="Set the same value in the GitHub webhook configuration. At least 16 characters."
        >
          <Input
            id="gh-secret"
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="Leave blank to keep the existing secret"
            autoComplete="new-password"
          />
        </Field>

        <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!secret && !repo}>
          Save GitHub settings
        </Button>

        {result ? (
          <div className="space-y-2 rounded-lg border border-paper-300 bg-paper-100 p-3">
            <p className="text-[12px] font-medium text-ink-800">Payload URL</p>
            <code className="block break-all rounded bg-paper-50 px-2 py-1.5 font-mono text-[11.5px] text-ink-700">
              {result.webhookUrl}
            </code>
            <p className="text-[11.5px] leading-relaxed text-ink-500">
              Content type: application/json · Secret: the value you entered · Events: push and deployment status.
              Deliveries are deduplicated and invalid signatures are rejected.
            </p>
            {!result.webhookConfigured ? (
              <p className="text-[11.5px] text-state-warning">No secret is stored yet, so webhook payloads will be rejected.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
