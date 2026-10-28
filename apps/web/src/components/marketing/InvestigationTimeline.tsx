import { clsx } from 'clsx';
import { StatusDot } from './ui';

const STAGES = [
  {
    index: '01',
    title: 'Last successful check',
    status: 'healthy' as const,
    body: 'The most recent run that passed, with its timestamp, status code and response time. This is the last moment BreakGlass can prove the site was working.',
    kind: 'Recorded fact',
  },
  {
    index: '02',
    title: 'First failure',
    status: 'critical' as const,
    body: 'The check fails and the failure is classified — HTTP status, timeout, TLS, DNS, content mismatch, or a journey step. One failure is recorded; an incident only opens at the threshold you configured.',
    kind: 'Recorded fact',
  },
  {
    index: '03',
    title: 'Evidence captured',
    status: 'critical' as const,
    body: 'The run stores what it actually saw: sanitized response headers, a bounded body preview, and for browser journeys a screenshot of the page at the failing step.',
    kind: 'Recorded fact',
  },
  {
    index: '04',
    title: 'Nearby deployment',
    status: 'warning' as const,
    body: 'If a signed GitHub delivery was recorded shortly before the failure, it is listed with its commit, branch and time. Timing is shown as context — never as proof of cause.',
    kind: 'Correlation, not causation',
  },
  {
    index: '05',
    title: 'Recovery verified',
    status: 'healthy' as const,
    body: 'Checks start passing again. The incident moves to recovering and only closes after the recovery threshold is met, so a single lucky request cannot clear a real outage.',
    kind: 'Recorded fact',
  },
  {
    index: '06',
    title: 'Resolution and delivery trail',
    status: 'neutral' as const,
    body: 'The incident closes with a full timeline of runs, actions and notes, plus the delivery record for every alert — what was sent, to which destination, and whether the provider accepted it.',
    kind: 'Recorded fact',
  },
];

export function InvestigationTimeline() {
  return (
    <ol className="mt-12 border-t border-paper-300">
      {STAGES.map((stage) => (
        <li
          key={stage.index}
          className="group grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-5 gap-y-2 border-b border-paper-300 py-7 sm:grid-cols-[3.5rem_minmax(0,1fr)_16rem] sm:gap-x-8"
        >
          <div className="flex items-center gap-2 pt-1">
            <span className="tabular font-mono text-[11px] text-ink-300">{stage.index}</span>
          </div>

          <div className="min-w-0">
            <h3 className="flex items-center gap-2.5 text-[15px] font-semibold text-ink-900">
              <StatusDot status={stage.status} />
              {stage.title}
            </h3>
            <p className="mt-2 max-w-2xl text-[13.5px] leading-[1.7] text-ink-500">{stage.body}</p>
          </div>

          <div className="col-span-2 sm:col-span-1 sm:pt-1">
            <span
              className={clsx(
                'inline-flex rounded-[2px] border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em]',
                stage.kind === 'Recorded fact'
                  ? 'border-paper-400 text-ink-400'
                  : 'border-state-warning/40 bg-state-warningSoft/50 text-state-warning',
              )}
            >
              {stage.kind}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
