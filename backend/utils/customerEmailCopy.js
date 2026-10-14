import { normaliseEmail } from './auth.js';

function recipientAddresses(recipients) {
  return (Array.isArray(recipients) ? recipients : [recipients])
    .flatMap(recipient => typeof recipient === 'string' ? recipient.split(',') : [])
    .map(address => {
      const mailbox = address.match(/<([^<>]+)>\s*$/);
      return normaliseEmail(mailbox ? mailbox[1] : address);
    })
    .filter(Boolean);
}

/**
 * Customer documents always receive one private copy at the configured sender.
 * Keep that address out of BCC when it already receives the original message.
 */
export function customerEmailCopy(senderEmail, recipients) {
  const sender = typeof senderEmail === 'string' ? senderEmail.trim() : '';
  if (!/^[^\s@,;<>\x00-\x1f]+@[^\s@,;<>\x00-\x1f]+\.[^\s@,;<>\x00-\x1f]+$/.test(sender)) {
    throw new Error('Bitte konfigurieren Sie eine gültige Absender-E-Mail-Adresse für die Versandkopie.');
  }

  return recipientAddresses(recipients).includes(normaliseEmail(sender))
    ? undefined
    : sender;
}

/**
 * SMTP may accept the customer while rejecting the private copy, or the other
 * way round. Only customer acceptance makes a customer send successful. Report
 * a rejected copy as a warning to avoid repeating an already delivered email.
 */
export function customerEmailDeliveryResult(result, senderEmail, recipients) {
  const customerAddresses = [...new Set(recipientAddresses(recipients))];
  const accepted = Array.isArray(result.accepted) ? recipientAddresses(result.accepted) : null;
  const rejected = recipientAddresses(result.rejected || []);
  if (accepted && !customerAddresses.some(address => accepted.includes(address))) {
    throw new Error('Der SMTP-Server hat keinen Kundenempfänger angenommen.');
  }

  const copyRecipient = senderEmail.trim();
  const sender = normaliseEmail(copyRecipient);
  const copyAccepted = accepted ? accepted.includes(sender) : !rejected.includes(sender);
  const rejectedCustomers = customerAddresses.filter(address => accepted
    ? !accepted.includes(address)
    : rejected.includes(address));
  const warnings = [];
  if (rejectedCustomers.length) {
    warnings.push(`Der SMTP-Server hat folgende Kundenempfänger abgelehnt: ${rejectedCustomers.join(', ')}.`);
  }
  if (!copyAccepted) {
    warnings.push(`Die E-Mail wurde versendet, aber die Kopie an ${copyRecipient} wurde vom SMTP-Server abgelehnt.`);
  }

  return { copyRecipient, copyAccepted, ...(warnings.length ? { warning: warnings.join(' ') } : {}) };
}
