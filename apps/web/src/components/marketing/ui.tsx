import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { clsx } from 'clsx';

/**
 * Shared building blocks for the marketing site.
 *
 * The design language is deliberately narrow: monochrome surfaces, hairline
 * rules, near-square corners, uppercase display type and one consistent content
 * width. Colour is reserved for real states (healthy / warning / incident).
 */

export type Tone = 'light' | 'tint' | 'dark';

const TONE_SURFACE: Record<Tone, string> = {
  light: 'bg-paper text-ink-900',
  tint: 'bg-paper-100 text-ink-900',
  dark: 'bg-ink-950 text-paper-50',
};

const TONE_RULE: Record<Tone, string> = {
  light: 'border-paper-300',
  tint: 'border-paper-300',
  dark: 'border-white/12',
};

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('mx-auto w-full max-w-content px-5 sm:px-8 lg:px-10', className)}>{children}</div>;
}

export function Section({
  id,
  tone = 'light',
  children,
  className,
  labelledBy,
  bordered = true,
}: {
  id?: string;
  tone?: Tone;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  bordered?: boolean;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={clsx(
        'scroll-mt-20',
        TONE_SURFACE[tone],
        bordered && 'border-t',
        bordered && TONE_RULE[tone],
        'py-20 sm:py-24 lg:py-32',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Eyebrow({
  index,
  children,
  tone = 'light',
  className,
}: {
  index?: string;
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <p
      className={clsx(
        'flex items-center gap-3 text-eyebrow font-medium uppercase',
        tone === 'dark' ? 'text-paper-300/70' : 'text-ink-400',
        className,
      )}
    >
      {index ? (
        <span className={clsx('tabular', tone === 'dark' ? 'text-paper-50/40' : 'text-ink-300')}>{index}</span>
      ) : null}
      <span className={clsx('h-px w-6', tone === 'dark' ? 'bg-paper-50/25' : 'bg-ink-300/70')} aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function SectionHeading({
  id,
  eyebrow,
  index,
  title,
  lead,
  tone = 'light',
  align = 'left',
  className,
}: {
  id?: string;
  eyebrow?: string;
  index?: string;
  title: ReactNode;
  lead?: ReactNode;
  tone?: Tone;
  align?: 'left' | 'center';
  className?: string;
}) {
  return (
    <div className={clsx(align === 'center' && 'mx-auto max-w-3xl text-center', className)}>
      {eyebrow ? (
        <Eyebrow index={index} tone={tone} className={clsx(align === 'center' && 'justify-center')}>
          {eyebrow}
        </Eyebrow>
      ) : null}
      <h2
        id={id}
        className={clsx(
          'mt-5 text-display-md font-medium uppercase tracking-[-0.02em]',
          tone === 'dark' ? 'text-paper-50' : 'text-ink-900',
          align === 'center' && 'text-balance',
        )}
      >
        {title}
      </h2>
      {lead ? (
        <p
          className={clsx(
            'mt-5 max-w-2xl text-[15px] leading-[1.75]',
            tone === 'dark' ? 'text-paper-300/70' : 'text-ink-500',
            align === 'center' && 'mx-auto',
          )}
        >
          {lead}
        </p>
      ) : null}
    </div>
  );
}

const BUTTON_BASE =
  'group inline-flex items-center justify-center gap-2 rounded-[2px] text-[14px] font-medium transition-colors duration-200 ease-smooth disabled:cursor-not-allowed disabled:opacity-60';

const BUTTON_VARIANTS = {
  primary: 'bg-ink-900 text-paper-50 hover:bg-ink-700',
  'primary-dark': 'bg-paper-50 text-ink-900 hover:bg-paper-200',
  secondary: 'border border-ink-300/80 text-ink-900 hover:border-ink-900 hover:bg-ink-900 hover:text-paper-50',
  'secondary-dark': 'border border-white/25 text-paper-50 hover:border-paper-50 hover:bg-paper-50 hover:text-ink-900',
  ghost: 'text-ink-900 hover:text-ink-500',
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

const BUTTON_SIZES = {
  md: 'h-10 px-5',
  lg: 'h-12 px-6 sm:px-7',
} as const;

export function ButtonLink({
  to,
  variant = 'primary',
  size = 'lg',
  children,
  className,
  withArrow,
  external,
  onClick,
}: {
  to: string;
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZES;
  children: ReactNode;
  className?: string;
  withArrow?: boolean;
  external?: boolean;
  onClick?: () => void;
}) {
  const classes = clsx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
  const inner = (
    <>
      {children}
      {withArrow ? (
        <ArrowRight
          className="h-4 w-4 transition-transform duration-200 ease-smooth group-hover:translate-x-0.5"
          aria-hidden
        />
      ) : null}
    </>
  );

  if (external) {
    return (
      <a href={to} className={classes} onClick={onClick}>
        {inner}
      </a>
    );
  }
  return (
    <Link to={to} className={classes} onClick={onClick}>
      {inner}
    </Link>
  );
}

/** Inline text link with a rule that animates on hover and on keyboard focus. */
export function TextLink({
  to,
  children,
  tone = 'light',
  className,
  showArrow = true,
}: {
  to: string;
  children: ReactNode;
  tone?: Tone;
  className?: string;
  showArrow?: boolean;
}) {
  return (
    <Link
      to={to}
      className={clsx(
        'group inline-flex items-center gap-1.5 text-[14px] font-medium underline-offset-4 hover:underline',
        tone === 'dark' ? 'text-paper-50' : 'text-ink-900',
        className,
      )}
    >
      {children}
      {showArrow ? (
        <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 ease-smooth group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
      ) : null}
    </Link>
  );
}

const DOT_TONES = {
  healthy: 'bg-state-healthy',
  warning: 'bg-state-warning',
  critical: 'bg-state-critical',
  neutral: 'bg-ink-300',
} as const;

/** A status dot. Only ever used for real states or clearly labelled examples. */
export function StatusDot({ status, pulse = false }: { status: keyof typeof DOT_TONES; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-1.5 w-1.5 shrink-0" aria-hidden>
      <span className={clsx('h-1.5 w-1.5 rounded-full', DOT_TONES[status])} />
      {pulse ? <span className={clsx('absolute inset-0 animate-pulse-ring rounded-full', DOT_TONES[status])} /> : null}
    </span>
  );
}

/** Marks anything drawn by hand rather than taken from a live workspace. */
export function IllustrativeTag({ tone = 'light', children = 'Illustrative' }: { tone?: Tone; children?: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-[2px] border px-2 py-[3px] text-[10px] font-medium uppercase tracking-[0.16em]',
        tone === 'dark' ? 'border-white/25 text-paper-300/80' : 'border-ink-300/70 text-ink-400',
      )}
    >
      {children}
    </span>
  );
}

export function Rule({ tone = 'light', className }: { tone?: Tone; className?: string }) {
  return <hr className={clsx('border-0 border-t', TONE_RULE[tone], className)} />;
}
