import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Settings,
  ShieldAlert,
  SquareStack,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../../lib/auth';
import { Logo } from '../Logo';
import { Badge, Button } from '../ui';

const NAV = [
  { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/app/projects', label: 'Projects', icon: SquareStack, end: false },
  { to: '/app/incidents', label: 'Incidents', icon: ShieldAlert, end: false },
  { to: '/app/settings', label: 'Settings', icon: Settings, end: false },
];

function WorkspaceSwitcher() {
  const { workspaces, activeWorkspace, setActiveWorkspaceId, user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-paper-300 bg-paper-50 px-3 py-2 text-left transition-colors hover:border-ink-300"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-ink-900 text-[11px] font-semibold text-paper-50">
          {(activeWorkspace?.name ?? user?.name ?? 'B').slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-ink-900">
            {activeWorkspace?.name ?? 'No workspace'}
          </span>
          <span className="block text-[10.5px] uppercase tracking-[0.12em] text-ink-400">
            {activeWorkspace?.role ?? '—'}
          </span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-lg border border-paper-300 bg-paper-50 shadow-lift" role="listbox">
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              role="option"
              aria-selected={workspace.id === activeWorkspace?.id}
              onClick={() => {
                setActiveWorkspaceId(workspace.id);
                setOpen(false);
              }}
              className={clsx(
                'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-paper-100',
                workspace.id === activeWorkspace?.id && 'bg-paper-100 font-medium',
              )}
            >
              <span className="truncate">{workspace.name}</span>
              <span className="text-[10.5px] uppercase tracking-[0.1em] text-ink-400">{workspace.role}</span>
            </button>
          ))}
          <Link
            to="/app/settings?tab=workspace"
            onClick={() => setOpen(false)}
            className="block border-t border-paper-200 px-3 py-2 text-[12.5px] text-ink-500 hover:bg-paper-100 hover:text-ink-900"
          >
            Manage workspaces
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const { user, signOut, activeWorkspace, loading } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Client-side guard: the API is the real authority, this just avoids a flash
  // of the dashboard for signed-out visitors.
  useEffect(() => {
    if (!loading && !user) navigate('/login', { replace: true, state: { from: location.pathname } });
  }, [loading, user, navigate, location.pathname]);

  const sidebar = (
    <div className="flex h-full flex-col gap-5">
      <Link to="/app" className="flex items-center gap-2.5 px-1">
        <Logo className="h-6 w-6 text-ink-900" />
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink-900">BreakGlass</span>
      </Link>

      <WorkspaceSwitcher />

      <nav className="flex-1 space-y-0.5" aria-label="Dashboard">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                isActive ? 'bg-ink-900 text-paper-50' : 'text-ink-600 hover:bg-paper-200 hover:text-ink-900',
              )
            }
          >
            <item.icon className="h-4 w-4" aria-hidden />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-3 border-t border-paper-300 pt-4">
        <Button
          size="sm"
          className="w-full justify-center"
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => navigate('/app/projects/new')}
        >
          Add website
        </Button>

        <div className="flex items-center gap-2.5 px-1">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-paper-300 bg-paper-100 text-[11px] font-semibold text-ink-700">
            {user?.name?.slice(0, 1).toUpperCase() ?? '?'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-ink-800">{user?.name ?? 'Loading…'}</p>
            <p className="truncate text-[11px] text-ink-400">{user?.email}</p>
          </div>
          <button
            onClick={() => void signOut()}
            className="rounded p-1 text-ink-400 transition-colors hover:bg-paper-200 hover:text-ink-900"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-paper-100">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-paper-300 bg-paper px-4 py-5 lg:block">
        {sidebar}
      </aside>

      {/* Mobile header */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-paper-300 bg-paper/95 px-4 backdrop-blur lg:hidden">
        <Link to="/app" className="flex items-center gap-2">
          <Logo className="h-5 w-5 text-ink-900" />
          <span className="text-[14px] font-semibold text-ink-900">BreakGlass</span>
        </Link>
        <div className="flex items-center gap-2">
          {activeWorkspace ? <Badge tone="neutral">{activeWorkspace.name}</Badge> : null}
          <button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-ink-600 hover:bg-paper-200" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-ink-950/40" onClick={() => setMobileOpen(false)} aria-label="Close menu" />
          <div className="absolute inset-y-0 left-0 w-[260px] animate-slide-in border-r border-paper-300 bg-paper p-4">
            <div className="mb-3 flex justify-end">
              <button onClick={() => setMobileOpen(false)} className="rounded p-1 text-ink-500" aria-label="Close menu">
                <X className="h-4 w-4" />
              </button>
            </div>
            {sidebar}
          </div>
        </div>
      ) : null}

      <main className="lg:pl-[248px]">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 sm:py-8">
          {activeWorkspace ? (
            <Outlet />
          ) : loading ? (
            <div className="py-24 text-center text-[13px] text-ink-400">Loading workspace…</div>
          ) : (
            <div className="py-24 text-center">
              <p className="text-[15px] font-medium text-ink-900">No workspace yet</p>
              <p className="mt-1 text-[13px] text-ink-500">Create one from Settings to start monitoring.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
