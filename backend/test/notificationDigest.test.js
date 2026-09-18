import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, digestDecision, localClock, settingsView, validateSettingsInput } from '../services/notificationDigest.js';
import { renderSystemEmail, systemMails } from '../services/emailTemplates.js';

test('validateSettingsInput: Standardwerte, Grenzen und Typen', () => {
  const defaults = validateSettingsInput({});
  assert.equal(defaults.ok, true);
  assert.deepEqual(defaults.value, { ...DEFAULT_SETTINGS });

  const custom = validateSettingsInput({ jobsCompleted: true, invoiceDrafts: 'ja', invoiceDraftDays: 7, invoicesOverdue: true, digestHour: 18 });
  assert.equal(custom.ok, true);
  assert.deepEqual(custom.value, { jobsCompleted: true, invoiceDrafts: false, invoiceDraftDays: 7, invoicesOverdue: true, digestHour: 18 });

  assert.equal(validateSettingsInput({ invoiceDraftDays: 0 }).ok, false);
  assert.equal(validateSettingsInput({ invoiceDraftDays: 61 }).ok, false);
  assert.equal(validateSettingsInput({ digestHour: 24 }).ok, false);
  assert.equal(validateSettingsInput({ digestHour: 7.5 }).ok, false);
  assert.match(validateSettingsInput({ digestHour: -1, invoiceDraftDays: 'x' }).error, /Wartezeit.*Uhrzeit/s);
});

test('settingsView liefert Standardwerte ohne Zeile und camelCase mit Zeile', () => {
  assert.deepEqual(settingsView(null), { ...DEFAULT_SETTINGS, lastDigestAt: null, lastDigestError: null });
  const view = settingsView({ jobs_completed: true, invoice_drafts: true, invoice_draft_days: 5, invoices_overdue: false, digest_hour: 9, last_digest_at: '2026-09-18T06:00:00Z', last_digest_error: null });
  assert.equal(view.jobsCompleted, true);
  assert.equal(view.invoiceDraftDays, 5);
  assert.equal(view.digestHour, 9);
  assert.equal(view.lastDigestAt, '2026-09-18T06:00:00Z');
});

test('localClock rechnet in die Zeitzone des Unternehmens um und fällt bei Unbekanntem auf Europe/Berlin zurück', () => {
  // 2026-09-18T06:30Z = 08:30 in Berlin (Sommerzeit), 02:30 in New York, 15:30 in Tokio
  const now = new Date('2026-09-18T06:30:00Z');
  assert.deepEqual(localClock(now, 'Europe/Berlin'), { day: '2026-09-18', hour: 8, timeZone: 'Europe/Berlin' });
  assert.deepEqual(localClock(now, 'America/New_York'), { day: '2026-09-18', hour: 2, timeZone: 'America/New_York' });
  assert.deepEqual(localClock(now, 'Asia/Tokyo'), { day: '2026-09-18', hour: 15, timeZone: 'Asia/Tokyo' });
  assert.equal(localClock(now, 'Mars/Olympus').timeZone, 'Europe/Berlin');
  // Tageswechsel: 23:30Z ist in Berlin schon der nächste Tag
  assert.equal(localClock(new Date('2026-09-18T23:30:00Z'), 'Europe/Berlin').day, '2026-09-19');
});

test('digestDecision: sendet einmal je Tag ab der eingestellten Stunde', () => {
  const base = { jobs_completed: true, invoice_drafts: false, invoices_overdue: false, digest_hour: 8, last_digest_day: null };
  assert.equal(digestDecision({ ...base, jobs_completed: false }, { day: '2026-09-18', hour: 9 }), 'disabled');
  assert.equal(digestDecision(base, { day: '2026-09-18', hour: 7 }), 'too_early');
  assert.equal(digestDecision(base, { day: '2026-09-18', hour: 8 }), 'send');
  assert.equal(digestDecision(base, { day: '2026-09-18', hour: 22 }), 'send');
  assert.equal(digestDecision({ ...base, last_digest_day: '2026-09-18' }, { day: '2026-09-18', hour: 9 }), 'already_sent');
  assert.equal(digestDecision({ ...base, last_digest_day: new Date('2026-09-17T00:00:00Z') }, { day: '2026-09-18', hour: 9 }), 'send');
});

test('renderSystemEmail escaped Inhalte und liefert Text- und HTML-Fassung ohne Bilder', () => {
  const mail = renderSystemEmail({
    title: 'Titel <script>',
    paragraphs: ['A & B'],
    cta: { label: 'Öffnen', url: 'https://app.test/?x=1&y=2' },
    sections: [{ title: 'Liste', count: 2, items: [{ title: 'Eins', subtitle: 'Sub', meta: '10 €', url: 'https://app.test/#a' }, { title: 'Zwei' }] }],
    reason: 'Grund.',
    recipient: 'a@b.test',
  });
  assert.match(mail.html, /Titel &lt;script&gt;/);
  assert.match(mail.html, /A &amp; B/);
  assert.doesNotMatch(mail.html, /<img/);
  assert.match(mail.html, /href="https:\/\/app\.test\/\?x=1&amp;y=2"/);
  assert.match(mail.text, /LISTE \(2\)/);
  assert.match(mail.text, /- Eins · 10 €/);
  assert.match(mail.text, /Öffnen: https:\/\/app\.test\/\?x=1&y=2/);
});

test('Alle Systemmails liefern Betreff, HTML und Text', () => {
  const cases = [
    systemMails.verification({ email: 'a@b.test', link: 'https://app.test/?verifyEmail=x', name: 'Anna' }),
    systemMails.passwordReset({ email: 'a@b.test', link: 'https://app.test/?resetPassword=x' }),
    systemMails.workspaceInvitation({ email: 'a@b.test', link: 'https://app.test/?invite=x', workspaceName: 'Muster GmbH', invitedBy: 'Max', role: 'admin' }),
    systemMails.workspaceReady({ email: 'a@b.test', link: 'https://app.test/?invite=x', workspaceName: 'Muster GmbH' }),
    systemMails.digest({ email: 'a@b.test', name: 'Anna', workspaceName: 'Muster GmbH', appUrl: 'https://app.test', settingsUrl: 'https://app.test/#profile', dateLabel: '18.09.2026', sections: [{ title: 'Offen', count: 1, items: [{ title: 'RE-1' }] }] }),
    systemMails.test({ email: 'a@b.test', workspaceName: 'Muster GmbH' }),
  ];
  for (const mail of cases) {
    assert.ok(mail.subject.length > 5);
    assert.match(mail.html, /<!doctype html>/i);
    assert.ok(mail.text.length > 40);
  }
  assert.match(cases[2].html, /Administrator/);
  assert.match(cases[4].subject, /1 offener Punkt/);
  assert.match(cases[4].html, /Guten Tag Anna,/);
});
