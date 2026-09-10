export interface BulkEmailCustomer {
  email?: string | null;
  additionalEmails?: readonly {
    email?: string | null;
    isActive: boolean;
  }[] | null;
}

/** Liefert die primäre und alle aktiven Zusatzadressen eines Kunden genau einmal. */
export function getActiveEmailRecipients(
  customer: BulkEmailCustomer | null | undefined,
): string[] {
  if (!customer) return [];

  const addresses = [
    customer.email,
    ...(customer.additionalEmails || [])
      .filter(email => email.isActive)
      .map(email => email.email),
  ];

  return Array.from(new Set(
    addresses
      .map(email => email?.trim())
      .filter((email): email is string => Boolean(email)),
  ));
}
