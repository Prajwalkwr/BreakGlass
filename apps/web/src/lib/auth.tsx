import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionUser, WorkspaceSummary } from '@breakglass/shared';
import { api } from './api';

export interface MeResponse {
  user: SessionUser | null;
  workspaces: WorkspaceSummary[];
  emailConfigured?: boolean;
}

interface AuthContextValue {
  user: SessionUser | null;
  workspaces: WorkspaceSummary[];
  activeWorkspace: WorkspaceSummary | null;
  setActiveWorkspaceId: (id: string) => void;
  loading: boolean;
  refresh: () => Promise<unknown>;
  signOut: () => Promise<void>;
  emailConfigured: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'breakglass.activeWorkspace';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [activeWorkspaceId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const { data, isLoading } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
    staleTime: 30_000,
    retry: false,
  });

  const workspaces = data?.workspaces ?? [];
  const user = data?.user ?? null;

  // Keep the selected workspace valid as the user's memberships change.
  const activeWorkspace = useMemo(() => {
    if (!workspaces.length) return null;
    return workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  }, [workspaces, activeWorkspaceId]);

  useEffect(() => {
    if (activeWorkspace && activeWorkspace.id !== activeWorkspaceId) {
      setActiveId(activeWorkspace.id);
      try {
        localStorage.setItem(STORAGE_KEY, activeWorkspace.id);
      } catch {
        /* storage may be blocked */
      }
    }
  }, [activeWorkspace, activeWorkspaceId]);

  const setActiveWorkspaceId = useCallback(
    (id: string) => {
      setActiveId(id);
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        /* ignore */
      }
      void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ['me'] }), [queryClient]);

  const signOut = useCallback(async () => {
    await api.post('/auth/logout');
    queryClient.clear();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    window.location.assign('/login');
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      workspaces,
      activeWorkspace,
      setActiveWorkspaceId,
      loading: isLoading,
      refresh,
      signOut,
      emailConfigured: data?.emailConfigured ?? false,
    }),
    [user, workspaces, activeWorkspace, setActiveWorkspaceId, isLoading, refresh, signOut, data?.emailConfigured],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

/** Requires an active workspace; throws a helpful error rather than crashing. */
export function useWorkspace() {
  const { activeWorkspace } = useAuth();
  return activeWorkspace;
}

export function useWorkspaceId(): string {
  const workspace = useWorkspace();
  return workspace?.id ?? '';
}
