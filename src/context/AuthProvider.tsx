import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { apiService, WORKSPACE_SUSPENDED_EVENT } from '../services/api';
import { DEMO_DEFAULT_WORKSPACE_ID, deleteDemoWorkspaceData, getDemoActiveWorkspaceId, isDemoMode, resetDemoWorkspaceData, setDemoActiveWorkspaceId } from '../services/demoApi';
import { generateUUID } from '../utils/uuid';
import type { AuthResponse, AuthUser, RegistrationPayload, WorkspaceResetOptions, WorkspaceRole, WorkspaceSummary } from '../types';
import { AuthContext, type AuthContextValue } from './AuthContext';
import { trackTelemetry } from '../services/telemetry';
import { sessionWriteBoundary } from '../utils/sessionWriteBoundary';

const demoUser: AuthUser = {
  id: 'demo-user',
  email: 'demo@solooffice.local',
  firstName: 'Demo',
  lastName: 'Benutzer',
  displayName: 'Demo Benutzer',
};

const demoWorkspace: WorkspaceSummary = {
  id: DEMO_DEFAULT_WORKSPACE_ID,
  name: 'Demo Workspace',
  slug: 'demo-workspace',
  role: 'owner',
};

const DEMO_WORKSPACES_STORAGE_KEY = 'solooffice-demo-workspaces-v1';

function readDemoWorkspaces(): WorkspaceSummary[] {
  if (typeof localStorage === 'undefined') return [demoWorkspace];
  try {
    const stored = JSON.parse(localStorage.getItem(DEMO_WORKSPACES_STORAGE_KEY) || '[]') as WorkspaceSummary[];
    const customWorkspaces = Array.isArray(stored)
      ? stored.filter(item => item && typeof item.id === 'string' && item.id !== DEMO_DEFAULT_WORKSPACE_ID && typeof item.name === 'string')
      : [];
    return [demoWorkspace, ...customWorkspaces];
  } catch {
    return [demoWorkspace];
  }
}

function persistDemoWorkspaces(workspaces: WorkspaceSummary[]): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DEMO_WORKSPACES_STORAGE_KEY, JSON.stringify(workspaces.filter(item => item.id !== DEMO_DEFAULT_WORKSPACE_ID)));
  }
}

function createDemoWorkspace(name: string): WorkspaceSummary {
  return {
    id: generateUUID(),
    name,
    slug: `${name.toLocaleLowerCase('de-DE').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'workspace'}-${Date.now().toString(36)}`,
    role: 'owner',
  };
}

function applyAuthResponse(response: AuthResponse, setters: {
  setUser: (user: AuthUser | null) => void;
  setWorkspace: (workspace: WorkspaceSummary | null) => void;
  setWorkspaces: (workspaces: WorkspaceSummary[]) => void;
}) {
  setters.setUser(response.user);
  setters.setWorkspace(response.workspace);
  setters.setWorkspaces(response.workspaces);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionRevision, setSessionRevision] = useState(() => sessionWriteBoundary.capture());

  const runSessionChange = useCallback(async <T,>(change: () => T | Promise<T>): Promise<T> => {
    return sessionWriteBoundary.transition(change);
  }, []);

  const applyResponse = useCallback((response: AuthResponse) => {
    setSessionRevision(sessionWriteBoundary.capture());
    applyAuthResponse(response, { setUser, setWorkspace, setWorkspaces });
  }, []);

  useEffect(() => {
    let active = true;
    const initialSessionScope = sessionWriteBoundary.capture();
    const handleAuthExpired = () => {
      setSessionRevision(sessionWriteBoundary.invalidate());
      setUser(null);
      setWorkspace(null);
      setWorkspaces([]);
    };
    window.addEventListener('solooffice-auth-expired', handleAuthExpired);
    // Sperre vom Control Plane, die erst nach dem Laden der Sitzung wirksam
    // wurde: das Backend hat gerade einen Schreibzugriff mit WORKSPACE_SUSPENDED
    // abgewiesen – Zustand übernehmen, damit der Dauerhinweis sofort erscheint.
    const handleWorkspaceSuspended = () => {
      setWorkspace(current => (current && !current.suspended
        ? { ...current, suspended: true, suspendedAt: current.suspendedAt ?? new Date().toISOString() }
        : current));
    };
    window.addEventListener(WORKSPACE_SUSPENDED_EVENT, handleWorkspaceSuspended);
    if (isDemoMode) {
      const demoWorkspaces = readDemoWorkspaces();
      const activeWorkspace = demoWorkspaces.find(item => item.id === getDemoActiveWorkspaceId()) || demoWorkspaces[0];
      setDemoActiveWorkspaceId(activeWorkspace.id);
      setUser(demoUser);
      setWorkspace(activeWorkspace);
      setWorkspaces(demoWorkspaces);
      setLoading(false);
      return () => {
        active = false;
        window.removeEventListener('solooffice-auth-expired', handleAuthExpired);
        window.removeEventListener(WORKSPACE_SUSPENDED_EVENT, handleWorkspaceSuspended);
      };
    }

    apiService.getAuthSession()
      .then(response => {
        if (active && sessionWriteBoundary.isCurrent(initialSessionScope)) applyResponse(response);
      })
      .catch(() => {
        if (active && sessionWriteBoundary.isCurrent(initialSessionScope)) {
          setUser(null);
          setWorkspace(null);
          setWorkspaces([]);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      window.removeEventListener('solooffice-auth-expired', handleAuthExpired);
      window.removeEventListener(WORKSPACE_SUSPENDED_EVENT, handleWorkspaceSuspended);
    };
  }, [applyResponse]);

  const login = useCallback(async (email: string, password: string, workspaceId?: string) => {
    if (isDemoMode) return;
    applyResponse(await runSessionChange(() => apiService.loginAccount({ email, password, workspaceId })));
  }, [applyResponse, runSessionChange]);

  const register = useCallback(async (payload: RegistrationPayload) => {
    if (isDemoMode) return {};
    const response = await runSessionChange(() => apiService.registerAccount(payload));
    setSessionRevision(sessionWriteBoundary.capture());
    if (response.user && response.workspace && response.workspaces) {
      applyResponse({ user: response.user, workspace: response.workspace, workspaces: response.workspaces });
    }
    return response;
  }, [applyResponse, runSessionChange]);

  const logout = useCallback(async () => {
    await runSessionChange(() => isDemoMode ? undefined : apiService.logoutAccount());
    setSessionRevision(sessionWriteBoundary.capture());
    setUser(null);
    setWorkspace(null);
    setWorkspaces([]);
  }, [runSessionChange]);

  const logoutAll = useCallback(async () => {
    await runSessionChange(() => isDemoMode ? undefined : apiService.logoutAllSessions());
    setSessionRevision(sessionWriteBoundary.capture());
    setUser(null);
    setWorkspace(null);
    setWorkspaces([]);
  }, [runSessionChange]);

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    if (isDemoMode) {
      const nextWorkspace = readDemoWorkspaces().find(item => item.id === workspaceId);
      if (nextWorkspace) {
        await runSessionChange(() => setDemoActiveWorkspaceId(nextWorkspace.id));
        setSessionRevision(sessionWriteBoundary.capture());
        setWorkspace(nextWorkspace);
      }
      return;
    }
    applyResponse(await runSessionChange(() => apiService.switchWorkspace(workspaceId)));
  }, [applyResponse, runSessionChange]);

  const updateProfile = useCallback(async (firstName: string, lastName: string) => {
    if (isDemoMode) {
      setUser(previous => previous ? { ...previous, firstName, lastName, displayName: [firstName, lastName].filter(Boolean).join(' ') } : previous);
      return;
    }
    const response = await apiService.updateProfile({ firstName, lastName });
    setUser(response.user);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, password: string) => {
    if (!isDemoMode) await apiService.changePassword({ currentPassword, password });
  }, []);

  const deleteAccount = useCallback(async (currentPassword: string) => {
    await runSessionChange(() => isDemoMode ? undefined : apiService.deleteAccount(currentPassword));
    setSessionRevision(sessionWriteBoundary.capture());
    setUser(null);
    setWorkspace(null);
    setWorkspaces([]);
  }, [runSessionChange]);

  const acceptInvitation = useCallback(async (payload: { token: string; email: string; password: string; firstName?: string; lastName?: string }) => {
    if (isDemoMode) return;
    applyResponse(await runSessionChange(() => apiService.acceptInvitation(payload)));
  }, [applyResponse, runSessionChange]);

  const createWorkspace = useCallback(async (name: string) => {
    if (isDemoMode) {
      const created = createDemoWorkspace(name.trim());
      const nextWorkspaces = [...readDemoWorkspaces(), created];
      persistDemoWorkspaces(nextWorkspaces);
      setWorkspaces(nextWorkspaces);
      return created;
    }
    const created = await apiService.createWorkspace(name);
    setWorkspaces(previous => [...previous, created]);
    trackTelemetry('workspace_created');
    return created;
  }, []);

  const updateWorkspace = useCallback(async (name: string) => {
    if (!workspace) return;
    if (isDemoMode) {
      const nextWorkspaces = readDemoWorkspaces().map(item => item.id === workspace.id ? { ...item, name: name.trim() } : item);
      persistDemoWorkspaces(nextWorkspaces);
      const updated = nextWorkspaces.find(item => item.id === workspace.id) || workspace;
      setWorkspace(updated);
      setWorkspaces(nextWorkspaces);
      return;
    }
    const updated = await apiService.updateWorkspace(workspace.id, name);
    setWorkspace(previous => previous ? { ...previous, ...updated } : updated);
    setWorkspaces(previous => previous.map(item => item.id === updated.id ? { ...item, ...updated } : item));
  }, [workspace]);

  const resetWorkspace = useCallback(async (currentPassword: string, workspaceName: string, resetOptions: WorkspaceResetOptions) => {
    if (!workspace) return;
    if (isDemoMode) {
      await runSessionChange(() => resetDemoWorkspaceData(resetOptions));
      setSessionRevision(sessionWriteBoundary.capture());
      return;
    }
    await runSessionChange(() => apiService.resetWorkspace(workspace.id, { currentPassword, workspaceName, resetOptions }));
    setSessionRevision(sessionWriteBoundary.capture());
  }, [workspace, runSessionChange]);

  const deleteWorkspace = useCallback(async (currentPassword: string, workspaceName: string) => {
    if (!workspace) return;
    if (isDemoMode) {
      const remaining = readDemoWorkspaces().filter(item => item.id !== workspace.id);
      if (!remaining.length) throw new Error('Legen Sie zuerst einen Ersatz-Workspace an. Danach können Sie diesen Workspace löschen.');
      await runSessionChange(() => {
        deleteDemoWorkspaceData(workspace.id);
        persistDemoWorkspaces(remaining);
        setDemoActiveWorkspaceId(remaining[0].id);
      });
      setSessionRevision(sessionWriteBoundary.capture());
      setWorkspace(remaining[0]);
      setWorkspaces(remaining);
      return;
    }
    const result = await runSessionChange(() => apiService.deleteWorkspace(workspace.id, { currentPassword, workspaceName }));
    setSessionRevision(sessionWriteBoundary.capture());
    if (result.signedOut || !result.workspace) {
      setUser(null);
      setWorkspace(null);
      setWorkspaces([]);
    } else {
      setWorkspace(result.workspace);
      setWorkspaces(result.workspaces);
    }
  }, [workspace, runSessionChange]);

  const can = useCallback((permission: string) => {
    if (!workspace) return false;
    if (workspace.role === 'owner' || workspace.role === 'admin') return true;
    if (workspace.permissions?.[permission]) return true;
    if (permission === 'data.read') return true;
    return workspace.role === 'member' && permission === 'data.write';
  }, [workspace]);

  const getWorkspaceMembers = useCallback(() => isDemoMode ? Promise.resolve([]) : apiService.getWorkspaceMembers(workspace?.id || ''), [workspace?.id]);
  const updateWorkspaceMember = useCallback((userId: string, role: WorkspaceRole) => isDemoMode ? Promise.resolve({ id: userId, email: '', firstName: '', lastName: '', role }) : apiService.updateWorkspaceMember(workspace?.id || '', userId, role), [workspace?.id]);
  const removeWorkspaceMember = useCallback((userId: string) => isDemoMode ? Promise.resolve() : apiService.removeWorkspaceMember(workspace?.id || '', userId), [workspace?.id]);
  const getWorkspaceInvitations = useCallback(() => isDemoMode ? Promise.resolve([]) : apiService.getWorkspaceInvitations(workspace?.id || ''), [workspace?.id]);
  const createWorkspaceInvitation = useCallback((email: string, role: Exclude<WorkspaceRole, 'owner'> = 'member') => isDemoMode ? Promise.resolve({ id: `demo-invite-${Date.now()}`, email, role, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), inviteToken: 'demo-invite-token' }) : apiService.createWorkspaceInvitation(workspace?.id || '', email, role), [workspace?.id]);
  const revokeWorkspaceInvitation = useCallback((invitationId: string) => isDemoMode ? Promise.resolve() : apiService.revokeWorkspaceInvitation(workspace?.id || '', invitationId), [workspace?.id]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    workspace,
    workspaces,
    loading,
    sessionRevision,
    isAuthenticated: Boolean(user && workspace),
    login,
    register,
    logout,
    logoutAll,
    switchWorkspace,
    updateProfile,
    changePassword,
    deleteAccount,
    acceptInvitation,
    createWorkspace,
    updateWorkspace,
    resetWorkspace,
    deleteWorkspace,
    can,
    canManageWorkspace: workspace?.role === 'owner' || workspace?.role === 'admin',
    getWorkspaceMembers,
    updateWorkspaceMember,
    removeWorkspaceMember,
    getWorkspaceInvitations,
    createWorkspaceInvitation,
    revokeWorkspaceInvitation,
  }), [user, workspace, workspaces, loading, sessionRevision, login, register, logout, logoutAll, switchWorkspace, updateProfile, changePassword, deleteAccount, acceptInvitation, createWorkspace, updateWorkspace, resetWorkspace, deleteWorkspace, can, getWorkspaceMembers, updateWorkspaceMember, removeWorkspaceMember, getWorkspaceInvitations, createWorkspaceInvitation, revokeWorkspaceInvitation]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
