import { clsx } from 'clsx';

/**
 * Frame for a real screenshot captured from the running application.
 *
 * Images live in /public/shots and are produced by scripts/capture-shots.ts
 * against a seeded demo workspace, so nothing here is redrawn by hand.
 */
export function ScreenshotFrame({
  src,
  alt,
  title,
  path,
  caption,
  width,
  height,
  tone = 'light',
  priority = false,
}: {
  src: string;
  alt: string;
  title: string;
  path: string;
  caption: string;
  width: number;
  height: number;
  tone?: 'light' | 'dark';
  priority?: boolean;
}) {
  return (
    <figure className="min-w-0">
      <div
        className={clsx(
          'overflow-hidden rounded-[2px] border',
          tone === 'dark' ? 'border-white/15 bg-ink-900' : 'border-paper-300 bg-paper-50',
        )}
      >
        <div
          className={clsx(
            'flex items-center justify-between gap-3 border-b px-4 py-2.5',
            tone === 'dark' ? 'border-white/12 bg-ink-900' : 'border-paper-300 bg-paper-100',
          )}
        >
          <div className="flex items-center gap-2">
            <span className={clsx('h-2 w-2 rounded-full', tone === 'dark' ? 'bg-white/20' : 'bg-ink-300/60')} aria-hidden />
            <span className={clsx('h-2 w-2 rounded-full', tone === 'dark' ? 'bg-white/20' : 'bg-ink-300/60')} aria-hidden />
            <span className={clsx('h-2 w-2 rounded-full', tone === 'dark' ? 'bg-white/20' : 'bg-ink-300/60')} aria-hidden />
          </div>
          <p
            className={clsx(
              'truncate font-mono text-[10px] tracking-[0.04em]',
              tone === 'dark' ? 'text-paper-300/60' : 'text-ink-400',
            )}
          >
            app.breakglass.dev{path}
          </p>
          <span
            className={clsx(
              'hidden shrink-0 text-[9.5px] uppercase tracking-[0.14em] sm:inline',
              tone === 'dark' ? 'text-paper-300/50' : 'text-ink-300',
            )}
          >
            screenshot
          </span>
        </div>
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className="block h-auto w-full"
        />
      </div>
      <figcaption className="mt-3">
        <p className={clsx('text-[13px] font-semibold', tone === 'dark' ? 'text-paper-50' : 'text-ink-900')}>{title}</p>
        <p className={clsx('mt-1 text-[12px] leading-relaxed', tone === 'dark' ? 'text-paper-300/60' : 'text-ink-500')}>
          {caption}
        </p>
      </figcaption>
    </figure>
  );
}
