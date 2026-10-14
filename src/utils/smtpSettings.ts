export interface SmtpFormSettings {
  smtp_host: string;
  smtp_port: string;
  smtp_secure: boolean;
  smtp_user: string;
  /** Nur eine neue Eingabe; ein gespeichertes Passwort bleibt immer leer. */
  smtp_pass: string;
  smtp_pass_set: boolean;
  email_from: string;
  email_from_name: string;
  is_enabled: boolean;
  test_email: string;
}

export type SmtpFieldErrors = Partial<Record<keyof SmtpFormSettings, string>>;

/** SMTP-Werte der vorhandenen Dashboard-Vorlagen; die Einrichtung bleibt anpassbar. */
export const SMTP_PROVIDERS = {
  eigen: { label: 'Eigener Server', smtp_host: '', smtp_port: '587', smtp_secure: false, hint: 'Die Zugangsdaten stehen bei Ihrem Mailanbieter.' },
  hetzner: { label: 'Hetzner (KonsoleH)', smtp_host: 'mail.your-server.de', smtp_port: '587', smtp_secure: false, hint: 'Das Passwort des Postfachs verwenden.' },
  gmail: { label: 'Gmail (App-Passwort)', smtp_host: 'smtp.gmail.com', smtp_port: '465', smtp_secure: true, hint: 'Ein App-Passwort von Google verwenden, nicht das normale Gmail-Passwort.' },
  icloud: { label: 'iCloud', smtp_host: 'smtp.mail.me.com', smtp_port: '587', smtp_secure: false, hint: 'Ein app-spezifisches Passwort von Apple verwenden, nicht das Apple-ID-Passwort.' },
} as const;
export type SmtpProvider = keyof typeof SMTP_PROVIDERS;

export function smtpProviderForSettings(settings: SmtpFormSettings): SmtpProvider {
  return (Object.keys(SMTP_PROVIDERS) as SmtpProvider[]).find(provider => {
    const preset = SMTP_PROVIDERS[provider];
    return provider !== 'eigen' && preset.smtp_host === settings.smtp_host.trim()
      && preset.smtp_port === settings.smtp_port.trim() && preset.smtp_secure === settings.smtp_secure;
  }) ?? 'eigen';
}

export function smtpFormFromSettings(settings: Record<string, unknown> = {}): SmtpFormSettings {
  const text = (key: string) => typeof settings[key] === 'string' ? settings[key] as string : '';
  return {
    smtp_host: text('smtp_host'),
    smtp_port: String(settings.smtp_port ?? 587),
    smtp_secure: settings.smtp_secure === true,
    smtp_user: text('smtp_user'),
    smtp_pass: '',
    smtp_pass_set: settings.smtp_pass_set === true || text('smtp_pass') === '****',
    email_from: text('email_from'),
    email_from_name: text('email_from_name'),
    is_enabled: settings.is_enabled === true,
    test_email: text('test_email'),
  };
}

export function smtpSettingsPayload(settings: SmtpFormSettings): Record<string, unknown> {
  return {
    smtp_host: settings.smtp_host.trim(),
    smtp_port: Number(settings.smtp_port.trim()),
    smtp_secure: settings.smtp_secure,
    smtp_user: settings.smtp_user.trim(),
    smtp_pass: settings.smtp_pass,
    email_from: settings.email_from.trim(),
    email_from_name: settings.email_from_name.trim(),
    is_enabled: settings.is_enabled,
    test_email: settings.test_email.trim(),
  };
}

export function smtpSettingsDirty(saved: SmtpFormSettings | null, current: SmtpFormSettings): boolean {
  return saved !== null && JSON.stringify(smtpSettingsPayload(saved)) !== JSON.stringify(smtpSettingsPayload(current));
}

export function isSingleEmailAddress(value: string): boolean {
  // Header-Steuerzeichen müssen auch dann abgewiesen werden, wenn trim sie entfernen würde.
  const hasControlCharacters = Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  return !hasControlCharacters && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value.trim());
}

/** Deaktivierte Konfigurationen dürfen unvollständig bleiben; eine Prüfung benötigt alle Zugangsdaten. */
export function validateSmtpSettings(settings: SmtpFormSettings, requireConnection = settings.is_enabled): SmtpFieldErrors {
  const errors: SmtpFieldErrors = {};
  const host = settings.smtp_host.trim();
  if (requireConnection && !host) errors.smtp_host = 'Bitte den SMTP-Server eintragen.';
  else if (host && /[\s/@?#]/.test(host)) errors.smtp_host = 'Nur den Servernamen eintragen, ohne https:// oder Pfad.';

  const port = settings.smtp_port.trim();
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    errors.smtp_port = 'Bitte einen Port von 1 bis 65535 eintragen.';
  }
  if (requireConnection && !settings.smtp_user.trim()) errors.smtp_user = 'Bitte den Benutzernamen eintragen.';
  if (requireConnection && !settings.smtp_pass && !settings.smtp_pass_set) errors.smtp_pass = 'Bitte das Passwort des Postfachs eintragen.';
  if (requireConnection && !settings.email_from.trim()) errors.email_from = 'Bitte die Absenderadresse eintragen.';
  else if (settings.email_from.trim() && !isSingleEmailAddress(settings.email_from)) errors.email_from = 'Bitte eine gültige Absenderadresse eintragen.';
  return errors;
}

export function defaultTestEmailRecipient(settings: SmtpFormSettings): string {
  return settings.test_email.trim() || settings.email_from.trim();
}
