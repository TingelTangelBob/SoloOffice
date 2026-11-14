import { FormEvent, useEffect, useState } from 'react';
import { Loader2, LockKeyhole, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiService } from '../services/api';
import { SignupFlow } from './SignupFlow';
import { AUTH_LINK_QUERY_KEYS, hasSignupParams, readSignupParams, stripLinkParams } from '../utils/signupFlow';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset' | 'signup';

const legalLinks = {
  agb: import.meta.env.VITE_AGB_URL || 'https://solooffice.de/agb',
  avv: import.meta.env.VITE_AVV_URL || 'https://solooffice.de/avv',
  datenschutz: import.meta.env.VITE_DATENSCHUTZ_URL || 'https://solooffice.de/datenschutz',
  impressum: import.meta.env.VITE_IMPRESSUM_URL || 'https://solooffice.de/impressum',
  website: import.meta.env.VITE_WEBSITE_URL || 'https://solooffice.de',
};

export function AuthPage() {
  const { login, register, acceptInvitation } = useAuth();
  const searchParams = new URLSearchParams(window.location.search);
  // Einmal-Tokens aus E-Mail-Links: nur beim Start gelesen, nach Gebrauch auch aus der Adresse entfernt.
  const [invitationToken, setInvitationToken] = useState(() => searchParams.get('invite') || '');
  const [verificationToken, setVerificationToken] = useState(() => searchParams.get('verifyEmail') || '');
  const [resetToken, setResetToken] = useState(() => searchParams.get('resetPassword') || '');
  const [mode, setMode] = useState<AuthMode>(() => (searchParams.get('resetPassword') ? 'reset' : 'login'));
  // Registrierung über das Control Plane (`signupAvailable`): ersetzt die eigene Registrierung der Fachapp.
  const [signupParams] = useState(() => readSignupParams(window.location.search));
  const [signupAvailable, setSignupAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    apiService.getAuthConfig()
      .then(config => { if (active) setSignupAvailable(Boolean(config.signupAvailable)); })
      .catch(() => { if (active) setSignupAvailable(false); });
    return () => { active = false; };
  }, []);

  // Links aus E-Mails (`?verify=`, `?checkout=`, `?einladung=`) führen direkt in den Ablauf.
  useEffect(() => {
    if (signupAvailable && hasSignupParams(signupParams) && !resetToken && !invitationToken) setMode('signup');
  }, [signupAvailable, signupParams, resetToken, invitationToken]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!verificationToken) return;
    setBusy(true);
    apiService.verifyEmail(verificationToken)
      .then(response => setNotice(response.message))
      .catch(errorResponse => setError(errorResponse instanceof Error ? errorResponse.message : 'Die E-Mail-Adresse konnte nicht bestätigt werden.'))
      .finally(() => { setBusy(false); dropLinkTokens('verifyEmail'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verificationToken]);

  const stripLinkFromAddress = (which: (typeof AUTH_LINK_QUERY_KEYS)[number]) => {
    try { window.history.replaceState(window.history.state, '', stripLinkParams(window.location.href, [which])); } catch { /* Adresse bleibt, wie sie ist. */ }
  };
  const dropLinkTokens = (which: (typeof AUTH_LINK_QUERY_KEYS)[number]) => {
    if (which === 'invite') setInvitationToken('');
    else if (which === 'verifyEmail') setVerificationToken('');
    else setResetToken('');
    stripLinkFromAddress(which);
  };

  const selectMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError('');
    setNotice('');
    setPassword('');
    setPasswordConfirmation('');
    setTermsAccepted(false);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (showsPasswordConfirmation && password !== passwordConfirmation) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }
    if (isRegistration && !termsAccepted) {
      setError('Bitte bestätigen Sie, dass Sie Unternehmer sind und AGB sowie AVV akzeptieren.');
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
        dropLinkTokens('resetPassword');
        setMode('login');
      } else if (invitationToken) {
        await acceptInvitation({ token: invitationToken, email, password, firstName, lastName });
        // Nur die Adresse bereinigen: Die Sitzung steht, die Seite wechselt gleich.
        stripLinkFromAddress('invite');
      } else if (mode === 'login') {
        await login(email, password);
      } else {
        const response = await register({ email, password, firstName, lastName, workspaceName: workspaceName || undefined, termsAccepted });
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
  const showsPasswordConfirmation = isRegistration || mode === 'reset' || isInvitation;
  const title = mode === 'signup' ? 'Konto erstellen' : isInvitation ? 'Einladung annehmen' : mode === 'forgot' ? 'Passwort vergessen' : mode === 'reset' ? 'Passwort zurücksetzen' : mode === 'register' ? 'Konto erstellen' : 'Anmelden';

  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-8" style={{ background: 'linear-gradient(180deg, #fff 0%, #fbfdff 45%, #eef4fe 100%)' }}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={{ background: `url("${import.meta.env.BASE_URL}berglandschaft.svg") center bottom / max(100%, 1600px) auto no-repeat, radial-gradient(ellipse at 50% 85%, #dbeafe 0%, transparent 65%)` }} />
      <section className={`w-full ${mode === 'signup' ? 'max-w-2xl' : 'max-w-md'} rounded-2xl bg-white p-6 shadow-xl shadow-blue-950/10 sm:p-8`}>
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2.5 text-gray-900">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path d="M6 4.5A2.5 2.5 0 0 1 8.5 2h9.67c.66 0 1.3.26 1.77.73l5.33 5.33c.47.47.73 1.11.73 1.77V27.5A2.5 2.5 0 0 1 23.5 30h-15A2.5 2.5 0 0 1 6 27.5v-23Z" fill="#2563eb" />
              <path d="M18.5 2.3v5.2a2.5 2.5 0 0 0 2.5 2.5h5.2" fill="#60a5fa" />
              <rect x="10.5" y="14" width="11" height="1.8" rx="0.9" fill="#fff" opacity="0.55" />
              <rect x="10.5" y="18" width="8" height="1.8" rx="0.9" fill="#fff" opacity="0.55" />
              <rect x="10.5" y="22.6" width="6" height="2.4" rx="1.2" fill="#fff" />
            </svg>
            <span className="text-xl font-semibold tracking-tight">SoloOffice</span>
          </div>
          <h1 className="mt-2 text-sm font-normal text-gray-500">{title}</h1>
        </div>

        {!invitationToken && mode !== 'signup' && (mode === 'login' || mode === 'register') && (
          <div className="mb-6 grid grid-cols-2 rounded-lg bg-gray-100 p-1">
            {(['login', 'register'] as AuthMode[]).map(option => (
              <button
                key={option}
                type="button"
                onClick={() => selectMode(option === 'register' && signupAvailable ? 'signup' : option)}
                className={`rounded-md px-3 py-2 text-sm font-medium transition ${mode === option ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
              >
                {option === 'login' ? 'Anmelden' : signupAvailable ? 'Konto erstellen' : 'Registrieren'}
              </button>
            ))}
          </div>
        )}

        {mode === 'signup' ? (
          <SignupFlow params={signupParams} legalLinks={legalLinks} onBackToLogin={() => selectMode('login')} />
        ) : (
        <form onSubmit={handleSubmit} className="form-consistent-fields space-y-4" autoComplete="on">
          {(isRegistration || isInvitation) && (
            <div className="grid grid-cols-2 gap-3">
              <label htmlFor="auth-first-name" className="text-sm text-gray-700">Vorname<input id="auth-first-name" name="given-name" value={firstName} onChange={event => setFirstName(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" autoComplete="section-auth given-name" /></label>
              <label htmlFor="auth-last-name" className="text-sm text-gray-700">Nachname<input id="auth-last-name" name="family-name" value={lastName} onChange={event => setLastName(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" autoComplete="section-auth family-name" /></label>
            </div>
          )}

          {isRegistration && (
            <label htmlFor="auth-workspace-name" className="block text-sm text-gray-700">
              Workspace-Name
              <input
                id="auth-workspace-name"
                name="workspace-name"
                value={workspaceName}
                onChange={event => setWorkspaceName(event.target.value)}
                placeholder="z. B. Meine Firma"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                autoComplete="off"
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
              />
            </label>
          )}

          <label htmlFor="auth-email" className="block text-sm text-gray-700">
            E-Mail-Adresse
            <span className="relative mt-1 block">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input id="auth-email" name="email" type="email" required value={email} onChange={event => setEmail(event.target.value)} className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" autoComplete="section-auth email" />
            </span>
          </label>

          {showPassword && (
            <label htmlFor="auth-password" className="block text-sm text-gray-700">
              Passwort
              <span className="relative mt-1 block">
                <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input id="auth-password" name="password" type="password" required minLength={10} value={password} onChange={event => setPassword(event.target.value)} className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" autoComplete={`section-auth ${mode === 'login' ? 'current-password' : 'new-password'}`} />
              </span>
              {(isRegistration || mode === 'reset') && <span className="mt-1 block text-xs text-gray-500">Mindestens 10 Zeichen.</span>}
            </label>
          )}

          {showsPasswordConfirmation && (
            <label htmlFor="auth-password-confirmation" className="block text-sm text-gray-700">Passwort wiederholen<input id="auth-password-confirmation" name="password-confirmation" type="password" required minLength={10} value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" autoComplete="section-auth new-password" /></label>
          )}

          {isRegistration && (
            <label htmlFor="auth-terms-accepted" className="flex items-start gap-2 text-sm text-gray-700">
              <input id="auth-terms-accepted" name="terms-accepted" type="checkbox" required checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <span>
                Ich bin Unternehmer und akzeptiere <a href={legalLinks.agb} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">AGB</a> sowie <a href={legalLinks.avv} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">AVV</a>.
              </span>
            </label>
          )}

          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}

          <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {isInvitation ? 'Einladung annehmen' : mode === 'login' ? 'Anmelden' : mode === 'register' ? 'Konto erstellen' : mode === 'forgot' ? 'Link anfordern' : 'Passwort speichern'}
          </button>
        </form>
        )}

        {!invitationToken && mode === 'login' && <button type="button" onClick={() => selectMode('forgot')} className="mt-4 w-full text-sm text-blue-700 hover:underline">Passwort vergessen?</button>}
        {invitationToken && mode !== 'signup' && <button type="button" onClick={() => { dropLinkTokens('invite'); selectMode('login'); }} className="mt-4 w-full text-sm text-gray-600 hover:underline">Zur Anmeldung</button>}
        {!invitationToken && (mode === 'forgot' || mode === 'reset') && <button type="button" onClick={() => { if (resetToken) dropLinkTokens('resetPassword'); selectMode('login'); }} className="mt-4 w-full text-sm text-gray-600 hover:underline">Zurück zur Anmeldung</button>}

        <footer className="mt-8 border-t border-gray-200 pt-4 text-center text-xs text-gray-500">
          <a href={legalLinks.impressum} target="_blank" rel="noreferrer" className="hover:text-gray-900 hover:underline">Impressum</a>
          <span className="mx-2" aria-hidden="true">|</span>
          <a href={legalLinks.datenschutz} target="_blank" rel="noreferrer" className="hover:text-gray-900 hover:underline">Datenschutz</a>
          {signupAvailable && (
            <>
              <span className="mx-2" aria-hidden="true">|</span>
              <a href={legalLinks.agb} target="_blank" rel="noreferrer" className="hover:text-gray-900 hover:underline">AGB</a>
              <span className="mx-2" aria-hidden="true">|</span>
              <a href={legalLinks.website} target="_blank" rel="noreferrer" className="hover:text-gray-900 hover:underline">Zur Website</a>
            </>
          )}
        </footer>
      </section>
    </main>
  );
}
