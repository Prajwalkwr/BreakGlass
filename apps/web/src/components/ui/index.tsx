import { clsx } from 'clsx';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle, Check, ChevronDown, Info, Loader2, X } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'inverse';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-ink-900 text-paper-50 hover:bg-ink-800 active:bg-ink-950 border border-ink-900 disabled:bg-ink-400 disabled:border-ink-400',
  secondary:
    'bg-paper-50 text-ink-900 border border-paper-400 hover:border-ink-400 hover:bg-paper-100 disabled:text-ink-300',
  ghost: 'bg-transparent text-ink-700 border border-transparent hover:bg-paper-200 hover:text-ink-900',
  danger: 'bg-state-critical text-white border border-state-critical hover:bg-[#87241c] disabled:opacity-60',
  inverse:
    'bg-paper-50 text-ink-900 border border-paper-50 hover:bg-paper-100 disabled:opacity-60',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex select-none items-center justify-center font-medium transition-all duration-200 ease-smooth',
        'focus-visible:ring-2 focus-visible:ring-ink-900/60 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed',
        buttonStyles[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Form fields                                                         */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  error,
  required,
  children,
  htmlFor,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={clsx('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="flex items-baseline justify-between gap-3 text-[13px] font-medium text-ink-800">
        <span>
          {label}
          {required ? <span className="ml-1 text-state-critical">*</span> : null}
        </span>
      </label>
      {children}
      {error ? (
        <p className="flex items-start gap-1.5 text-[12.5px] text-state-critical">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="text-[12.5px] leading-relaxed text-ink-400">{hint}</p>
      ) : null}
    </div>
  );
}

const controlClasses =
  'w-full rounded-lg border bg-paper-50 px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-300 transition-colors duration-150 ' +
  'focus:border-ink-700 focus:outline-none focus:ring-2 focus:ring-ink-900/10 disabled:cursor-not-allowed disabled:bg-paper-100';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={clsx(controlClasses, invalid ? 'border-state-critical' : 'border-paper-400', className)}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={clsx(controlClasses, 'min-h-[88px] resize-y', invalid ? 'border-state-critical' : 'border-paper-400', className)}
        {...props}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className, invalid, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          aria-invalid={invalid || undefined}
          className={clsx(
            controlClasses,
            'appearance-none pr-9',
            invalid ? 'border-state-critical' : 'border-paper-400',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
      </div>
    );
  },
);

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  id?: string;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <label htmlFor={inputId} className="cursor-pointer text-sm font-medium text-ink-800">
          {label}
        </label>
        {description ? <p className="max-w-md text-[12.5px] leading-relaxed text-ink-400">{description}</p> : null}
      </div>
      <button
        id={inputId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-200',
          checked ? 'border-ink-900 bg-ink-900' : 'border-paper-400 bg-paper-200',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white transition-transform duration-200 ease-smooth',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
          style={{ height: 18, width: 18 }}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return <Tag className={clsx('surface', className)}>{children}</Tag>;
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-wrap items-start justify-between gap-3 border-b border-paper-300 px-5 py-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">{title}</h2>
        {description ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-400">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badges & status                                                     */
/* ------------------------------------------------------------------ */

export type Tone = 'neutral' | 'healthy' | 'warning' | 'critical' | 'info' | 'dark';

const toneStyles: Record<Tone, string> = {
  neutral: 'bg-paper-200 text-ink-600 border-paper-300',
  healthy: 'bg-state-healthySoft text-state-healthy border-[#cfe3d8]',
  warning: 'bg-state-warningSoft text-state-warning border-[#ecdcbb]',
  critical: 'bg-state-criticalSoft text-state-critical border-[#efd2ce]',
  info: 'bg-state-infoSoft text-state-info border-[#cdd9ee]',
  dark: 'bg-ink-900 text-paper-50 border-ink-900',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
  dot,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium leading-5',
        toneStyles[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

export function StatusDot({ tone = 'neutral', pulse }: { tone?: Tone; pulse?: boolean }) {
  const colors: Record<Tone, string> = {
    neutral: 'bg-ink-300',
    healthy: 'bg-state-healthy',
    warning: 'bg-state-warning',
    critical: 'bg-state-critical',
    info: 'bg-state-info',
    dark: 'bg-ink-900',
  };
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden>
      {pulse ? <span className={clsx('absolute inset-0 rounded-full opacity-60 animate-pulse-ring', colors[tone])} /> : null}
      <span className={clsx('relative h-2 w-2 rounded-full', colors[tone])} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton h-4 w-full', className)} aria-hidden />;
}

export function LoadingBlock({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={clsx('space-y-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className={index === 0 ? 'h-6 w-1/3' : 'h-4'} />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon ? <div className="mb-4 text-ink-300">{icon}</div> : null}
      <h3 className="text-[15px] font-semibold text-ink-900">{title}</h3>
      {description ? <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-400">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  action,
}: {
  title?: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl2 border border-[#efd2ce] bg-state-criticalSoft/60 px-5 py-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-state-critical" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-state-critical">{title}</p>
          {message ? <p className="mt-1 text-[13px] leading-relaxed text-ink-600">{message}</p> : null}
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function InlineNotice({
  tone = 'info',
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'critical' | 'success';
  children: ReactNode;
  className?: string;
}) {
  const styles = {
    info: 'border-[#cdd9ee] bg-state-infoSoft/70 text-ink-700',
    warning: 'border-[#ecdcbb] bg-state-warningSoft/70 text-ink-700',
    critical: 'border-[#efd2ce] bg-state-criticalSoft/70 text-ink-700',
    success: 'border-[#cfe3d8] bg-state-healthySoft/70 text-ink-700',
  }[tone];
  const Icon = tone === 'success' ? Check : tone === 'info' ? Info : AlertCircle;
  return (
    <div className={clsx('flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed', styles, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && ref.current) {
        const focusable = ref.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => {
      ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    }, 40);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 h-full w-full cursor-default bg-ink-950/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} aria-label="Close dialog" tabIndex={-1} />
      <div
        ref={ref}
        className={clsx(
          'relative w-full animate-fade-up rounded-t-2xl border border-paper-300 bg-paper-50 shadow-lift sm:rounded-xl2',
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-paper-300 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
            {description ? <p className="mt-1 text-[12.5px] leading-relaxed text-ink-400">{description}</p> : null}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-ink-400 transition-colors hover:bg-paper-200 hover:text-ink-900" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-paper-300 px-5 py-3.5">{footer}</div> : null}
      </div>
    </div>
  );
}
