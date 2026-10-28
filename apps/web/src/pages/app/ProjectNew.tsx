import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CheckCircle2, Globe2, RefreshCw, TriangleAlert } from 'lucide-react';
import { z } from 'zod';
import { createProjectSchema, type CheckSummary, type PageScanReport } from '@breakglass/shared';
import { api, ApiRequestError } from '../../lib/api';
import { useWorkspaceId } from '../../lib/auth';
import { Badge, Button, Card, CardHeader, Field, InlineNotice, Input } from '../../components/ui';
import { CheckForm } from '../../components/check/CheckForm';

type ProjectValues = z.infer<typeof createProjectSchema>;

interface Destination {
  id: string;
  type: 'email' | 'slack';
  label: string;
  address: string | null;
  enabled: boolean;
}

export default function ProjectNew() {
  const workspaceId = useWorkspaceId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [serverError, setServerError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; name: string; url: string } | null>(null);
  const [savedCheck, setSavedCheck] = useState<CheckSummary | null>(null);
  const [scanReport, setScanReport] = useState<PageScanReport | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanState, setScanState] = useState<'idle' | 'running' | 'done'>('idle');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProjectValues>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: '', url: '', clientName: '', notes: '' },
  });

  async function runPageScan(projectId: string) {
    setScanState('running');
    setScanError(null);
    setScanReport(null);
    try {
      const report = await api.post<PageScanReport>(`/workspaces/${workspaceId}/projects/${projectId}/scan`, {});
      setScanReport(report);
      await queryClient.invalidateQueries({ queryKey: ['project', workspaceId, projectId] });
    } catch (error) {
      setScanError(
        error instanceof ApiRequestError
          ? error.message
          : 'The site was added, but BreakGlass could not complete its page scan. Try again from the project page.',
      );
    } finally {
      setScanState('done');
    }
  }

  const onCreateProject = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const result = await api.post<{ project: { id: string; name: string; url: string } }>(
        `/workspaces/${workspaceId}/projects`,
        values,
      );
      setCreated(result.project);
      setStep(2);
      await queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] });
      void runPageScan(result.project.id);
    } catch (error) {
      setServerError(error instanceof ApiRequestError ? error.message : 'Could not create this project.');
    }
  });

  // Alerts destinations are shown on the activation screen: the client should
  // know where an alert will go before monitoring starts.
  const destinations = useQuery({
    queryKey: ['destinations', workspaceId],
    queryFn: () => api.get<{ destinations: Destination[] }>(`/workspaces/${workspaceId}/notifications`),
    enabled: step === 3,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <Link to="/app/projects" className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-500 hover:text-ink-900">
          <ArrowLeft className="h-3.5 w-3.5" /> Projects
        </Link>
      </div>

      <header>
        <p className="eyebrow">Add website</p>
        <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-ink-900">
          {step === 1
            ? 'Which site should we watch?'
            : step === 2
              ? `Scanning ${created?.name ?? 'your website'}`
              : step === 3
                ? 'Add a custom check'
                : 'Monitoring activated'}
        </h1>
        <p className="mt-1 text-[13px] text-ink-500">
          {step === 1
            ? 'Add a public URL. We will monitor linked pages and passively inventory visible controls and API calls.'
            : step === 2
              ? 'We scan up to 50 linked public pages, inspect visible forms and controls, and observe same-origin API calls during page load. Nothing is clicked or submitted.'
              : step === 3
                ? 'Add an API assertion or browser journey in addition to the page checks already scheduled.'
                : 'The scheduler runs each discovered page automatically, whether or not your dashboard is open.'}
        </p>
      </header>

      <ol className="flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-[0.12em]">
        {['Website', 'Page scan', 'Custom check', 'Active'].map((label, index) => {
          const value = index + 1;
          const state = step === value ? 'current' : step > value ? 'done' : 'todo';
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={
                  'flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ' +
                  (state === 'current'
                    ? 'border-ink-900 bg-ink-900 text-paper-50'
                    : state === 'done'
                      ? 'border-state-healthy bg-state-healthySoft text-state-healthy'
                      : 'border-paper-400 text-ink-400')
                }
              >
                {state === 'done' ? '✓' : value}
              </span>
              <span className={state === 'todo' ? 'text-ink-400' : 'text-ink-700'}>{label}</span>
              {index < 3 ? <span className="mx-1 h-px w-6 bg-paper-400" /> : null}
            </li>
          );
        })}
      </ol>

      {step === 1 ? (
        <Card>
          <CardHeader
            title="Website details"
            description="Only public URLs are scanned. We inspect page-load behavior without submitting forms or clicking controls; authenticated/private flows need an explicitly configured check."
          />
          <form onSubmit={onCreateProject} className="space-y-4 p-5" noValidate>
            {serverError ? <InlineNotice tone="critical">{serverError}</InlineNotice> : null}

            <Field label="Website name" htmlFor="project-name" required error={errors.name?.message} hint="How this site appears in your dashboard.">
              <Input id="project-name" placeholder="Northside Coffee" invalid={Boolean(errors.name)} {...register('name')} />
            </Field>

            <Field
              label="Website URL"
              htmlFor="project-url"
              required
              error={errors.url?.message}
              hint="Include the scheme, for example https://northside-coffee.com"
            >
              <Input id="project-url" placeholder="https://northside-coffee.com" invalid={Boolean(errors.url)} {...register('url')} />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Client name (optional)" htmlFor="client-name">
                <Input id="client-name" placeholder="Northside Coffee Co." {...register('clientName')} />
              </Field>
              <Field label="Description (optional)" htmlFor="notes">
                <Input id="notes" placeholder="Managed by Ana · WordPress" {...register('notes')} />
              </Field>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-paper-300 pt-4">
              <p className="text-[12px] text-ink-400">We scan public pages and schedule HTTP checks as soon as it is added.</p>
              <Button type="submit" loading={isSubmitting} icon={<ArrowRight className="h-4 w-4" />}>
                Add website
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {step === 2 && created ? (
        <Card>
          <CardHeader
            title={`Public page scan — ${created.name}`}
            description="A one-time scan checks HTTP availability and passively inventories visible forms, buttons, fields, runtime errors, and same-origin API calls. It never clicks or submits."
          />
          <div className="space-y-4 p-5">
            {scanState === 'running' ? (
              <div className="flex items-center gap-3 text-[13px] text-ink-500">
                <RefreshCw className="h-4 w-4 animate-spin text-ink-400" aria-hidden />
                Discovering and checking public pages at {created.url}…
              </div>
            ) : null}

            {scanError ? <InlineNotice tone="critical">{scanError}</InlineNotice> : null}

            {scanReport ? (
              <>
                {scanReport.warnings.map((warning) => (
                  <InlineNotice key={warning} tone="warning">{warning} Some scan details may be incomplete.</InlineNotice>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Badge tone="healthy" dot>
                    {scanReport.pages.filter((page) => page.success).length}{' '}
                    {scanReport.pages.filter((page) => page.success).length === 1 ? 'page' : 'pages'} responded
                  </Badge>
                  {scanReport.pages.some((page) => !page.success) ? (
                    <Badge tone="critical" dot>{scanReport.pages.filter((page) => !page.success).length} need attention</Badge>
                  ) : null}
                  <Badge tone="neutral">{scanReport.createdChecks} checks scheduled</Badge>
                  {scanReport.activatedChecks ? (
                    <Badge tone="neutral">{scanReport.activatedChecks} paused checks reactivated</Badge>
                  ) : null}
                  {scanReport.alreadyMonitored ? <Badge tone="neutral">{scanReport.alreadyMonitored} already monitored</Badge> : null}
                  {scanReport.unscheduledPages > 0 ? (
                    <Badge tone="warning">{scanReport.unscheduledPages} pages scanned, not monitored</Badge>
                  ) : null}
                  {scanReport.truncated ? <Badge tone="warning">Stopped at 50 pages</Badge> : null}
                </div>
                <p className="text-[12px] leading-relaxed text-ink-500">
                  HTTP checks run every 30 minutes, with first runs staggered. Page signals are observed only during this scan; API failures need a configured recurring API check for incident alerts.
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
                      {scanReport.pages.map((page) => (
                        <tr key={page.url}>
                          <td className="max-w-[360px] truncate px-3 py-2 font-mono text-[11px]" title={page.url}>{new URL(page.url).pathname}</td>
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
              </>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-paper-300 pt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => created && void runPageScan(created.id)}
                loading={scanState === 'running'}
                icon={<RefreshCw className="h-4 w-4" />}
              >
                Scan again
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => navigate(`/app/projects/${created.id}`)}>
                  Open project
                </Button>
                <Button type="button" onClick={() => setStep(3)} disabled={scanState === 'running'} icon={<ArrowRight className="h-4 w-4" />}>
                  Add a custom check
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {step === 3 && created ? (
        <Card>
          <CardHeader
            title={`First check for ${created.name}`}
            description="Run a test to confirm the configuration before you activate recurring monitoring."
          />
          <div className="p-5">
            <CheckForm
              projectId={created.id}
              projectUrl={created.url}
              onSaved={(check) => {
                setSavedCheck(check);
                setStep(4);
                void queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] });
              }}
              onCancel={() => navigate(`/app/projects/${created.id}`)}
            />
          </div>
        </Card>
      ) : null}

      {step === 4 && created && savedCheck ? (
        <ActivationSummary
          check={savedCheck}
          projectName={created.name}
          destinations={destinations.data?.destinations ?? []}
          destinationsLoading={destinations.isLoading}
          onOpenProject={() => navigate(`/app/projects/${created.id}`)}
          onAddAnother={() => navigate('/app/projects/new')}
        />
      ) : null}
    </div>
  );
}

/**
 * Activation confirmation.
 *
 * "Monitoring active" is only claimed when the scheduler actually accepted the
 * check: the API only sets `nextRunAt` when an enabled check is scheduled, so a
 * missing `nextRunAt` is reported as "saved, not scheduled" instead.
 */
function ActivationSummary({
  check,
  projectName,
  destinations,
  destinationsLoading,
  onOpenProject,
  onAddAnother,
}: {
  check: CheckSummary;
  projectName: string;
  destinations: Destination[];
  destinationsLoading: boolean;
  onOpenProject: () => void;
  onAddAnother: () => void;
}) {
  const scheduled = check.enabled && Boolean(check.nextRunAt);
  const enabledDestinations = destinations.filter((destination) => destination.enabled);

  return (
    <Card>
      <div className="p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div
            className={
              scheduled
                ? 'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#cfe3d8] bg-state-healthySoft text-state-healthy'
                : 'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#ecdcbb] bg-state-warningSoft text-state-warning'
            }
          >
            {scheduled ? <CheckCircle2 className="h-5 w-5" /> : <TriangleAlert className="h-5 w-5" />}
          </div>
          <div>
            <h2 className="text-[18px] font-semibold text-ink-900">
              {scheduled ? 'Monitoring is active' : check.enabled ? 'Saved, but not scheduled yet' : 'Check saved as a draft'}
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
              {scheduled
                ? `“${check.name}” on ${projectName} is in the scheduler. The first run is queued now and results appear on the project page within seconds.`
                : check.enabled
                  ? 'The check is enabled but the scheduler has not assigned a next run. Open the project and re-activate it; if this persists, check the worker and queue health.'
                  : `“${check.name}” is saved but not running. Open the project and activate it when you are ready.`}
            </p>
          </div>
        </div>

        <dl className="mt-7 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-paper-300 bg-paper-300 sm:grid-cols-2">
          <div className="bg-paper-50 p-4">
            <dt className="text-[10.5px] uppercase tracking-[0.14em] text-ink-400">Check</dt>
            <dd className="mt-1 text-[13.5px] font-medium text-ink-900">
              {check.name} <span className="font-normal text-ink-400">· {check.type.toUpperCase()}</span>
            </dd>
          </div>
          <div className="bg-paper-50 p-4">
            <dt className="text-[10.5px] uppercase tracking-[0.14em] text-ink-400">Interval</dt>
            <dd className="mt-1 text-[13.5px] font-medium text-ink-900">{describeInterval(check.intervalSeconds)}</dd>
          </div>
          <div className="bg-paper-50 p-4">
            <dt className="text-[10.5px] uppercase tracking-[0.14em] text-ink-400">Incident opens after</dt>
            <dd className="mt-1 text-[13.5px] font-medium text-ink-900">
              {check.failureThreshold} consecutive {check.failureThreshold === 1 ? 'failure' : 'failures'}
            </dd>
          </div>
          <div className="bg-paper-50 p-4">
            <dt className="text-[10.5px] uppercase tracking-[0.14em] text-ink-400">Next scheduled run</dt>
            <dd className="mt-1 text-[13.5px] font-medium text-ink-900">
              {check.nextRunAt ? new Date(check.nextRunAt).toLocaleString() : 'Not scheduled'}
            </dd>
          </div>
        </dl>

        <div className="mt-6 rounded-lg border border-paper-300 p-4">
          <p className="text-[10.5px] uppercase tracking-[0.14em] text-ink-400">Alerts will be sent to</p>
          {destinationsLoading ? (
            <p className="mt-2 text-[13px] text-ink-400">Loading destinations…</p>
          ) : enabledDestinations.length ? (
            <ul className="mt-2 space-y-1">
              {enabledDestinations.map((destination) => (
                <li key={destination.id} className="text-[13px] text-ink-700">
                  {destination.type === 'email' ? destination.address ?? destination.label : `Slack · ${destination.label}`}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] leading-relaxed text-ink-600">
              No alert destination is configured, so incidents will appear in the dashboard but nobody will be
              emailed. Add one under Settings → Alerts.
            </p>
          )}
          <Link to="/app/settings?tab=notifications" className="mt-2 inline-block text-[12.5px] font-medium text-ink-900 underline">
            Manage alert destinations
          </Link>
        </div>

        <p className="mt-5 text-[12.5px] leading-relaxed text-ink-500">
          To pause, edit or remove this check, open the project and use the controls on the check row. Paused checks
          keep their history but are not scheduled.
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button onClick={onOpenProject} icon={<Globe2 className="h-4 w-4" />}>
            Open project
          </Button>
          <Button variant="secondary" onClick={onAddAnother}>
            Add another website
          </Button>
        </div>
      </div>
    </Card>
  );
}

function describeInterval(seconds: number): string {
  if (seconds < 60) return `every ${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? 'every minute' : `every ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'every hour' : `every ${hours} hours`;
}
