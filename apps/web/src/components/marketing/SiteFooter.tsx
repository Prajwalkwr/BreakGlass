import { Link } from 'react-router-dom';
import { Logo } from '../Logo';
import { Container, Rule } from './ui';

const PRODUCT_LINKS = [
  { label: 'Product overview', hash: 'product' },
  { label: 'How it works', hash: 'how-it-works' },
  { label: 'Monitoring capabilities', hash: 'capabilities' },
  { label: 'Product interface', hash: 'interface' },
  { label: 'For agencies', hash: 'for-agencies' },
  { label: 'Incident investigation', hash: 'investigation' },
] as const;

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-paper-300 bg-paper">
      <Container className="py-16 sm:py-20">
        <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.7fr)] lg:gap-16">
          <div>
            <Link to="/" className="inline-flex items-center gap-2.5" aria-label="BreakGlass — home">
              <Logo className="h-6 w-6 text-ink-900" />
              <span className="text-[16px] font-semibold tracking-[-0.01em] text-ink-900">BreakGlass</span>
            </Link>
            <p className="mt-5 max-w-sm text-[14px] leading-[1.75] text-ink-500">
              Website monitoring for agencies. BreakGlass checks the sites you manage from our
              workers, opens one incident per problem, and keeps the evidence needed to explain what
              actually failed.
            </p>
            <p className="mt-5 max-w-sm text-[12.5px] leading-[1.7] text-ink-400">
              Built as a working product: every number shown in the dashboard comes from checks that
              actually ran.
            </p>
          </div>

          <nav aria-label="Product">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-400">Product</h2>
            <ul className="mt-5 space-y-3">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.hash}>
                  <Link to={`/#${link.hash}`} className="text-[13.5px] text-ink-600 transition-colors hover:text-ink-900">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-400">Account</h2>
            <ul className="mt-5 space-y-3">
              <li>
                <Link to="/signup" className="text-[13.5px] text-ink-600 transition-colors hover:text-ink-900">
                  Create an account
                </Link>
              </li>
              <li>
                <Link to="/login" className="text-[13.5px] text-ink-600 transition-colors hover:text-ink-900">
                  Sign in
                </Link>
              </li>
              <li>
                <Link to="/forgot-password" className="text-[13.5px] text-ink-600 transition-colors hover:text-ink-900">
                  Reset password
                </Link>
              </li>
            </ul>

            <h2 className="mt-8 text-[11px] font-medium uppercase tracking-[0.2em] text-ink-400">Legal</h2>
            <ul className="mt-5 space-y-3">
              <li>
                <Link to="/privacy" className="text-[13.5px] text-ink-600 transition-colors hover:text-ink-900">
                  Privacy
                </Link>
              </li>
              <li>
                <Link to="/terms" className="text-[13.5px] text-ink-600 transition-colors hover:text-ink-900">
                  Terms
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <Rule className="mt-14" />

        <div className="mt-6 flex flex-col gap-3 text-[12px] text-ink-400 sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} BreakGlass</p>
          <p>Monitoring runs on our infrastructure — never from your browser.</p>
        </div>
      </Container>
    </footer>
  );
}
