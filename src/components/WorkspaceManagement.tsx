import { FormEvent, useEffect, useState } from 'react';
import { Check, Copy, Plus, RotateCcw, Save, Trash2, Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { WorkspaceInvitation, WorkspaceMember, WorkspaceRole } from '../types';
import { PageHeader } from './PageHeader';
import { formatCountLabel } from '../utils/terminology';
import { ConfirmationModal } from './ConfirmationModal';
import { useFeedback } from '../context/FeedbackContext';

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
    resetWorkspace,
    deleteWorkspace,
    canManageWorkspace,
    getWorkspaceMembers,
    updateWorkspaceMember,
    removeWorkspaceMember,
    getWorkspaceInvitations,
    createWorkspaceInvitation,
    revokeWorkspaceInvitation,
  } = useAuth();
  const { confirm } = useFeedback();
  const [workspaceName, setWorkspaceName] = useState(workspace?.name || '');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<WorkspaceRole, 'owner'>>('member');
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [latestInviteLink, setLatestInviteLink] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dangerAction, setDangerAction] = useState<'reset' | 'delete' | null>(null);
  const [dangerStep, setDangerStep] = useState<1 | 2>(1);
  const [dangerPassword, setDangerPassword] = useState('');
  const [dangerName, setDangerName] = useState('');

  useEffect(() => {
    setWorkspaceName(workspace?.name || '');
  }, [workspace?.id, workspace?.name]);

  useEffect(() => {
    if (workspace?.role !== 'owner' && inviteRole === 'admin') setInviteRole('member');
  }, [workspace?.role, inviteRole]);

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

  useEffect(() => {
    if (!dangerAction || dangerStep !== 1) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDangerAction(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [dangerAction, dangerStep]);

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

  const beginDangerAction = (action: 'reset' | 'delete') => {
    setError('');
    setDangerAction(action);
    setDangerStep(1);
    setDangerPassword('');
    setDangerName('');
  };

  const finishDangerAction = async () => {
    if (!dangerAction || !workspace) return;
    setError('');
    try {
      if (dangerAction === 'reset') {
        await resetWorkspace(dangerPassword, dangerName);
        setMessage('Workspace zurückgesetzt. Team und Umzugs-Claim bleiben erhalten.');
        window.setTimeout(() => window.location.reload(), 750);
      } else {
        await deleteWorkspace(dangerPassword, dangerName);
        setMessage('Workspace gelöscht.');
      }
      setDangerAction(null);
      setDangerPassword('');
      setDangerName('');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Die Aktion konnte nicht abgeschlossen werden.');
      setDangerStep(1);
    } finally {
      setDangerPassword('');
    }
  };

  const copyInvite = async () => {
    if (!latestInviteLink) return;
    await navigator.clipboard?.writeText(latestInviteLink);
    setMessage('Einladungslink kopiert.');
  };

  return (
    <div className="page-root space-y-6">
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
          <form onSubmit={handleRenameWorkspace} className="form-consistent-fields rounded-lg border border-gray-100 bg-gray-50 p-4">
            <label className="block text-sm font-medium text-gray-700">
              Workspace-Name
              <input required maxLength={255} value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} disabled={!canManageWorkspace} className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100" />
            </label>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-gray-500">Der Name ist für alle Mitglieder sichtbar.</p>
              {canManageWorkspace && <button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-primary-custom px-3 py-2 text-sm font-medium text-white"><Save className="h-4 w-4" />Speichern</button>}
            </div>
          </form>

          <form onSubmit={handleCreateWorkspace} className="form-consistent-fields rounded-lg border border-gray-100 bg-gray-50 p-4">
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
                    <select value={member.role} aria-label={`Rolle für ${member.email}`} onChange={event => run(async () => {
                      const nextRole = event.target.value as WorkspaceRole;
                      if (!await confirm({ title: 'Rolle ändern?', message: `Die Rolle von ${member.email} wird auf „${roleLabels[nextRole]}“ gesetzt.`, confirmText: 'Rolle ändern' })) return;
                      const updated = await updateWorkspaceMember(member.id, nextRole);
                      setMembers(previous => previous.map(item => item.id === updated.id ? { ...item, role: updated.role } : item));
                    }, 'Rolle aktualisiert.')} className="rounded border border-gray-300 px-2 py-1 text-xs">
                      {workspace?.role === 'owner' && <option value="admin">Administrator</option>}<option value="member">Mitarbeiter</option><option value="viewer">Nur lesen</option>
                    </select>
                    <button type="button" onClick={() => run(async () => {
                      if (!await confirm({ title: 'Mitglied entfernen?', message: `${member.email} verliert den Zugriff auf diesen Workspace.`, confirmText: 'Mitglied entfernen', isDestructive: true })) return;
                      await removeWorkspaceMember(member.id);
                      setMembers(previous => previous.filter(item => item.id !== member.id));
                    }, 'Mitglied entfernt.')} className="text-xs text-red-600 hover:underline">Entfernen</button>
                  </>}
                </div>
              </div>)}
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 font-semibold text-gray-900">Einladen und offene Einladungen</h2>
            <p className="mb-4 text-sm text-gray-500">Einladungen gelten sieben Tage und können sicher weitergegeben werden.</p>
            <form onSubmit={handleInvite} className="form-consistent-fields space-y-2">
              <input type="email" required value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="E-Mail-Adresse" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <div className="flex flex-wrap gap-2">
                <select value={inviteRole} onChange={event => setInviteRole(event.target.value as Exclude<WorkspaceRole, 'owner'>)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="member">Mitarbeiter</option>{workspace?.role === 'owner' && <option value="admin">Administrator</option>}<option value="viewer">Nur lesen</option></select>
                <button className="rounded-lg bg-primary-custom px-4 py-2 text-sm font-medium text-white">Einladung erstellen</button>
              </div>
            </form>
            {latestInviteLink && <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-800"><p className="font-medium">Einladungslink einmalig kopieren und sicher übermitteln:</p><div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 break-all">{latestInviteLink}</code><button type="button" onClick={copyInvite} title="Kopieren" className="rounded p-1 hover:bg-blue-100"><Copy className="h-4 w-4" /></button></div></div>}
            <div className="mt-4 border-t border-gray-100 pt-3">
              <p className="mb-2 text-sm font-medium text-gray-800">{formatCountLabel(invitations.filter(invitation => !invitation.acceptedAt && new Date(invitation.expiresAt) > new Date()).length, 'Offene Einladung', 'Offene Einladungen')}</p>
              {invitations.filter(invitation => !invitation.acceptedAt && new Date(invitation.expiresAt) > new Date()).length === 0
                ? <p className="text-sm text-gray-500">Keine offenen Einladungen.</p>
                : <ul className="space-y-2">{invitations.filter(invitation => !invitation.acceptedAt && new Date(invitation.expiresAt) > new Date()).map(invitation => <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm"><span className="min-w-0 break-all">{invitation.email} · {roleLabels[invitation.role]}</span><span className="flex items-center gap-3 text-xs text-gray-500">Läuft ab {new Date(invitation.expiresAt).toLocaleDateString('de-DE')}<button type="button" onClick={() => run(async () => {
                  if (!await confirm({ title: 'Einladung widerrufen?', message: `Die Einladung an ${invitation.email} wird ungültig.`, confirmText: 'Einladung widerrufen', isDestructive: true })) return;
                  await revokeWorkspaceInvitation(invitation.id);
                  setInvitations(previous => previous.filter(item => item.id !== invitation.id));
                }, 'Einladung widerrufen.')} className="font-medium text-red-700 hover:underline">Widerrufen</button></span></li>)}</ul>}
            </div>
            <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-600"><p><strong>Rollen:</strong> Eigentümer verwalten den Workspace und können ihn zurücksetzen oder löschen. Administratoren verwalten Mitglieder und Einstellungen, dürfen aber keine Administratoren ernennen. Mitarbeiter bearbeiten Fachdaten; „Nur lesen“ erlaubt ausschließlich den Zugriff.</p></div>
          </section>
        </div>
      ) : (
        <section className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm">
          Du hast Leserechte in diesem Workspace. Workspace- und Teamänderungen sind nur für Administratoren und Eigentümer verfügbar.
        </section>
      )}

      {workspace?.role === 'owner' && <section className="rounded-xl border border-red-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-red-900">Workspace zurücksetzen oder löschen</h2>
        <p className="mt-1 text-sm text-gray-600">Beide Aktionen verlangen dein Passwort, den exakten Workspace-Namen und eine zweite Bestätigung.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4"><h3 className="font-medium text-gray-900">Workspace zurücksetzen</h3><p className="mt-1 text-sm text-gray-600">Löscht Fachdaten, Einstellungen, SMTP, Belege, Sicherungen und offene Einladungen. Team, Workspace-Identität und verbrauchter Umzugs-Claim bleiben. Eine offene Umzugssitzung muss zuerst abgeschlossen werden.</p><button type="button" onClick={() => beginDangerAction('reset')} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-500 px-3 py-2 text-sm font-medium text-amber-900"><RotateCcw className="h-4 w-4" />Zurücksetzen</button></div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-4"><h3 className="font-medium text-gray-900">Workspace löschen</h3><p className="mt-1 text-sm text-gray-600">Löscht Daten, Team, Einladungen, Umzugs-/Setup-Zustand und Sicherungsdateien dauerhaft. Bei weiteren Mitgliedern ist die Löschung gesperrt. Lege zuerst einen Ersatz-Workspace an, wenn dies dein letzter ist; danach wirst du dorthin gewechselt.</p><button type="button" onClick={() => beginDangerAction('delete')} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white"><Trash2 className="h-4 w-4" />Workspace löschen</button></div>
        </div>
      </section>}

      {dangerAction && dangerStep === 1 && <div className="dialog-overlay fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setDangerAction(null); }}>
        <form role="dialog" aria-modal="true" aria-labelledby="workspace-danger-title" onSubmit={event => { event.preventDefault(); setDangerStep(2); }} className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl sm:p-6">
          <div className="flex items-start justify-between gap-3"><div><h2 id="workspace-danger-title" className="text-lg font-semibold text-gray-900">{dangerAction === 'reset' ? 'Workspace zurücksetzen' : 'Workspace löschen'}</h2><p className="mt-2 text-sm text-gray-600">Gib dein aktuelles Passwort und zur Bestätigung exakt „{workspace?.name}“ ein.</p></div><button type="button" aria-label="Schließen" onClick={() => setDangerAction(null)} className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button></div>
          {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <div className="form-consistent-fields mt-5 space-y-3"><label className="block text-sm font-medium text-gray-700">Aktuelles Passwort<input type="password" autoFocus autoComplete="current-password" required value={dangerPassword} onChange={event => setDangerPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label><label className="block text-sm font-medium text-gray-700">Workspace-Name<input autoComplete="off" required value={dangerName} onChange={event => setDangerName(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label></div>
          <div className="mt-6 flex flex-col-reverse gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={() => setDangerAction(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Abbrechen</button><button type="submit" disabled={dangerName.trim() !== workspace?.name} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Weiter zur zweiten Bestätigung</button></div>
        </form>
      </div>}
      <ConfirmationModal isOpen={Boolean(dangerAction && dangerStep === 2)} onClose={() => setDangerAction(null)} onConfirm={() => void finishDangerAction()} title={dangerAction === 'reset' ? 'Zurücksetzen endgültig bestätigen' : 'Löschen endgültig bestätigen'} message={dangerAction === 'reset' ? `Alle Fach- und Konfigurationsdaten in „${workspace?.name}“ werden gelöscht. Mitglieder, Workspace-Identität und der Umzugs-Claim bleiben erhalten.` : `„${workspace?.name}“ und seine Daten werden dauerhaft gelöscht. Bei weiteren Mitgliedern oder ohne Ersatz-Workspace wird die Aktion abgewiesen.`} confirmText="Jetzt endgültig bestätigen" cancelText="Zurück" isDestructive />
    </div>
  );
}
