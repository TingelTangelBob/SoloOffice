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
  gmx: { label: 'GMX', smtp_host: 'mail.gmx.net', smtp_port: '587', smtp_secure: false, hint: 'Das Passwort des GMX-Postfachs verwenden. In GMX muss unter Einstellungen → POP3/IMAP der Zugriff für externe Programme erlaubt sein.' },
  webde: { label: 'WEB.DE', smtp_host: 'smtp.web.de', smtp_port: '587', smtp_secure: false, hint: 'Das Passwort des WEB.DE-Postfachs verwenden. In WEB.DE muss unter Einstellungen → POP3/IMAP der Zugriff für externe Programme erlaubt sein.' },
  tonline: { label: 'T-Online', smtp_host: 'securesmtp.t-online.de', smtp_port: '587', smtp_secure: false, hint: 'Das E-Mail-Passwort aus dem Telekom-Kundencenter verwenden, nicht das Login-Passwort.' },
  ionos: { label: 'IONOS', smtp_host: 'smtp.ionos.de', smtp_port: '587', smtp_secure: false, hint: 'Das Passwort des IONOS-Postfachs verwenden.' },
  strato: { label: 'STRATO', smtp_host: 'smtp.strato.de', smtp_port: '587', smtp_secure: false, hint: 'Das Passwort des STRATO-Postfachs verwenden.' },
  outlook: { label: 'Outlook / Microsoft', smtp_host: 'smtp-mail.outlook.com', smtp_port: '587', smtp_secure: false, hint: 'Bei aktivierter Zwei-Faktor-Anmeldung ein App-Passwort von Microsoft verwenden.' },
  yahoo: { label: 'Yahoo', smtp_host: 'smtp.mail.yahoo.com', smtp_port: '587', smtp_secure: false, hint: 'Ein App-Passwort von Yahoo verwenden, nicht das normale Passwort.' },
  posteo: { label: 'Posteo', smtp_host: 'posteo.de', smtp_port: '587', smtp_secure: false, hint: 'Das Passwort des Posteo-Postfachs verwenden.' },
  mailbox: { label: 'mailbox.org', smtp_host: 'smtp.mailbox.org', smtp_port: '587', smtp_secure: false, hint: 'Das Passwort des mailbox.org-Postfachs verwenden.' },
} as const;
export type SmtpProvider = keyof typeof SMTP_PROVIDERS;

export function smtpProviderForSettings(settings: SmtpFormSettings): SmtpProvider {
  return (Object.keys(SMTP_PROVIDERS) as SmtpProvider[]).find(provider => {
    const preset = SMTP_PROVIDERS[provider];
    return provider !== 'eigen' && preset.smtp_host === settings.smtp_host.trim()
      && preset.smtp_port === settings.smtp_port.trim() && preset.smtp_secure === settings.smtp_secure;
  }) ?? 'eigen';
}

/** Mail-Domains bekannter Anbieter; eigene Domains lassen sich nicht sicher zuordnen. */
const SMTP_PROVIDER_DOMAINS: Record<string, Exclude<SmtpProvider, 'eigen' | 'hetzner'>> = {
  'gmail.com': 'gmail', 'googlemail.com': 'gmail',
  'icloud.com': 'icloud', 'me.com': 'icloud', 'mac.com': 'icloud',
  'gmx.net': 'gmx', 'gmx.de': 'gmx', 'gmx.at': 'gmx', 'gmx.ch': 'gmx', 'gmx.com': 'gmx',
  'web.de': 'webde',
  't-online.de': 'tonline', 'magenta.de': 'tonline',
  'ionos.de': 'ionos', '1und1.de': 'ionos', 'online.de': 'ionos',
  'strato.de': 'strato',
  'outlook.com': 'outlook', 'outlook.de': 'outlook', 'hotmail.com': 'outlook', 'hotmail.de': 'outlook', 'live.com': 'outlook', 'live.de': 'outlook',
  'yahoo.com': 'yahoo', 'yahoo.de': 'yahoo', 'ymail.com': 'yahoo',
  'posteo.de': 'posteo', 'posteo.net': 'posteo',
  'mailbox.org': 'mailbox',
};

/** Erkennt den Mailanbieter an der Domain der Absenderadresse; leer, wenn keine sichere Zuordnung möglich ist. */
export function detectSmtpProvider(email: string): SmtpProvider | null {
  const value = email.trim().toLowerCase();
  if (!isSingleEmailAddress(value)) return null;
  return SMTP_PROVIDER_DOMAINS[value.slice(value.lastIndexOf('@') + 1)] ?? null;
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
