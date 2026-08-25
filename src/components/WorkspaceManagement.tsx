import { FormEvent, useEffect, useState } from 'react';
import { Check, Copy, Plus, Save, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { WorkspaceInvitation, WorkspaceMember, WorkspaceRole } from '../types';
import { PageHeader } from './PageHeader';

const roleLabels: Record<WorkspaceRole, string> = {
  owner: 'Eigentümer',
  admin: 'Administrator',
  member: 'Mitarbeiter',
  viewer: 'Nur lesen',
};

export function WorkspaceManagement() {
  const {
    workspace,
    workspaces,
    switchWorkspace,
    createWorkspace,
    updateWorkspace,
    canManageWorkspace,
    getWorkspaceMembers,
    updateWorkspaceMember,
    removeWorkspaceMember,
    getWorkspaceInvitations,
    createWorkspaceInvitation,
  } = useAuth();
  const [workspaceName, setWorkspaceName] = useState(workspace?.name || '');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<WorkspaceRole, 'owner'>>('member');
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [latestInviteLink, setLatestInviteLink] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setWorkspaceName(workspace?.name || '');
  }, [workspace?.id, workspace?.name]);

  useEffect(() => {
    setMessage('');
    setLatestInviteLink('');
    if (!canManageWorkspace) {
      setMembers([]);
      setInvitations([]);
      return;
    }

    Promise.all([getWorkspaceMembers(), getWorkspaceInvitations()])
      .then(([memberData, invitationData]) => {
        setMembers(memberData);
        setInvitations(invitationData);
        setError('');
      })
      .catch(() => setError('Workspace-Mitglieder konnten nicht geladen werden.'));
  }, [canManageWorkspace, getWorkspaceInvitations, getWorkspaceMembers, workspace?.id]);

  const run = async (action: () => Promise<void>, successMessage: string) => {
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(successMessage);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Die Aktion konnte nicht abgeschlossen werden.');
    }
  };

  const handleRenameWorkspace = (event: FormEvent) => {
    event.preventDefault();
    return run(() => updateWorkspace(workspaceName), 'Workspace-Name gespeichert.');
  };

  const handleCreateWorkspace = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      const created = await createWorkspace(newWorkspaceName);
      setNewWorkspaceName('');
      await switchWorkspace(created.id);
    }, 'Workspace erstellt und aktiviert.');
  };

  const handleInvite = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      const invitation = await createWorkspaceInvitation(inviteEmail, inviteRole);
      setInviteEmail('');
      setLatestInviteLink(invitation.inviteLink || (invitation.inviteToken
        ? `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(invitation.inviteToken)}`
        : ''));
      setInvitations(previous => [invitation, ...previous]);
    }, 'Einladung erstellt.');
  };

  const copyInvite = async () => {
    if (!latestInviteLink) return;
    await navigator.clipboard?.writeText(latestInviteLink);
    setMessage('Einladungslink kopiert.');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Workspace"
        subtitle="Verwalte den aktiven Workspace, Mitglieder und Zugriffsrollen."
      />

      {message && <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"><Check className="h-4 w-4" />{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-primary-custom" />
            <div>
              <h2 className="font-semibold text-gray-900">Aktiver Workspace</h2>
              <p className="text-sm text-gray-500">Rolle: {workspace ? roleLabels[workspace.role] : '–'}</p>
            </div>
          </div>
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-sm text-gray-700 sm:max-w-xs">
            <span className="sr-only">Workspace auswählen</span>
            <select value={workspace?.id || ''} onChange={event => run(() => switchWorkspace(event.target.value), 'Workspace gewechselt.')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              {workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <form onSubmit={handleRenameWorkspace} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
            <label className="block text-sm font-medium text-gray-700">
              Workspace-Name
              <input required maxLength={255} value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} disabled={!canManageWorkspace} className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100" />
            </label>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-gray-500">Der Name ist für alle Mitglieder sichtbar.</p>
              {canManageWorkspace && <button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-primary-custom px-3 py-2 text-sm font-medium text-white"><Save className="h-4 w-4" />Speichern</button>}
            </div>
          </form>

          <form onSubmit={handleCreateWorkspace} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
            <label className="block text-sm font-medium text-gray-700">
              Neuer Workspace
              <input required maxLength={255} value={newWorkspaceName} onChange={event => setNewWorkspaceName(event.target.value)} placeholder="z. B. Nebenprojekt" className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
            </label>
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-xs text-gray-500">Du wirst danach automatisch gewechselt.</p>
              <button type="submit" className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700"><Plus className="h-4 w-4" />Anlegen</button>
            </div>
          </form>
        </div>
      </section>

      {canManageWorkspace ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 font-semibold text-gray-900">Mitglieder</h2>
            <p className="mb-4 text-sm text-gray-500">Rollen steuern, welche Bereiche bearbeitet werden dürfen.</p>
            <div className="space-y-2">
              {members.length === 0 && <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">Noch keine Mitglieder geladen.</p>}
              {members.map(member => <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{[member.firstName, member.lastName].filter(Boolean).join(' ') || member.email}</p>
                  <p className="truncate text-xs text-gray-500">{member.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {member.role === 'owner' ? <span className="text-xs font-medium text-gray-500">Eigentümer</span> : <>
                    <select value={member.role} onChange={event => run(async () => {
                      const updated = await updateWorkspaceMember(member.id, event.target.value as WorkspaceRole);
                      setMembers(previous => previous.map(item => item.id === updated.id ? { ...item, role: updated.role } : item));
                    }, 'Rolle aktualisiert.')} className="rounded border border-gray-300 px-2 py-1 text-xs">
                      <option value="admin">Administrator</option><option value="member">Mitarbeiter</option><option value="viewer">Nur lesen</option>
                    </select>
                    <button type="button" onClick={() => run(async () => {
                      await removeWorkspaceMember(member.id);
                      setMembers(previous => previous.filter(item => item.id !== member.id));
                    }, 'Mitglied entfernt.')} className="text-xs text-red-600 hover:underline">Entfernen</button>
                  </>}
                </div>
              </div>)}
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 font-semibold text-gray-900">Mitarbeiter einladen</h2>
            <p className="mb-4 text-sm text-gray-500">Einladungen gelten sieben Tage und können sicher weitergegeben werden.</p>
            <form onSubmit={handleInvite} className="space-y-2">
              <input type="email" required value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="E-Mail-Adresse" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <div className="flex flex-wrap gap-2">
                <select value={inviteRole} onChange={event => setInviteRole(event.target.value as Exclude<WorkspaceRole, 'owner'>)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="member">Mitarbeiter</option><option value="admin">Administrator</option><option value="viewer">Nur lesen</option></select>
                <button className="rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white">Einladung erstellen</button>
              </div>
            </form>
            {latestInviteLink && <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-800"><p className="font-medium">Einladungslink einmalig kopieren und sicher übermitteln:</p><div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 break-all">{latestInviteLink}</code><button type="button" onClick={copyInvite} title="Kopieren" className="rounded p-1 hover:bg-blue-100"><Copy className="h-4 w-4" /></button></div></div>}
            {invitations.length > 0 && <p className="mt-3 text-xs text-gray-500">{invitations.filter(invitation => !invitation.acceptedAt).length} offene Einladung(en)</p>}
          </section>
        </div>
      ) : (
        <section className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm">
          Du hast Leserechte in diesem Workspace. Workspace- und Teamänderungen sind nur für Administratoren und Eigentümer verfügbar.
        </section>
      )}
    </div>
  );
}
