import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiService } from '../services/api';
import { DEMO_DEFAULT_WORKSPACE_ID, getDemoActiveWorkspaceId, isDemoMode, setDemoActiveWorkspaceId } from '../services/demoApi';
import { generateUUID } from '../utils/uuid';
import type { AuthResponse, AuthUser, RegistrationResponse, WorkspaceInvitation, WorkspaceMember, WorkspaceRole, WorkspaceSummary } from '../types';

interface AuthContextValue {
  user: AuthUser | null;
  workspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, workspaceId?: string) => Promise<void>;
  register: (payload: { email: string; password: string; firstName?: string; lastName?: string; workspaceName?: string }) => Promise<RegistrationResponse>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  updateProfile: (firstName: string, lastName: string) => Promise<void>;
  changePassword: (currentPassword: string, password: string) => Promise<void>;
  deleteAccount: (currentPassword: string) => Promise<void>;
  acceptInvitation: (payload: { token: string; email: string; password: string; firstName?: string; lastName?: string }) => Promise<void>;
  createWorkspace: (name: string) => Promise<WorkspaceSummary>;
  can: (permission: string) => boolean;
  canManageWorkspace: boolean;
  getWorkspaceMembers: () => Promise<WorkspaceMember[]>;
  updateWorkspaceMember: (userId: string, role: WorkspaceRole) => Promise<WorkspaceMember>;
  removeWorkspaceMember: (userId: string) => Promise<void>;
  getWorkspaceInvitations: () => Promise<WorkspaceInvitation[]>;
  createWorkspaceInvitation: (email: string, role?: Exclude<WorkspaceRole, 'owner'>) => Promise<WorkspaceInvitation>;
}

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

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

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

  const applyResponse = useCallback((response: AuthResponse) => {
    applyAuthResponse(response, { setUser, setWorkspace, setWorkspaces });
  }, []);

  useEffect(() => {
    let active = true;
    const handleAuthExpired = () => {
      setUser(null);
      setWorkspace(null);
      setWorkspaces([]);
    };
    window.addEventListener('solooffice-auth-expired', handleAuthExpired);
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
      };
    }

    apiService.getAuthSession()
      .then(response => {
        if (active) applyResponse(response);
      })
      .catch(() => {
        if (active) {
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
    };
  }, [applyResponse]);

  const login = useCallback(async (email: string, password: string, workspaceId?: string) => {
    if (isDemoMode) return;
    applyResponse(await apiService.loginAccount({ email, password, workspaceId }));
  }, [applyResponse]);

  const register = useCallback(async (payload: { email: string; password: string; firstName?: string; lastName?: string; workspaceName?: string }) => {
    if (isDemoMode) return {};
    const response = await apiService.registerAccount(payload);
    if (response.user && response.workspace && response.workspaces) {
      applyResponse({ user: response.user, workspace: response.workspace, workspaces: response.workspaces });
    }
    return response;
  }, [applyResponse]);

  const logout = useCallback(async () => {
    if (!isDemoMode) await apiService.logoutAccount();
    setUser(null);
    setWorkspace(null);
    setWorkspaces([]);
  }, []);

  const logoutAll = useCallback(async () => {
    if (!isDemoMode) await apiService.logoutAllSessions();
    setUser(null);
    setWorkspace(null);
    setWorkspaces([]);
  }, []);

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    if (isDemoMode) {
      const nextWorkspace = readDemoWorkspaces().find(item => item.id === workspaceId);
      if (nextWorkspace) {
        setDemoActiveWorkspaceId(nextWorkspace.id);
        setWorkspace(nextWorkspace);
      }
      return;
    }
    applyResponse(await apiService.switchWorkspace(workspaceId));
  }, [applyResponse]);

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
    if (!isDemoMode) await apiService.deleteAccount(currentPassword);
    setUser(null);
    setWorkspace(null);
    setWorkspaces([]);
  }, []);

  const acceptInvitation = useCallback(async (payload: { token: string; email: string; password: string; firstName?: string; lastName?: string }) => {
    if (isDemoMode) return;
    applyResponse(await apiService.acceptInvitation(payload));
  }, [applyResponse]);

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
    return created;
  }, []);

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

  const value = useMemo<AuthContextValue>(() => ({
    user,
    workspace,
    workspaces,
    loading,
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
    can,
    canManageWorkspace: workspace?.role === 'owner' || workspace?.role === 'admin',
    getWorkspaceMembers,
    updateWorkspaceMember,
    removeWorkspaceMember,
    getWorkspaceInvitations,
    createWorkspaceInvitation,
  }), [user, workspace, workspaces, loading, login, register, logout, logoutAll, switchWorkspace, updateProfile, changePassword, deleteAccount, acceptInvitation, createWorkspace, can, getWorkspaceMembers, updateWorkspaceMember, removeWorkspaceMember, getWorkspaceInvitations, createWorkspaceInvitation]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
