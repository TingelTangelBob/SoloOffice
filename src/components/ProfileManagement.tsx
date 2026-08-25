import { FormEvent, useEffect, useState } from 'react';
import { Check, LogOut, Shield, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from './PageHeader';
import { useFeedback } from '../context/FeedbackContext';

export function ProfileManagement() {
  const { confirm } = useFeedback();
  const {
    user,
    logout,
    logoutAll,
    updateProfile,
    changePassword,
    deleteAccount,
  } = useAuth();
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setFirstName(user?.firstName || '');
    setLastName(user?.lastName || '');
  }, [user?.firstName, user?.lastName]);

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

  const handleDeleteAccount = () => run(async () => {
    const confirmed = await confirm({
      title: 'Konto endgültig löschen',
      message: 'Konto und eigene Workspaces endgültig löschen? Dieser Vorgang kann nicht rückgängig gemacht werden.',
      confirmText: 'Endgültig löschen',
      isDestructive: true,
    });
    if (!confirmed) return;
    await deleteAccount(deletePassword);
  }, 'Konto gelöscht.');

  return (
    <div className="space-y-6">
      <PageHeader icon={UserRound} title="Profil" subtitle="Verwalte deine persönlichen Daten, Sitzungen und Teamzugänge." />

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
