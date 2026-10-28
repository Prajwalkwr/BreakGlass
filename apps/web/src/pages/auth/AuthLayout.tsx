import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Logo } from '../../components/Logo';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-ink-950 p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 grid-lines opacity-40" aria-hidden />
        <div className="pointer-events-none absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-white/[0.07] blur-[100px]" aria-hidden />

        <Link to="/" className="relative flex items-center gap-2.5 text-paper-50">
          <Logo className="h-6 w-6" />
          <span className="text-[15px] font-semibold">BreakGlass</span>
        </Link>

        <div className="relative max-w-md">
          <p className="eyebrow text-white/40">Website reliability</p>
          <h2 className="mt-5 text-display-md font-semibold uppercase leading-none text-paper-50">
            Know the moment
            <br />
            a client site breaks.
          </h2>
          <ul className="mt-9 space-y-3.5">
            {[
              'Real uptime, API and browser-journey checks',
              'One incident per problem, with the evidence attached',
              'Monitoring runs without your dashboard open',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-white/55">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-white/40" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/25">
          Encrypted credentials · SSRF protection · Durable scheduling
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex min-h-screen flex-col justify-center px-5 py-12 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-[420px] animate-fade-up">
          <Link to="/" className="mb-10 flex items-center gap-2.5 lg:hidden">
            <Logo className="h-6 w-6 text-ink-900" />
            <span className="text-[15px] font-semibold text-ink-900">BreakGlass</span>
          </Link>

          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink-900">{title}</h1>
          {subtitle ? <p className="mt-2 text-[13.5px] leading-relaxed text-ink-500">{subtitle}</p> : null}

          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-7 text-[13px] text-ink-500">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
