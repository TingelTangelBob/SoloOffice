// Gemeinsame Regeln für gespeicherte Zugangsdaten, Verbindungsprüfung und Testmail.
export const isSingleEmailAddress = value => typeof value === 'string'
  && !/[\x00-\x1f\x7f]/u.test(value)
  && /^[^\s@<>,;\x00-\x1f\x7f]+@[^\s@<>,;\x00-\x1f\x7f]+\.[^\s@<>,;\x00-\x1f\x7f]+$/u.test(value.trim());

export class SmtpSettingsError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const text = (value, label, max = 255) => {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max || /[\r\n\0]/u.test(value)) {
    throw new SmtpSettingsError(`${label} ist ungültig.`);
  }
  return value.trim();
};

export function smtpPassword(input, storedPassword = '') {
  if (input == null || input === '' || input === '****') return storedPassword || '';
  if (typeof input !== 'string' || input.length > 4096 || /[\r\n\0]/u.test(input)) {
    throw new SmtpSettingsError('Das SMTP-Passwort ist ungültig.');
  }
  return input;
}

export function validateSmtpSettings(input, { hasStoredPassword = false, forConnection = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SmtpSettingsError('SMTP-Einstellungen fehlen.');
  }
  if (input.smtp_port != null && typeof input.smtp_port !== 'number' && typeof input.smtp_port !== 'string') {
    throw new SmtpSettingsError('Der SMTP-Port muss zwischen 1 und 65535 liegen.');
  }
  const port = input.smtp_port == null || input.smtp_port === '' ? 587 : Number(input.smtp_port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SmtpSettingsError('Der SMTP-Port muss zwischen 1 und 65535 liegen.');
  }
  if (typeof input.smtp_secure !== 'boolean' || (input.is_enabled != null && typeof input.is_enabled !== 'boolean')) {
    throw new SmtpSettingsError('Verschlüsselung und Aktivierung müssen als Schalter gesetzt werden.');
  }
  const settings = {
    smtp_host: text(input.smtp_host, 'SMTP-Server'),
    smtp_port: port,
    smtp_secure: input.smtp_secure,
    smtp_user: text(input.smtp_user, 'SMTP-Benutzer'),
    smtp_pass: smtpPassword(input.smtp_pass),
    email_from: text(input.email_from, 'Absenderadresse'),
    email_from_name: text(input.email_from_name, 'Absendername'),
    is_enabled: input.is_enabled === true,
    test_email: text(input.test_email, 'Testmail-Adresse'),
  };
  if (settings.smtp_host && /[\s/@?#]/u.test(settings.smtp_host)) {
    throw new SmtpSettingsError('Bitte nur den SMTP-Servernamen eingeben, ohne https:// oder Pfad.');
  }
  if (settings.email_from && !isSingleEmailAddress(settings.email_from)) {
    throw new SmtpSettingsError('Die Absenderadresse ist ungültig.');
  }
  if (settings.test_email && !isSingleEmailAddress(settings.test_email)) {
    throw new SmtpSettingsError('Die Testmail-Adresse ist ungültig.');
  }
  if (settings.is_enabled || forConnection) {
    if (!settings.smtp_host || !settings.smtp_user) {
      throw new SmtpSettingsError('SMTP-Server und Benutzer sind erforderlich.');
    }
    if (!forConnection && !settings.email_from) {
      throw new SmtpSettingsError('Eine gültige Absenderadresse ist erforderlich.');
    }
    if (!settings.smtp_pass && !hasStoredPassword) {
      throw new SmtpSettingsError('Bitte das SMTP-Passwort eingeben.');
    }
    if ((port === 465 && !settings.smtp_secure) || (port === 587 && settings.smtp_secure)) {
      throw new SmtpSettingsError('Port 465 verwendet SSL/TLS, Port 587 verwendet STARTTLS.');
    }
  }
  return settings;
}

export function smtpTransportOptions(settings, password) {
  return {
    host: settings.smtp_host,
    port: settings.smtp_port,
    secure: settings.smtp_secure,
    requireTLS: !settings.smtp_secure,
    auth: { user: settings.smtp_user, pass: password },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    pool: false,
  };
}

export function publicSmtpSettings(settings = {}) {
  return {
    smtp_host: settings.smtp_host || '',
    smtp_port: settings.smtp_port || 587,
    smtp_secure: settings.smtp_secure === true,
    smtp_user: settings.smtp_user || '',
    smtp_pass: '',
    smtp_pass_set: Boolean(settings.smtp_pass_encrypted),
    email_from: settings.email_from || '',
    email_from_name: settings.email_from_name || '',
    is_enabled: settings.is_enabled === true,
    test_email: settings.test_email || '',
  };
}

const hostHint = host => {
  const value = String(host || '').toLowerCase();
  if (/gmx\.|web\.de/.test(value)) return ' Bei GMX und WEB.DE muss in den Einstellungen unter POP3/IMAP der Zugriff für externe Programme erlaubt sein.';
  if (/gmail|google/.test(value)) return ' Google verlangt ein App-Passwort, nicht das normale Passwort.';
  if (/icloud|me\.com/.test(value)) return ' Apple verlangt ein app-spezifisches Passwort, nicht das Apple-ID-Passwort.';
  if (/outlook|office365|hotmail/.test(value)) return ' Bei aktivierter Zwei-Faktor-Anmeldung wird ein App-Passwort von Microsoft benötigt.';
  if (/yahoo/.test(value)) return ' Yahoo verlangt ein App-Passwort, nicht das normale Passwort.';
  return ' Manche Anbieter benötigen ein App-Passwort.';
};

// settings (optional): Server, Port und Verschlüsselung der geprüften Einrichtung für konkretere Hinweise.
export function smtpErrorMessage(error, settings = {}) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  const host = typeof settings?.smtp_host === 'string' ? settings.smtp_host.trim() : '';
  const port = Number(settings?.smtp_port);
  if (code === 'EAUTH' || /invalid login|authentication|credentials|535/.test(message)) {
    return `Die Anmeldung wurde abgelehnt. Bitte Benutzername und Passwort prüfen.${hostHint(host)}`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || message.includes('getaddrinfo')) {
    return host
      ? `Der SMTP-Server „${host}“ wurde nicht gefunden. Bitte die Schreibweise prüfen, etwa auf Tippfehler.`
      : 'Der SMTP-Server wurde nicht gefunden. Bitte den Servernamen prüfen.';
  }
  if (code === 'ETIMEDOUT' || /timeout|timed out|greeting never received/.test(message)) {
    if (port === 465 || port === 25) {
      return `Der SMTP-Server antwortet auf Port ${port} nicht. Dieser Port wird in vielen Netzwerken blockiert. Bitte STARTTLS mit Port 587 versuchen.`;
    }
    if (port === 587 && settings?.smtp_secure === true) {
      return 'Der SMTP-Server antwortet nicht. Port 587 verwendet STARTTLS: bitte die Verschlüsselung auf STARTTLS stellen.';
    }
    return `Der SMTP-Server${host ? ` „${host}“` : ''} antwortet nicht rechtzeitig. Bitte Servername und Port prüfen; üblich ist Port 587 mit STARTTLS.`;
  }
  if (code === 'ECONNREFUSED' || message.includes('econnrefused')) {
    return 'Der SMTP-Server verweigert die Verbindung. Bitte Server und Port prüfen; üblich ist Port 587 mit STARTTLS.';
  }
  if (/certificate|self.signed|cert_|unable to verify/.test(message) || /CERT|TLS/.test(code)) {
    return 'Die verschlüsselte Verbindung konnte nicht geprüft werden. Bitte Servername und Zertifikat beim Mailanbieter prüfen.';
  }
  if (/starttls|wrong version number|ssl routines/.test(message)) {
    return 'Die Verschlüsselung passt nicht zum Server. Port 587 verwendet STARTTLS, Port 465 SSL/TLS.';
  }
  if (code === 'EENVELOPE') return 'Der Mailserver hat die Absender- oder Empfängeradresse abgelehnt. Bitte die Adressen prüfen.';
  return 'Die Mailverbindung ist fehlgeschlagen. Bitte Zugangsdaten und Erreichbarkeit beim Mailanbieter prüfen.';
}
