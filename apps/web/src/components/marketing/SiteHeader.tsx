import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, ChevronDown, Menu, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../../lib/auth';
import { Logo } from '../Logo';
import { ButtonLink, Container } from './ui';

export const MARKETING_NAV = [
  { label: 'Product', hash: 'product' },
  { label: 'How it works', hash: 'how-it-works' },
  { label: 'For agencies', hash: 'for-agencies' },
] as const;

/**
 * Marketing header.
 *
 * `overHero` starts transparent over the light landing-page artwork, then
 * becomes a solid paper bar as soon as the page scrolls. Every other marketing
 * page uses `solid`.
 */
export function SiteHeader({ overHero = false }: { overHero?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const location = useLocation();
  const onLanding = location.pathname === '/';
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!overHero) return;
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [overHero]);

  // Close the mobile panel whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.hash]);

  // Lock background scrolling and support Escape while the panel is open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const firstLink = panelRef.current?.querySelector<HTMLElement>('a,button');
    firstLink?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const solid = !overHero || scrolled || open;

  return (
    <header
      className={clsx(
        'fixed inset-x-0 top-0 z-50 transition-colors duration-300 ease-smooth',
        solid ? 'border-b border-paper-300 bg-white/90 backdrop-blur-sm' : 'border-b border-transparent bg-transparent',
      )}
    >
      <a
        href="#main"
        className={clsx(
          'sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-[2px] focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium',
          solid ? 'focus:bg-ink-900 focus:text-paper-50' : 'focus:bg-paper-50 focus:text-ink-900',
        )}
      >
        Skip to content
      </a>

      <Container className="flex h-[76px] items-center justify-between gap-6 sm:h-[88px]">
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2.5"
          aria-label="BreakGlass — home"
          onClick={() => setOpen(false)}
        >
          <Logo className="h-8 w-8 text-[#4f78ff] sm:h-9 sm:w-9" />
          <span
            className="text-[16px] font-semibold tracking-[-0.02em] text-[#24344e] sm:text-[17px]"
          >
            BreakGlass
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
          {MARKETING_NAV.map((item) => {
            const classes = 'inline-flex items-center gap-1 text-[13px] font-medium text-[#52627d] transition-colors duration-200 hover:text-[#263752]';
            return onLanding ? (
              <a key={item.hash} href={`#${item.hash}`} className={classes}>
                {item.label}
                {item.hash === 'product' ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : null}
              </a>
            ) : (
              <Link key={item.hash} to={`/#${item.hash}`} className={classes}>
                {item.label}
                {item.hash === 'product' ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : null}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-5 md:flex">
          {user ? (
            <ButtonLink to="/app" variant="primary" size="md" withArrow className="rounded-full bg-[#3154f5] hover:bg-[#2545e8]">
              Open dashboard
            </ButtonLink>
          ) : (
            <>
              <Link
                to="/login"
                className="text-[13px] font-medium text-[#52627d] transition-colors duration-200 hover:text-[#263752]"
              >
                Sign in
              </Link>
              <ButtonLink to="/signup" variant="primary" size="md" withArrow className="rounded-full bg-[#3154f5] px-5 shadow-sm hover:bg-[#2545e8]">
                Start Monitoring
              </ButtonLink>
            </>
          )}
        </div>

        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          className={clsx(
            'inline-flex h-10 w-10 items-center justify-center rounded-[2px] border transition-colors md:hidden',
            'border-paper-300 bg-white/70 text-ink-900 hover:bg-white',
          )}
        >
          {open ? <X className="h-[18px] w-[18px]" /> : <Menu className="h-[18px] w-[18px]" />}
        </button>
      </Container>

      <div
        id="mobile-nav"
        ref={panelRef}
        hidden={!open}
        className="border-t border-paper-300 bg-white/95 backdrop-blur-sm md:hidden"
      >
        <Container className="flex max-h-[calc(100vh-4rem)] flex-col gap-1 overflow-y-auto py-6">
          <nav aria-label="Mobile" className="flex flex-col">
            {MARKETING_NAV.map((item) =>
              onLanding ? (
                <a
                  key={item.hash}
                  href={`#${item.hash}`}
                  onClick={() => setOpen(false)}
                  className={clsx(
                    'border-b py-4 text-[17px] font-medium',
                    'border-paper-200 text-ink-900',
                  )}
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.hash}
                  to={`/#${item.hash}`}
                  onClick={() => setOpen(false)}
                  className={clsx(
                    'border-b py-4 text-[17px] font-medium',
                    'border-paper-200 text-ink-900',
                  )}
                >
                  {item.label}
                </Link>
              ),
            )}
          </nav>

          <div className="mt-6 flex flex-col gap-3">
            {user ? (
              <ButtonLink to="/app" variant="primary" size="lg" withArrow className="rounded-full bg-[#3154f5] hover:bg-[#2545e8]">
                Open dashboard
              </ButtonLink>
            ) : (
              <>
                <ButtonLink to="/signup" variant="primary" size="lg" withArrow className="rounded-full bg-[#3154f5] hover:bg-[#2545e8]">
                  Start Monitoring
                </ButtonLink>
                <ButtonLink to="/login" variant="secondary" size="lg" className="rounded-full border-[#dce3ee]">
                  <span className="inline-flex items-center gap-2">
                    Sign in <ArrowRight className="h-4 w-4" aria-hidden />
                  </span>
                </ButtonLink>
              </>
            )}
          </div>
        </Container>
      </div>
    </header>
  );
}
