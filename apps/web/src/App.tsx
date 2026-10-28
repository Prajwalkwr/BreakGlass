import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { AppShell } from './components/layout/AppShell';
import { Logo } from './components/Logo';

const Landing = lazy(() => import('./pages/marketing/Landing'));
const Privacy = lazy(() => import('./pages/marketing/Legal').then((module) => ({ default: module.Privacy })));
const Terms = lazy(() => import('./pages/marketing/Legal').then((module) => ({ default: module.Terms })));
const Login = lazy(() => import('./pages/auth/Login'));
const Signup = lazy(() => import('./pages/auth/Signup'));
const ForgotPassword = lazy(() => import('./pages/auth/PasswordReset').then((module) => ({ default: module.ForgotPassword })));
const ResetPassword = lazy(() => import('./pages/auth/PasswordReset').then((module) => ({ default: module.ResetPassword })));
const VerifyEmail = lazy(() => import('./pages/auth/PasswordReset').then((module) => ({ default: module.VerifyEmail })));
const Overview = lazy(() => import('./pages/app/Overview'));
const Projects = lazy(() => import('./pages/app/Projects'));
const ProjectNew = lazy(() => import('./pages/app/ProjectNew'));
const ProjectDetail = lazy(() => import('./pages/app/ProjectDetail'));
const Incidents = lazy(() => import('./pages/app/Incidents'));
const IncidentDetail = lazy(() => import('./pages/app/IncidentDetail'));
const Settings = lazy(() => import('./pages/app/Settings'));

function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <div className="flex flex-col items-center gap-3">
        <Logo className="h-8 w-8 animate-pulse text-ink-900" />
        <p className="text-[12px] uppercase tracking-[0.2em] text-ink-400">Loading</p>
      </div>
    </div>
  );
}

/** Redirects signed-in users away from auth screens and vice versa. */
function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (user) return <Navigate to="/app" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper px-6 text-center">
      <p className="eyebrow">404</p>
      <h1 className="text-[26px] font-semibold text-ink-900">That page does not exist</h1>
      <p className="max-w-sm text-[13px] text-ink-500">
        The link may be out of date. Head back to the dashboard or the home page.
      </p>
      <div className="mt-3 flex gap-2">
        <a href="/app" className="inline-flex h-10 items-center rounded-lg bg-ink-900 px-4 text-sm font-medium text-paper-50">
          Dashboard
        </a>
        <a href="/" className="inline-flex h-10 items-center rounded-lg border border-paper-400 px-4 text-sm font-medium text-ink-800">
          Home
        </a>
      </div>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<FullPageLoader />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />
          <Route path="/signup" element={<AuthRoute><Signup /></AuthRoute>} />
          <Route path="/forgot-password" element={<AuthRoute><ForgotPassword /></AuthRoute>} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />

          <Route path="/app" element={<AppShell />}>
            <Route index element={<Overview />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/new" element={<ProjectNew />} />
            <Route path="projects/:projectId" element={<ProjectDetail />} />
            <Route path="incidents" element={<Incidents />} />
            <Route path="incidents/:incidentId" element={<IncidentDetail />} />
            <Route path="settings" element={<Settings />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
