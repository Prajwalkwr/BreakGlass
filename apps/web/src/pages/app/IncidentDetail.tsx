import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Camera, Check, Clock, ExternalLink, FileArchive, GitBranch, MessageSquare } from 'lucide-react';
import type { IncidentDetail as IncidentDetailType } from '@breakglass/shared';
import { api } from '../../lib/api';
import { useAuth, useWorkspaceId } from '../../lib/auth';
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
  LoadingBlock,
  Modal,
  Skeleton,
  Textarea,
} from '../../components/ui';
import { IncidentStatusBadge, SeverityBadge } from '../../components/HealthBadge';
import { categoryLabel, formatBytes, formatDateTime, formatDuration, relativeTime } from '../../lib/format';

export default function IncidentDetail() {
  const { incidentId = '' } = useParams();
  const workspaceId = useWorkspaceId();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [resolveOpen, setResolveOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['incident', workspaceId, incidentId],
    queryFn: () => api.get<{ incident: IncidentDetailType }>(`/workspaces/${workspaceId}/incidents/${incidentId}`),
    enabled: Boolean(workspaceId && incidentId),
    refetchInterval: 20_000,
  });

  const incident = data?.incident;

  const acknowledge = useMutation({
    mutationFn: () => api.post(`/workspaces/${workspaceId}/incidents/${incidentId}/acknowledge`),
    onSuccess: async () => {
      toast.success('Incident acknowledged', 'The monitoring verdict is unchanged — this only records that you have seen it.');
      await queryClient.invalidateQueries({ queryKey: ['incident', workspaceId, incidentId] });
      await queryClient.invalidateQueries({ queryKey: ['incidents', workspaceId] });
    },
    onError: (caught) => toast.error('Could not acknowledge', (caught as Error).message),
  });

  const resolve = useMutation({
    mutationFn: () => api.post(`/workspaces/${workspaceId}/incidents/${incidentId}/resolve`, { note: note || undefined }),
    onSuccess: async () => {
      toast.success('Incident resolved manually', 'A new incident will open if the check fails again.');
      setResolveOpen(false);
      setNote('');
      await queryClient.invalidateQueries({ queryKey: ['incident', workspaceId, incidentId] });
      await queryClient.invalidateQueries({ queryKey: ['incidents', workspaceId] });
    },
    onError: (caught) => toast.error('Could not resolve', (caught as Error).message),
  });

  const addNote = useMutation({
    mutationFn: () => api.post(`/workspaces/${workspaceId}/incidents/${incidentId}/note`, { message: noteText }),
    onSuccess: async () => {
      setNoteOpen(false);
      setNoteText('');
      await queryClient.invalidateQueries({ queryKey: ['incident', workspaceId, incidentId] });
    },
    onError: (caught) => toast.error('Could not add note', (caught as Error).message),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-80" />
        <Card className="p-5"><LoadingBlock rows={6} /></Card>
      </div>
    );
  }

  if (isError || !incident) {
    return (
      <ErrorState
        title="Could not load this incident"
        message={(error as Error)?.message}
        action={<Button size="sm" onClick={() => void refetch()}>Try again</Button>}
      />
    );
  }

  const isResolved = incident.status === 'resolved';
  const deploymentNearby = incident.deployments[0];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link to="/app/incidents" className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-500 hover:text-ink-900">
          <ArrowLeft className="h-3.5 w-3.5" /> Incidents
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <IncidentStatusBadge status={incident.status} />
            <SeverityBadge severity={incident.severity} />
            <span className="text-[11.5px] uppercase tracking-[0.1em] text-ink-400">{incident.checkType} check</span>
          </div>
          <h1 className="mt-2.5 text-[24px] font-semibold tracking-[-0.02em] text-ink-900">{incident.title}</h1>
          <p className="mt-1 text-[13px] text-ink-500">
            <Link to={`/app/projects/${incident.projectId}`} className="hover:text-ink-900">{incident.projectName}</Link>
            {' · '}
            {incident.projectUrl}
            {' · '}
            {incident.checkName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon={<MessageSquare className="h-3.5 w-3.5" />} onClick={() => setNoteOpen(true)}>
            Add note
          </Button>
          {!isResolved ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                icon={<Check className="h-3.5 w-3.5" />}
                onClick={() => acknowledge.mutate()}
                loading={acknowledge.isPending}
                disabled={incident.status === 'acknowledged'}
              >
                {incident.status === 'acknowledged' ? 'Acknowledged' : 'Acknowledge'}
              </Button>
              <Button size="sm" onClick={() => setResolveOpen(true)}>
                Resolve
              </Button>
            </>
          ) : (
            <Badge tone="healthy">Resolved {incident.resolvedAt ? relativeTime(incident.resolvedAt) : ''}</Badge>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'First failure', value: formatDateTime(incident.firstFailureAt), hint: relativeTime(incident.firstFailureAt) },
          { label: 'Last failure', value: formatDateTime(incident.lastFailureAt), hint: relativeTime(incident.lastFailureAt) },
          {
            label: isResolved ? 'Duration' : 'Open for',
            value: formatDuration(incident.durationMs),
            hint: `${incident.failureCount} failed ${incident.failureCount === 1 ? 'check' : 'checks'}`,
          },
          {
            label: 'Recovery',
            value: isResolved ? 'Verified' : incident.status === 'recovering' ? 'Verifying' : 'Not yet',
            hint: isResolved
              ? `${incident.recoveryVerifiedCount} consecutive successes`
              : 'Recovery requires consecutive successful checks',
          },
        ].map((item) => (
          <Card key={item.label} className="p-4">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.13em] text-ink-400">{item.label}</p>
            <p className="tabular mt-2 text-[14px] font-medium text-ink-900">{item.value}</p>
            <p className="mt-0.5 text-[11.5px] text-ink-400">{item.hint}</p>
          </Card>
        ))}
      </div>

      {incident.summary ? (
        <Card className="border-[#efd2ce] bg-state-criticalSoft/40 p-4">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-state-critical">Observed</p>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-800">{incident.summary}</p>
          <p className="mt-2 text-[11.5px] text-ink-500">
            This is the evidence recorded by the check. Changes to {incident.projectUrl} are outside BreakGlass's visibility, so inspect the site and its logs before drawing conclusions.
          </p>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          {/* Evidence */}
          <Card>
            <CardHeader
              title="Evidence and recent runs"
              description="Recorded facts from this check — newest first."
            />
            {incident.recentRuns.length === 0 ? (
              <EmptyState title="No runs attached" description="Run history for this check will appear here." />
            ) : (
              <ul className="divide-y divide-paper-200">
                {incident.recentRuns.slice(0, 10).map((run) => (
                  <li key={run.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={
                          'inline-flex h-1.5 w-1.5 rounded-full ' + (run.success ? 'bg-state-healthy' : 'bg-state-critical')
                        }
                        aria-hidden
                      />
                      <span className={'text-[12.5px] font-medium ' + (run.success ? 'text-ink-800' : 'text-state-critical')}>
                        {run.success ? 'Passed' : categoryLabel(run.failureCategory)}
                      </span>
                      <span className="tabular text-[11.5px] text-ink-400">
                        {formatDateTime(run.startedAt)} · {formatDuration(run.durationMs)}
                        {run.httpStatus ? ` · HTTP ${run.httpStatus}` : ''} · attempt {run.attempt}
                      </span>
                      <span className="ml-auto font-mono text-[10.5px] text-ink-300">{run.runId.slice(0, 22)}</span>
                    </div>
                    {run.errorSummary ? (
                      <p className="mt-1 text-[12px] leading-relaxed text-ink-500">{run.errorSummary}</p>
                    ) : null}
                    {run.artifacts.length ? (
                      <RunArtifacts runId={run.runId} artifacts={run.artifacts} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader title="Timeline" description="System and human events in order." />
            <ol className="relative px-5 py-4">
              <span className="absolute left-[26px] top-5 bottom-5 w-px bg-paper-300" aria-hidden />
              {incident.events.map((event) => (
                <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                  <span
                    className={
                      'relative z-10 mt-1 flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full border ' +
                      (event.type === 'resolved'
                        ? 'border-state-healthy bg-state-healthy'
                        : event.type === 'opened' || event.type === 'failure'
                          ? 'border-state-critical bg-state-critical'
                          : event.source === 'user'
                            ? 'border-ink-900 bg-ink-900'
                            : 'border-paper-400 bg-paper-50')
                    }
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] leading-relaxed text-ink-700">{event.message}</p>
                    <p className="mt-0.5 text-[11px] text-ink-400">
                      {formatDateTime(event.createdAt)} · {event.actor} · {event.type.replace(/_/g, ' ')}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-3">
          {/* Suggestions */}
          <Card>
            <CardHeader title="Suggested next steps" description="Suggestions only — not confirmed causes." />
            {incident.suggestedSteps.length ? (
              <ul className="space-y-2.5 px-5 py-4">
                {incident.suggestedSteps.map((step, index) => (
                  <li key={index} className="flex gap-2.5 text-[12.5px] leading-relaxed text-ink-600">
                    <span className="font-mono text-[10.5px] text-ink-300">{String(index + 1).padStart(2, '0')}</span>
                    {step}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-[12.5px] text-ink-400">No suggestions for this failure category.</p>
            )}
          </Card>

          {/* Deployment correlation */}
          <Card>
            <CardHeader title="Deployments" description="Recorded around this incident." />
            {deploymentNearby ? (
              <div className="px-5 py-4">
                <div className="flex items-start gap-2.5">
                  <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                  <div>
                    <p className="text-[12.5px] font-medium text-ink-800">
                      {deploymentNearby.commitMessage ?? deploymentNearby.commitSha?.slice(0, 8) ?? 'Deployment'}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-ink-400">
                      {deploymentNearby.environment} · {formatDateTime(deploymentNearby.deployedAt)} ·{' '}
                      {deploymentNearby.verified ? 'signature verified' : 'unverified'}
                    </p>
                    <p className="mt-2 text-[11.5px] leading-relaxed text-ink-500">
                      Correlation is based on timing only. A deployment happening near a failure does not prove it caused the failure.
                    </p>
                  </div>
                </div>
                {incident.deployments.length > 1 ? (
                  <p className="mt-2 text-[11.5px] text-ink-400">{incident.deployments.length - 1} more recorded in this window.</p>
                ) : null}
              </div>
            ) : (
              <p className="px-5 py-4 text-[12.5px] leading-relaxed text-ink-400">
                No deployments recorded around this incident. Connect a GitHub webhook on the project to add them.
              </p>
            )}
          </Card>

          {/* Notifications */}
          <Card>
            <CardHeader title="Notifications" description="Delivery attempts recorded by BreakGlass." />
            {incident.notifications.length === 0 ? (
              <p className="px-5 py-4 text-[12.5px] text-ink-400">No notifications were queued for this incident.</p>
            ) : (
              <ul className="divide-y divide-paper-200">
                {incident.notifications.map((delivery) => (
                  <li key={delivery.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-medium text-ink-800">{delivery.eventType.replace(/_/g, ' ')}</p>
                      <p className="text-[11.5px] text-ink-400">
                        {delivery.destinationLabel} · {delivery.attempts} attempt{delivery.attempts === 1 ? '' : 's'} ·{' '}
                        {relativeTime(delivery.createdAt)}
                      </p>
                      {delivery.error ? <p className="mt-0.5 text-[11.5px] text-state-critical">{delivery.error}</p> : null}
                    </div>
                    <Badge
                      tone={
                        delivery.status === 'sent' || delivery.status === 'delivered'
                          ? 'healthy'
                          : delivery.status === 'failed'
                            ? 'critical'
                            : delivery.status === 'skipped'
                              ? 'neutral'
                              : 'info'
                      }
                    >
                      {delivery.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Config snapshot */}
          <Card>
            <CardHeader title="Check configuration" description="The configuration that produced this incident." />
            <pre className="scrollbar-thin max-h-64 overflow-auto px-5 py-4 font-mono text-[11px] leading-relaxed text-ink-600">
              {JSON.stringify(incident.checkConfig, null, 2)}
            </pre>
          </Card>
        </div>
      </div>

      <Modal
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        title="Resolve this incident manually?"
        description="Resolution closes the incident record. Monitoring keeps running, and a new incident opens if the check fails again."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResolveOpen(false)}>Cancel</Button>
            <Button onClick={() => resolve.mutate()} loading={resolve.isPending}>
              Resolve incident
            </Button>
          </>
        }
      >
        <Field label="Resolution note (optional)" htmlFor="resolve-note" hint="Recorded in the incident timeline.">
          <Textarea
            id="resolve-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Fixed by rolling back the release."
          />
        </Field>
      </Modal>

      <Modal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title="Add a note"
        description={`Added to the timeline as ${user?.name ?? 'you'}.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNoteOpen(false)}>Cancel</Button>
            <Button onClick={() => addNote.mutate()} loading={addNote.isPending} disabled={!noteText.trim()}>
              Add note
            </Button>
          </>
        }
      >
        <Field label="Note" htmlFor="incident-note">
          <Textarea id="incident-note" value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Asked the client whether they changed DNS this morning." />
        </Field>
      </Modal>

      <InlineNotice tone="info">
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          Times are shown in your profile timezone ({user?.timezone ?? 'UTC'}). Records are stored in UTC.
        </span>
      </InlineNotice>
    </div>
  );
}

function RunArtifacts({ runId, artifacts }: { runId: string; artifacts: { id: string; kind: string; bytes: number }[] }) {
  const workspaceId = useWorkspaceId();
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ['artifacts', workspaceId, runId],
    queryFn: () =>
      api.get<{ artifacts: { id: string; kind: string; bytes: number; url: string; expiresAt: string }[] }>(
        `/workspaces/${workspaceId}/artifacts?runId=${runId}`,
      ),
    enabled: open,
  });

  return (
    <div className="mt-1.5">
      <button onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-ink-600 hover:text-ink-900">
        {artifacts.some((artifact) => artifact.kind === 'screenshot') ? <Camera className="h-3.5 w-3.5" /> : <FileArchive className="h-3.5 w-3.5" />}
        {artifacts.length} evidence {artifacts.length === 1 ? 'file' : 'files'} · {formatBytes(artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0))}
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {data?.artifacts.length ? (
            data.artifacts.map((artifact) =>
              artifact.kind === 'screenshot' ? (
                <a key={artifact.id} href={artifact.url} target="_blank" rel="noreferrer noopener" className="block">
                  <img
                    src={artifact.url}
                    alt="Failure screenshot captured by the browser check"
                    className="max-h-64 w-auto rounded-lg border border-paper-300"
                  />
                  <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink-400">
                    Signed link expires {relativeTime(artifact.expiresAt)} <ExternalLink className="h-3 w-3" />
                  </span>
                </a>
              ) : (
                <a
                  key={artifact.id}
                  href={artifact.url}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-paper-300 px-2.5 py-1.5 text-[11.5px] text-ink-600 hover:border-ink-400"
                >
                  <FileArchive className="h-3.5 w-3.5" /> {artifact.kind} · {formatBytes(artifact.bytes)}
                </a>
              ),
            )
          ) : (
            <p className="text-[11.5px] text-ink-400">Preparing signed links…</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
