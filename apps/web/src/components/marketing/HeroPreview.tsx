import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { IllustrativeTag, StatusDot } from './ui';

/**
 * Illustrative product preview used in the hero.
 *
 * This is a drawing, not a screenshot: the numbers are example values chosen to
 * show a healthy site, a slowing site and a failing check side by side. It is
 * labelled as illustrative everywhere it appears, and the live product UI is
 * shown with real screenshots further down the page.
 */

const CHECKS = [
  { site: 'northsidecoffee.com', type: 'HTTP', detail: '200', ms: 184, status: 'healthy' as const },
  { site: 'verdantwellness.com', type: 'Browser journey', detail: '4 steps', ms: 3120, status: 'healthy' as const },
  { site: 'harbordental.com', type: 'HTTP', detail: 'HTTP 500', ms: 412, status: 'critical' as const },
  { site: 'atlas-architects.com', type: 'HTTP', detail: '200', ms: 236, status: 'healthy' as const },
  { site: 'northsidecoffee.com', type: 'API · /cart', detail: '200', ms: 96, status: 'healthy' as const },
];

const RESPONSE_TIMES = [212, 198, 224, 191, 206, 233, 218, 240, 229, 251, 244, 268, 255, 288, 271, 312, 298, 341, 326, 389, 412, 431, 402, 418];

const TIMELINE = [
  { time: '14:02', label: 'Last successful check', tone: 'neutral' as const },
  { time: '14:07', label: 'First failure · HTTP 500', tone: 'critical' as const },
  { time: '14:07', label: 'Incident opened, alert sent', tone: 'warning' as const },
  { time: '14:19', label: 'Recovery verified', tone: 'healthy' as const },
];

export function HeroPreview() {
  const [active, setActive] = useState(2);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % CHECKS.length), 2800);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <figure className="relative">
      <div className="overflow-hidden rounded-[2px] border border-white/15 bg-paper shadow-[0_40px_120px_-50px_rgba(0,0,0,0.85)]">
        {/* window bar */}
        <div className="flex items-center justify-between gap-3 border-b border-paper-300 bg-paper-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-ink-300/60" aria-hidden />
            <span className="h-2 w-2 rounded-full bg-ink-300/60" aria-hidden />
            <span className="h-2 w-2 rounded-full bg-ink-300/60" aria-hidden />
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">northline.studio / overview</p>
          <IllustrativeTag />
        </div>

        {/* workspace header */}
        <div className="flex items-center justify-between gap-4 border-b border-paper-300 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-[2px] bg-ink-900 text-[11px] font-semibold text-paper-50">
              N
            </span>
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold text-ink-900">Northline Studio</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400">Agency overview</p>
            </div>
          </div>
          <p className="hidden text-[10.5px] text-ink-400 sm:block">Checks run from BreakGlass workers</p>
        </div>

        {/* summary */}
        <div className="grid grid-cols-2 divide-x divide-paper-300 border-b border-paper-300 sm:grid-cols-4">
          {[
            { label: 'Projects', value: '4', note: '6 active checks' },
            { label: 'Healthy', value: '5', note: 'of 6 checks' },
            { label: 'Incidents', value: '1', note: 'unacknowledged' },
            { label: 'Next check', value: '42s', note: 'harbordental.com' },
          ].map((stat) => (
            <div key={stat.label} className="px-3.5 py-3 sm:px-4">
              <p className="text-[9.5px] uppercase tracking-[0.16em] text-ink-400">{stat.label}</p>
              <p className="tabular mt-1 text-[17px] font-medium leading-none text-ink-900">{stat.value}</p>
              <p className="mt-1.5 text-[10px] text-ink-400">{stat.note}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          {/* checks */}
          <div className="border-b border-paper-300 sm:border-b-0 sm:border-r">
            <p className="border-b border-paper-200 px-4 py-2 text-[9.5px] uppercase tracking-[0.16em] text-ink-400">
              Uptime checks
            </p>
            <ul>
              {CHECKS.map((check, index) => (
                <li
                  key={`${check.site}-${check.type}`}
                  className={clsx(
                    'flex items-center gap-2.5 px-4 py-[9px] transition-colors duration-500',
                    active === index ? 'bg-paper-100' : 'bg-transparent',
                  )}
                >
                  <StatusDot status={check.status} pulse={check.status === 'critical'} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11.5px] font-medium text-ink-800">{check.site}</p>
                    <p className="text-[9.5px] uppercase tracking-[0.1em] text-ink-400">{check.type}</p>
                  </div>
                  <div className="text-right">
                    <p
                      className={clsx(
                        'tabular text-[11px]',
                        check.status === 'critical' ? 'font-medium text-state-critical' : 'text-ink-600',
                      )}
                    >
                      {check.detail}
                    </p>
                    <p className="tabular text-[9.5px] text-ink-400">{check.ms.toLocaleString()} ms</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* right rail */}
          <div>
            <div className="border-b border-paper-200 px-4 py-2">
              <p className="text-[9.5px] uppercase tracking-[0.16em] text-ink-400">Response time · harbourdental.com</p>
              <div className="mt-2 flex h-12 items-end gap-[2px]" aria-hidden>
                {RESPONSE_TIMES.map((value, index) => {
                  const failing = index >= RESPONSE_TIMES.length - 5;
                  return (
                    <span
                      key={index}
                      style={{ height: `${Math.round((value / 460) * 100)}%` }}
                      className={clsx('w-full rounded-[1px]', failing ? 'bg-state-critical/70' : 'bg-ink-300')}
                    />
                  );
                })}
              </div>
              <p className="mt-1.5 text-[9.5px] text-ink-400">Response time rising, then HTTP 500</p>
            </div>

            <div className="px-4 py-3">
              <p className="text-[9.5px] uppercase tracking-[0.16em] text-ink-400">Incident timeline</p>
              <ol className="mt-2 space-y-2">
                {TIMELINE.map((item) => (
                  <li key={item.label} className="flex items-start gap-2">
                    <StatusDot status={item.tone} />
                    <p className="tabular text-[9.5px] text-ink-400">{item.time}</p>
                    <p className="flex-1 text-[10.5px] leading-tight text-ink-700">{item.label}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-paper-300/50">
        <span>Illustrative preview.</span>
        <span>Example workspace for a fictional agency — not live data.</span>
        <span className="hidden sm:inline">Real screenshots appear in the product interface section.</span>
      </figcaption>
    </figure>
  );
}
