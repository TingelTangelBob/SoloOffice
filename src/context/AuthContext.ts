import { createContext, useContext } from 'react';
import type {
  AuthUser,
  RegistrationPayload,
  RegistrationResponse,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceSummary,
} from '../types';

export interface AuthContextValue {
  user: AuthUser | null;
  workspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, workspaceId?: string) => Promise<void>;
  register: (payload: RegistrationPayload) => Promise<RegistrationResponse>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  updateProfile: (firstName: string, lastName: string) => Promise<void>;
  changePassword: (currentPassword: string, password: string) => Promise<void>;
  deleteAccount: (currentPassword: string) => Promise<void>;
  acceptInvitation: (payload: { token: string; email: string; password: string; firstName?: string; lastName?: string }) => Promise<void>;
  createWorkspace: (name: string) => Promise<WorkspaceSummary>;
  updateWorkspace: (name: string) => Promise<void>;
  resetWorkspace: (currentPassword: string, workspaceName: string) => Promise<void>;
  deleteWorkspace: (currentPassword: string, workspaceName: string) => Promise<void>;
  can: (permission: string) => boolean;
  canManageWorkspace: boolean;
  getWorkspaceMembers: () => Promise<WorkspaceMember[]>;
  updateWorkspaceMember: (userId: string, role: WorkspaceRole) => Promise<WorkspaceMember>;
  removeWorkspaceMember: (userId: string) => Promise<void>;
  getWorkspaceInvitations: () => Promise<WorkspaceInvitation[]>;
  createWorkspaceInvitation: (email: string, role?: Exclude<WorkspaceRole, 'owner'>) => Promise<WorkspaceInvitation>;
  revokeWorkspaceInvitation: (invitationId: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
