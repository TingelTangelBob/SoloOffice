import { FormEvent, useEffect, useState } from 'react';
import { Check, Copy, LogOut, Plus, Shield, UserRound, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { WorkspaceInvitation, WorkspaceMember, WorkspaceRole } from '../types';

export function ProfileManagement() {
  const {
    user,
    workspace,
    workspaces,
    logout,
    logoutAll,
    switchWorkspace,
    updateProfile,
    changePassword,
    deleteAccount,
    createWorkspace,
    canManageWorkspace,
    getWorkspaceMembers,
    updateWorkspaceMember,
    removeWorkspaceMember,
    getWorkspaceInvitations,
    createWorkspaceInvitation,
  } = useAuth();
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<WorkspaceRole, 'owner'>>('member');
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [latestInviteLink, setLatestInviteLink] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setFirstName(user?.firstName || '');
    setLastName(user?.lastName || '');
  }, [user?.firstName, user?.lastName]);

  useEffect(() => {
    if (!canManageWorkspace) {
      setMembers([]);
      setInvitations([]);
      return;
    }
    Promise.all([getWorkspaceMembers(), getWorkspaceInvitations()])
      .then(([memberData, invitationData]) => {
        setMembers(memberData);
        setInvitations(invitationData);
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

  const submitProfile = (event: FormEvent) => {
    event.preventDefault();
    return run(() => updateProfile(firstName, lastName), 'Profil gespeichert.');
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
    }, 'Passwort geändert.');
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
      setLatestInviteLink(invitation.inviteLink || (invitation.inviteToken ? `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(invitation.inviteToken)}` : ''));
      setInvitations(previous => [{ ...invitation }, ...previous]);
    }, 'Einladung erstellt.');
  };

  const copyInvite = async () => {
    if (!latestInviteLink) return;
    await navigator.clipboard?.writeText(latestInviteLink);
      setMessage('Einladungstoken kopiert.');
  };

  const handleDeleteAccount = () => run(async () => {
    if (!window.confirm('Konto und eigene Workspaces endgültig löschen? Dieser Vorgang kann nicht rückgängig gemacht werden.')) return;
    await deleteAccount(deletePassword);
  }, 'Konto gelöscht.');

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary-custom">Konto & Workspace</p>
        <h1 className="mt-1 text-xl font-semibold text-gray-900 sm:text-2xl">Profil</h1>
        <p className="mt-1 text-sm text-gray-500">Verwalte deine persönlichen Daten, Sitzungen und Teamzugänge.</p>
      </div>

      {message && <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"><Check className="h-4 w-4" />{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3"><UserRound className="h-5 w-5 text-primary-custom" /><div><h2 className="font-semibold text-gray-900">Persönliche Daten</h2><p className="text-sm text-gray-500">{user?.email}</p></div></div>
          <form onSubmit={submitProfile} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-gray-700">Vorname<input value={firstName} onChange={event => setFirstName(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
              <label className="text-sm text-gray-700">Nachname<input value={lastName} onChange={event => setLastName(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
            </div>
            <button className="rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white">Profil speichern</button>
          </form>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3"><Shield className="h-5 w-5 text-primary-custom" /><div><h2 className="font-semibold text-gray-900">Passwort & Sitzungen</h2><p className="text-sm text-gray-500">Beim Passwortwechsel werden andere Sitzungen beendet.</p></div></div>
          <form onSubmit={submitPassword} className="space-y-3">
            <input type="password" required minLength={10} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} placeholder="Aktuelles Passwort" className="w-full rounded-lg border border-gray-300 px-3 py-2" autoComplete="current-password" />
            <input type="password" required minLength={10} value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="Neues Passwort (mind. 10 Zeichen)" className="w-full rounded-lg border border-gray-300 px-3 py-2" autoComplete="new-password" />
            <div className="flex flex-wrap gap-2"><button className="rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white">Passwort ändern</button><button type="button" onClick={() => run(logoutAll, 'Alle Sitzungen wurden beendet.')} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">Alle Sitzungen beenden</button></div>
          </form>
        </section>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Users className="h-5 w-5 text-primary-custom" /><div><h2 className="font-semibold text-gray-900">Workspace</h2><p className="text-sm text-gray-500">Aktiv: {workspace?.name} · Rolle: {workspace?.role}</p></div></div><select value={workspace?.id || ''} onChange={event => run(() => switchWorkspace(event.target.value), 'Workspace gewechselt.')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <form onSubmit={handleCreateWorkspace} className="mb-6 flex flex-wrap gap-2"><input required value={newWorkspaceName} onChange={event => setNewWorkspaceName(event.target.value)} placeholder="Neuen Workspace anlegen" className="min-w-[220px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" /><button className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"><Plus className="h-4 w-4" />Anlegen</button></form>

        {canManageWorkspace ? (
          <div className="grid gap-6 xl:grid-cols-2">
            <div>
              <h3 className="mb-3 text-sm font-semibold text-gray-900">Mitglieder</h3>
              <div className="space-y-2">{members.map(member => <div key={member.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2"><div className="min-w-0"><p className="truncate text-sm font-medium text-gray-900">{[member.firstName, member.lastName].filter(Boolean).join(' ') || member.email}</p><p className="truncate text-xs text-gray-500">{member.email}</p></div><div className="flex items-center gap-2">{member.role === 'owner' ? <span className="text-xs font-medium text-gray-500">Eigentümer</span> : <><select value={member.role} onChange={event => run(async () => { const updated = await updateWorkspaceMember(member.id, event.target.value as WorkspaceRole); setMembers(previous => previous.map(item => item.id === updated.id ? { ...item, role: updated.role } : item)); }, 'Rolle aktualisiert.')} className="rounded border border-gray-300 px-2 py-1 text-xs"><option value="admin">Admin</option><option value="member">Mitarbeiter</option><option value="viewer">Nur lesen</option></select><button type="button" onClick={() => run(async () => { await removeWorkspaceMember(member.id); setMembers(previous => previous.filter(item => item.id !== member.id)); }, 'Mitglied entfernt.')} className="text-xs text-red-600 hover:underline">Entfernen</button></>}</div></div>)}</div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold text-gray-900">Mitarbeiter einladen</h3>
              <form onSubmit={handleInvite} className="space-y-2"><input type="email" required value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="E-Mail-Adresse" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /><div className="flex gap-2"><select value={inviteRole} onChange={event => setInviteRole(event.target.value as Exclude<WorkspaceRole, 'owner'>)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="member">Mitarbeiter</option><option value="admin">Admin</option><option value="viewer">Nur lesen</option></select><button className="rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white">Einladung erstellen</button></div></form>
              {latestInviteLink && <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-800"><p className="font-medium">Einladungslink einmalig kopieren und sicher übermitteln:</p><div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 break-all">{latestInviteLink}</code><button type="button" onClick={copyInvite} title="Kopieren" className="rounded p-1 hover:bg-blue-100"><Copy className="h-4 w-4" /></button></div></div>}
              {invitations.length > 0 && <p className="mt-3 text-xs text-gray-500">{invitations.filter(invitation => !invitation.acceptedAt).length} offene Einladung(en)</p>}
            </div>
          </div>
        ) : <p className="text-sm text-gray-500">Du hast Leserechte in diesem Workspace. Teamverwaltung ist nur für Administratoren und Eigentümer verfügbar.</p>}
      </section>

      <button type="button" onClick={() => run(logout, 'Abgemeldet.')} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"><LogOut className="h-4 w-4" />Abmelden</button>

      <section className="rounded-xl border border-red-200 bg-red-50 p-5">
        <h2 className="font-semibold text-red-900">Konto löschen</h2>
        <p className="mt-1 text-sm text-red-800">Eigene Workspaces und Kontodaten werden endgültig gelöscht. Geteilte Workspaces müssen vorher übertragen werden.</p>
        <form onSubmit={event => { event.preventDefault(); void handleDeleteAccount(); }} className="mt-3 flex flex-wrap gap-2">
          <input type="password" required minLength={10} value={deletePassword} onChange={event => setDeletePassword(event.target.value)} placeholder="Aktuelles Passwort bestätigen" className="min-w-[240px] flex-1 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm" />
          <button type="submit" className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800">Konto endgültig löschen</button>
        </form>
      </section>
    </div>
  );
}
