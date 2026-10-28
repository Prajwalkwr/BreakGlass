import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Globe2, Plus, Search } from 'lucide-react';
import type { ProjectSummary } from '@breakglass/shared';
import { api } from '../../lib/api';
import { useWorkspaceId } from '../../lib/auth';
import { formatDateTime, hostnameOf, relativeTime } from '../../lib/format';
import { Button, Card, EmptyState, ErrorState, Input, Skeleton } from '../../components/ui';
import { ProjectHealthBadge } from '../../components/HealthBadge';

type Filter = 'all' | 'attention' | 'paused';

export default function Projects() {
  const workspaceId = useWorkspaceId();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => api.get<{ projects: ProjectSummary[] }>(`/workspaces/${workspaceId}/projects`),
    enabled: Boolean(workspaceId),
    refetchInterval: 30_000,
  });

  const projects = data?.projects ?? [];
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter((project) => {
      if (filter === 'attention' && !['degraded', 'down', 'unknown'].includes(project.health)) return false;
      if (filter === 'paused' && project.health !== 'paused') return false;
      if (!term) return true;
      return (
        project.name.toLowerCase().includes(term) ||
        project.url.toLowerCase().includes(term) ||
        (project.clientName ?? '').toLowerCase().includes(term)
      );
    });
  }, [projects, search, filter]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Projects</p>
          <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-ink-900">
            Client websites
          </h1>
          <p className="mt-1 text-[13px] text-ink-500">
            {projects.length === 0
              ? 'Nothing monitored yet.'
              : `${projects.length} ${projects.length === 1 ? 'project' : 'projects'} · ${projects.reduce((sum, project) => sum + project.activeIncidentCount, 0)} active incidents`}
          </p>
        </div>
        <Link
          to="/app/projects/new"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-ink-900 bg-ink-900 px-4 text-sm font-medium text-paper-50 transition-colors hover:bg-ink-800"
        >
          <Plus className="h-4 w-4" />
          Add website
        </Link>
      </header>

      {isError ? (
        <ErrorState title="Could not load projects" message={(error as Error).message} action={<Button size="sm" onClick={() => void refetch()}>Try again</Button>} />
      ) : null}

      {projects.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" aria-hidden />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, client or URL"
              className="pl-9"
              aria-label="Search projects"
            />
          </div>
          <div className="flex rounded-lg border border-paper-300 bg-paper-50 p-0.5" role="tablist" aria-label="Filter projects">
            {(
              [
                ['all', 'All'],
                ['attention', 'Needs attention'],
                ['paused', 'Paused'],
              ] as [Filter, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                className={
                  'rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ' +
                  (filter === value ? 'bg-ink-900 text-paper-50' : 'text-ink-500 hover:text-ink-900')
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <Card className="divide-y divide-paper-200">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-center gap-4 px-5 py-4">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-64" />
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          ))}
        </Card>
      ) : projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Globe2 className="h-7 w-7" />}
            title="No websites monitored yet"
            description="Add a client website to start checking uptime, APIs or a full browser journey. You can test the configuration before anything is scheduled."
            action={
              <Link to="/app/projects/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink-900 px-4 text-sm font-medium text-paper-50">
                Add your first website
                <ArrowRight className="h-4 w-4" />
              </Link>
            }
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState title="No projects match" description="Try a different search term or clear the filter." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_90px_110px_minmax(0,1fr)_24px] gap-4 border-b border-paper-300 px-5 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-ink-400 lg:grid">
            <span>Project</span>
            <span>Status</span>
            <span className="text-center">Checks</span>
            <span className="text-center">Incidents</span>
            <span>Last check</span>
            <span />
          </div>
          <ul className="divide-y divide-paper-200">
            {visible.map((project) => (
              <li key={project.id}>
                <Link
                  to={`/app/projects/${project.id}`}
                  className="grid grid-cols-1 items-center gap-3 px-5 py-4 transition-colors hover:bg-paper-100 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_90px_110px_minmax(0,1fr)_24px] lg:gap-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-paper-300 bg-paper-100 text-[12px] font-semibold text-ink-600">
                      {project.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-medium text-ink-900">{project.name}</p>
                      <p className="truncate font-mono text-[11.5px] text-ink-400">{hostnameOf(project.url)}</p>
                    </div>
                  </div>

                  <div>
                    <ProjectHealthBadge health={project.health} />
                  </div>

                  <p className="tabular text-[12.5px] text-ink-600 lg:text-center">
                    <span className="lg:hidden">Checks: </span>
                    {project.enabledCheckCount}/{project.checkCount}
                  </p>

                  <p className="tabular text-[12.5px] lg:text-center">
                    <span className="lg:hidden">Incidents: </span>
                    <span className={project.activeIncidentCount > 0 ? 'font-semibold text-state-critical' : 'text-ink-400'}>
                      {project.activeIncidentCount}
                    </span>
                  </p>

                  <div className="text-[12px] text-ink-500">
                    {project.lastCheckAt ? (
                      <>
                        <p>{relativeTime(project.lastCheckAt)}</p>
                        <p className="text-[11px] text-ink-300">{formatDateTime(project.lastCheckAt)}</p>
                      </>
                    ) : (
                      <p className="text-ink-300">Never</p>
                    )}
                  </div>

                  <ArrowRight className="hidden h-4 w-4 text-ink-300 lg:block" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
