import { FormEvent, useEffect, useState } from 'react';
import { Building2, Loader2, LockKeyhole, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiService } from '../services/api';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

export function AuthPage() {
  const { login, register, acceptInvitation } = useAuth();
  const searchParams = new URLSearchParams(window.location.search);
  const invitationToken = searchParams.get('invite') || '';
  const verificationToken = searchParams.get('verifyEmail') || '';
  const resetToken = searchParams.get('resetPassword') || '';
  const [mode, setMode] = useState<AuthMode>(resetToken ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!verificationToken) return;
    setBusy(true);
    apiService.verifyEmail(verificationToken)
      .then(response => setNotice(response.message))
      .catch(errorResponse => setError(errorResponse instanceof Error ? errorResponse.message : 'Die E-Mail-Adresse konnte nicht bestätigt werden.'))
      .finally(() => setBusy(false));
  }, [verificationToken]);

  const selectMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError('');
    setNotice('');
    setPassword('');
    setPasswordConfirmation('');
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if ((mode === 'register' || mode === 'reset') && password !== passwordConfirmation) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'forgot') {
        const response = await apiService.requestPasswordReset(email);
        setNotice(response.message);
        setMode('login');
      } else if (mode === 'reset') {
        const response = await apiService.resetPassword({ token: resetToken, password });
        setNotice(response.message);
        setMode('login');
      } else if (invitationToken) {
        await acceptInvitation({ token: invitationToken, email, password, firstName, lastName });
      } else if (mode === 'login') {
        await login(email, password);
      } else {
        const response = await register({ email, password, firstName, lastName, workspaceName: workspaceName || undefined });
        if (response.verificationRequired) {
          setNotice(response.message || 'Bitte bestätigen Sie Ihre E-Mail-Adresse.');
          setMode('login');
          setPassword('');
        }
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Die Anmeldung konnte nicht abgeschlossen werden.');
    } finally {
      setBusy(false);
    }
  };

  const showPassword = mode !== 'forgot';
  const isRegistration = mode === 'register' && !invitationToken;
  const isInvitation = Boolean(invitationToken);
  const title = isInvitation ? 'Einladung annehmen' : mode === 'forgot' ? 'Passwort vergessen' : mode === 'reset' ? 'Passwort zurücksetzen' : mode === 'register' ? 'Konto erstellen' : 'Anmelden';

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <section className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white">
            <Building2 className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">SoloOffice</h1>
          <p className="mt-2 text-sm text-gray-500">{title}</p>
        </div>

        {!invitationToken && (mode === 'login' || mode === 'register') && (
          <div className="mb-6 grid grid-cols-2 rounded-lg bg-gray-100 p-1">
            {(['login', 'register'] as AuthMode[]).map(option => (
              <button
                key={option}
                type="button"
                onClick={() => selectMode(option)}
                className={`rounded-md px-3 py-2 text-sm font-medium transition ${mode === option ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
              >
                {option === 'login' ? 'Anmelden' : 'Registrieren'}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {(isRegistration || isInvitation) && (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-gray-700">Vorname<input value={firstName} onChange={event => setFirstName(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" autoComplete="given-name" /></label>
              <label className="text-sm text-gray-700">Nachname<input value={lastName} onChange={event => setLastName(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" autoComplete="family-name" /></label>
            </div>
          )}

          <label className="block text-sm text-gray-700">
            E-Mail-Adresse
            <span className="relative mt-1 block">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input type="email" required value={email} onChange={event => setEmail(event.target.value)} className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" autoComplete="email" />
            </span>
          </label>

          {isRegistration && (
            <label className="block text-sm text-gray-700">Workspace-Name<input value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} placeholder="z. B. Meine Firma" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" autoComplete="organization" /></label>
          )}

          {showPassword && (
            <label className="block text-sm text-gray-700">
              Passwort
              <span className="relative mt-1 block">
                <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input type="password" required minLength={10} value={password} onChange={event => setPassword(event.target.value)} className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
              </span>
              {(isRegistration || mode === 'reset') && <span className="mt-1 block text-xs text-gray-500">Mindestens 10 Zeichen.</span>}
            </label>
          )}

          {(isRegistration || mode === 'reset' || isInvitation) && (
            <label className="block text-sm text-gray-700">Passwort wiederholen<input type="password" required minLength={10} value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" autoComplete="new-password" /></label>
          )}

          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}

          <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {isInvitation ? 'Einladung annehmen' : mode === 'login' ? 'Anmelden' : mode === 'register' ? 'Konto erstellen' : mode === 'forgot' ? 'Link anfordern' : 'Passwort speichern'}
          </button>
        </form>

        {!invitationToken && mode === 'login' && <button type="button" onClick={() => selectMode('forgot')} className="mt-4 w-full text-sm text-blue-700 hover:underline">Passwort vergessen?</button>}
        {!invitationToken && (mode === 'forgot' || mode === 'reset') && <button type="button" onClick={() => selectMode('login')} className="mt-4 w-full text-sm text-gray-600 hover:underline">Zurück zur Anmeldung</button>}
      </section>
    </main>
  );
}
