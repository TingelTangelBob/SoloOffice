/**
 * Gestaltete Systemmails der Fachanwendung.
 *
 * Eine Vorlage für Bestätigung, Passwort, Einladungen und die tägliche
 * Wiedervorlage: Kopf mit Marke, weiße Inhaltskarte, ein Handlungsknopf,
 * Fußzeile mit dem Grund der Zustellung. Bewusst ohne externe Bilder und
 * Webfonts (Postfächer blocken beides), Tabellenlayout mit Inline-Styles,
 * weil Mailclients keine Stylesheets teilen. Jede Mail hat eine Textfassung.
 *
 * Kunden-Mails (Rechnung, Angebot, Mahnung) behalten ihr eigenes Layout in
 * emailService.js – dort tritt das Unternehmen des Nutzers als Absender auf,
 * hier die Anwendung.
 */

export const SYSTEM_EMAIL_BRAND = {
  name: 'SoloOffice',
  primary: '#2563eb',
  text: '#18212b',
  muted: '#64748b',
  border: '#e5e7eb',
  background: '#f3f4f6',
  card: '#ffffff',
  websiteUrl: 'https://solooffice.de',
  imprintUrl: process.env.VITE_IMPRESSUM_URL || 'https://solooffice.de/impressum',
  privacyUrl: process.env.VITE_DATENSCHUTZ_URL || 'https://solooffice.de/datenschutz',
};

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphHtml(text, brand) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${brand.text};">${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
}

function buttonHtml(cta, brand) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr>
    <td align="center" bgcolor="${brand.primary}" style="border-radius:8px;">
      <a href="${escapeHtml(cta.url)}" target="_blank" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;background:${brand.primary};">${escapeHtml(cta.label)}</a>
    </td>
  </tr>
</table>
<p style="margin:0 0 20px;font-size:12px;line-height:1.5;color:${brand.muted};">Falls der Knopf nicht funktioniert, diese Adresse in den Browser kopieren:<br><a href="${escapeHtml(cta.url)}" style="color:${brand.primary};word-break:break-all;">${escapeHtml(cta.url)}</a></p>`;
}

function detailsHtml(details, brand) {
  const rows = details.map(row => `<tr>
      <td style="padding:8px 12px;font-size:13px;color:${brand.muted};border-bottom:1px solid ${brand.border};white-space:nowrap;vertical-align:top;">${escapeHtml(row.label)}</td>
      <td style="padding:8px 12px;font-size:13px;color:${brand.text};border-bottom:1px solid ${brand.border};vertical-align:top;">${escapeHtml(row.value).replace(/\n/g, '<br>')}</td>
    </tr>`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;border:1px solid ${brand.border};border-radius:8px;border-collapse:separate;overflow:hidden;">${rows}</table>`;
}

/**
 * Liste mit Überschrift und Zeilen (für die Wiedervorlage): jede Zeile hat
 * Titel, Nebentext und optional einen Link.
 */
function sectionsHtml(sections, brand) {
  return sections.map(section => `<h2 style="margin:20px 0 8px;font-size:15px;font-weight:700;color:${brand.text};">${escapeHtml(section.title)}${section.count != null ? ` <span style="font-weight:500;color:${brand.muted};">(${section.count})</span>` : ''}</h2>
${section.intro ? `<p style="margin:0 0 10px;font-size:13px;line-height:1.5;color:${brand.muted};">${escapeHtml(section.intro)}</p>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 8px;border:1px solid ${brand.border};border-radius:8px;border-collapse:separate;overflow:hidden;">
${section.items.map(item => `  <tr>
    <td style="padding:10px 12px;border-bottom:1px solid ${brand.border};vertical-align:top;">
      <div style="font-size:14px;font-weight:600;color:${brand.text};">${item.url ? `<a href="${escapeHtml(item.url)}" style="color:${brand.primary};text-decoration:none;">${escapeHtml(item.title)}</a>` : escapeHtml(item.title)}</div>
      ${item.subtitle ? `<div style="font-size:12px;line-height:1.5;color:${brand.muted};">${escapeHtml(item.subtitle)}</div>` : ''}
    </td>
    ${item.meta ? `<td style="padding:10px 12px;border-bottom:1px solid ${brand.border};text-align:right;white-space:nowrap;font-size:13px;color:${brand.text};vertical-align:top;">${escapeHtml(item.meta)}</td>` : ''}
  </tr>`).join('\n')}
</table>
${section.more ? `<p style="margin:0 0 8px;font-size:12px;color:${brand.muted};">${escapeHtml(section.more)}</p>` : ''}`).join('\n');
}

function sectionsText(sections) {
  return sections.flatMap(section => [
    `${section.title.toUpperCase()}${section.count != null ? ` (${section.count})` : ''}`,
    ...(section.intro ? [section.intro] : []),
    ...section.items.map(item => `- ${item.title}${item.meta ? ` · ${item.meta}` : ''}${item.subtitle ? `\n  ${item.subtitle}` : ''}${item.url ? `\n  ${item.url}` : ''}`),
    ...(section.more ? [section.more] : []),
    '',
  ]);
}

/**
 * @param {object} input
 * @param {string} input.title
 * @param {string} [input.preheader]
 * @param {string} [input.greeting]
 * @param {string[]} [input.paragraphs]
 * @param {{label: string, url: string}} [input.cta]
 * @param {{label: string, value: string}[]} [input.details]
 * @param {{title: string, count?: number, intro?: string, items: {title: string, subtitle?: string, meta?: string, url?: string}[], more?: string}[]} [input.sections]
 * @param {string[]} [input.outro]
 * @param {string} [input.reason]
 * @param {string} [input.recipient]
 * @param {object} [input.brand]
 * @returns {{html: string, text: string}}
 */
export function renderSystemEmail(input) {
  const brand = { ...SYSTEM_EMAIL_BRAND, ...(input.brand || {}) };
  const paragraphs = Array.isArray(input.paragraphs) ? input.paragraphs.filter(Boolean) : [];
  const outro = Array.isArray(input.outro) ? input.outro.filter(Boolean) : [];
  const details = Array.isArray(input.details) ? input.details.filter(row => row && row.label && row.value != null && row.value !== '') : [];
  const sections = Array.isArray(input.sections) ? input.sections.filter(section => section && section.items && section.items.length) : [];
  const year = new Date().getFullYear();

  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:${brand.background};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
${input.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader)}</div>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${brand.background};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;">
        <tr>
          <td style="padding:0 4px 16px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="width:28px;height:28px;background:${brand.primary};border-radius:7px;text-align:center;vertical-align:middle;color:#ffffff;font-weight:700;font-size:15px;line-height:28px;">S</td>
                <td style="padding-left:10px;font-size:17px;font-weight:700;color:${brand.text};letter-spacing:0.2px;">${escapeHtml(brand.name)}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:${brand.card};border:1px solid ${brand.border};border-radius:12px;padding:32px 32px 20px;">
            <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;font-weight:700;color:${brand.text};">${escapeHtml(input.title)}</h1>
            ${input.greeting ? paragraphHtml(input.greeting, brand) : ''}
            ${paragraphs.map(text => paragraphHtml(text, brand)).join('\n')}
            ${details.length ? detailsHtml(details, brand) : ''}
            ${sections.length ? sectionsHtml(sections, brand) : ''}
            ${input.cta?.url ? buttonHtml(input.cta, brand) : ''}
            ${outro.map(text => paragraphHtml(text, brand)).join('\n')}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 8px 0;font-size:12px;line-height:1.6;color:${brand.muted};">
            ${input.reason ? `<p style="margin:0 0 8px;">${escapeHtml(input.reason)}${input.recipient ? ` Diese Nachricht ging an ${escapeHtml(input.recipient)}.` : ''}</p>` : ''}
            <p style="margin:0;">© ${year} ${escapeHtml(brand.name)} · <a href="${escapeHtml(brand.websiteUrl)}" style="color:${brand.muted};">${escapeHtml(brand.websiteUrl.replace(/^https?:\/\//, ''))}</a> · <a href="${escapeHtml(brand.imprintUrl)}" style="color:${brand.muted};">Impressum</a> · <a href="${escapeHtml(brand.privacyUrl)}" style="color:${brand.muted};">Datenschutz</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    brand.name.toUpperCase(),
    '',
    input.title,
    '',
    ...(input.greeting ? [input.greeting, ''] : []),
    ...paragraphs.flatMap(line => [line, '']),
    ...(details.length ? [...details.map(row => `${row.label}: ${row.value}`), ''] : []),
    ...sectionsText(sections),
    ...(input.cta?.url ? [`${input.cta.label}: ${input.cta.url}`, ''] : []),
    ...outro.flatMap(line => [line, '']),
    '--',
    ...(input.reason ? [`${input.reason}${input.recipient ? ` Diese Nachricht ging an ${input.recipient}.` : ''}`] : []),
    `${brand.name} · ${brand.websiteUrl} · Impressum: ${brand.imprintUrl} · Datenschutz: ${brand.privacyUrl}`,
  ].join('\n');

  return { html, text };
}

function greetingFor(name) {
  return name ? `Guten Tag ${name},` : 'Guten Tag,';
}

/** Die Systemmails der Fachanwendung. Jede liefert {subject, html, text}. */
export const systemMails = {
  verification({ email, link, name }) {
    const body = renderSystemEmail({
      title: 'E-Mail-Adresse bestätigen',
      preheader: 'Ein Klick, dann ist Ihr SoloOffice-Zugang aktiv.',
      greeting: greetingFor(name),
      paragraphs: ['vielen Dank für Ihre Registrierung bei SoloOffice. Bitte bestätigen Sie Ihre E-Mail-Adresse, damit wir Sie bei Einladungen, Passwort-Zurücksetzungen und Hinweisen erreichen können.'],
      cta: { label: 'E-Mail-Adresse bestätigen', url: link },
      outro: ['Falls Sie kein Konto angelegt haben, ignorieren Sie diese Nachricht einfach – ohne Bestätigung passiert nichts.'],
      reason: 'Sie erhalten diese E-Mail, weil mit dieser Adresse ein SoloOffice-Zugang angelegt wurde.',
      recipient: email,
    });
    return { subject: 'SoloOffice: Bitte E-Mail-Adresse bestätigen', ...body };
  },

  passwordReset({ email, link, name, ttlHours = 1 }) {
    const body = renderSystemEmail({
      title: 'Passwort zurücksetzen',
      preheader: 'Mit diesem Link legen Sie ein neues Passwort fest.',
      greeting: greetingFor(name),
      paragraphs: ['für Ihren SoloOffice-Zugang wurde ein neues Passwort angefordert. Über den folgenden Knopf legen Sie es fest:'],
      cta: { label: 'Neues Passwort festlegen', url: link },
      outro: [
        `Der Link ist ${ttlHours === 1 ? 'eine Stunde' : `${ttlHours} Stunden`} gültig und kann nur einmal verwendet werden.`,
        'Sie haben das nicht angefordert? Dann bleibt Ihr bisheriges Passwort bestehen; Sie müssen nichts tun.',
      ],
      reason: 'Sie erhalten diese E-Mail, weil für Ihren SoloOffice-Zugang ein Passwort-Reset angefordert wurde.',
      recipient: email,
    });
    return { subject: 'SoloOffice: Passwort zurücksetzen', ...body };
  },

  workspaceInvitation({ email, link, workspaceName, invitedBy, role, expiresInDays = 7 }) {
    const roleLabel = { admin: 'Administrator', member: 'Mitglied', viewer: 'Nur Lesen' }[role] || 'Mitglied';
    const body = renderSystemEmail({
      title: `Einladung zu „${workspaceName}“`,
      preheader: `${invitedBy || 'Ein Teammitglied'} lädt Sie in einen SoloOffice-Arbeitsbereich ein.`,
      greeting: 'Guten Tag,',
      paragraphs: [`${invitedBy ? `${invitedBy} lädt Sie ein` : 'Sie wurden eingeladen'}, im SoloOffice-Arbeitsbereich „${workspaceName}“ mitzuarbeiten.`],
      details: [
        { label: 'Arbeitsbereich', value: workspaceName },
        { label: 'Ihre Rolle', value: roleLabel },
        { label: 'Gültig', value: `${expiresInDays} Tage` },
      ],
      cta: { label: 'Einladung annehmen', url: link },
      outro: ['Beim Annehmen legen Sie ein Passwort fest oder melden sich mit Ihrem bestehenden SoloOffice-Zugang an.', 'Kennen Sie den Absender nicht? Dann ignorieren Sie diese Nachricht; die Einladung verfällt von selbst.'],
      reason: 'Sie erhalten diese E-Mail, weil Sie in einen SoloOffice-Arbeitsbereich eingeladen wurden.',
      recipient: email,
    });
    return { subject: `SoloOffice: Einladung zu „${workspaceName}“`, ...body };
  },

  workspaceReady({ email, link, workspaceName }) {
    const body = renderSystemEmail({
      title: 'Ihr Arbeitsbereich steht bereit',
      preheader: `„${workspaceName}“ ist eingerichtet – jetzt Zugang festlegen.`,
      greeting: 'Guten Tag,',
      paragraphs: [`Ihr SoloOffice-Arbeitsbereich „${workspaceName}“ ist eingerichtet. Über den folgenden Knopf legen Sie Ihr Passwort fest und melden sich zum ersten Mal an.`],
      cta: { label: 'Zugang einrichten', url: link },
      details: [
        { label: '1. Firmendaten', value: 'Name, Anschrift, Steuernummer und Bankverbindung unter Einstellungen hinterlegen.' },
        { label: '2. Kunden', value: 'Erste Kunden anlegen oder per Import übernehmen.' },
        { label: '3. Erste Rechnung', value: 'Vorlage wählen, Positionen erfassen, als PDF oder E-Rechnung versenden.' },
      ],
      outro: ['Der Einrichtungslink ist sieben Tage gültig. Danach können Sie über „Passwort vergessen“ jederzeit einen neuen anfordern.'],
      reason: 'Sie erhalten diese E-Mail, weil für Ihr SoloOffice-Konto ein Arbeitsbereich eingerichtet wurde.',
      recipient: email,
    });
    return { subject: `SoloOffice: Ihr Arbeitsbereich „${workspaceName}“ steht bereit`, ...body };
  },

  /**
   * Tägliche Wiedervorlage aus den Benachrichtigungs-Einstellungen.
   * @param {{email: string, name?: string, workspaceName: string, appUrl: string, sections: object[], settingsUrl: string}} input
   */
  digest({ email, name, workspaceName, appUrl, sections, settingsUrl, dateLabel }) {
    const total = sections.reduce((sum, section) => sum + (section.count ?? section.items.length), 0);
    const body = renderSystemEmail({
      title: `Ihre Wiedervorlage${dateLabel ? ` – ${dateLabel}` : ''}`,
      preheader: `${total} ${total === 1 ? 'Punkt wartet' : 'Punkte warten'} in „${workspaceName}“.`,
      greeting: greetingFor(name),
      paragraphs: [`in Ihrem Arbeitsbereich „${workspaceName}“ ${total === 1 ? 'wartet ein Punkt' : `warten ${total} Punkte`} auf Sie:`],
      sections,
      cta: { label: 'SoloOffice öffnen', url: appUrl },
      outro: [`Welche Hinweise Sie erhalten und wann, stellen Sie unter Benutzerdaten → E-Mail-Benachrichtigungen ein: ${settingsUrl}`],
      reason: 'Sie erhalten diese Zusammenfassung, weil Sie E-Mail-Benachrichtigungen in SoloOffice aktiviert haben.',
      recipient: email,
    });
    return { subject: `SoloOffice: ${total} ${total === 1 ? 'offener Punkt' : 'offene Punkte'} in „${workspaceName}“`, ...body };
  },

  test({ email, name, workspaceName }) {
    const body = renderSystemEmail({
      title: 'Test-E-Mail',
      greeting: greetingFor(name),
      paragraphs: [`diese Nachricht bestätigt, dass der E-Mail-Versand für „${workspaceName}“ funktioniert. Rechnungen, Angebote und Hinweise kommen künftig über diesen Weg.`],
      reason: 'Sie erhalten diese E-Mail, weil Sie in SoloOffice eine Test-E-Mail ausgelöst haben.',
      recipient: email,
    });
    return { subject: 'SoloOffice: Test-E-Mail', ...body };
  },
};
