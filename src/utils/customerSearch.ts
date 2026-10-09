export interface CustomerSearchMatch {
  id: string;
  name: string;
  customerNumber?: string;
  email?: string;
}

export interface CustomerSearchDestination {
  id: string;
  title: string;
  subtitle: string;
  page: 'customer';
  filter: string;
}

/** Sucht Kundendaten und öffnet Treffer direkt in der passenden Detailansicht. */
export function searchCustomers<T extends CustomerSearchMatch>(customers: T[], query: string, entityLabel: string): CustomerSearchDestination[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('de-DE');
  if (!normalizedQuery) return [];

  return customers
    .filter(customer => [customer.name, customer.customerNumber, customer.email]
      .some(value => value?.toLocaleLowerCase('de-DE').includes(normalizedQuery)))
    .map(customer => ({
      id: customer.id,
      title: customer.name,
      subtitle: `${entityLabel} ${customer.customerNumber || ''}`.trim(),
      page: 'customer',
      filter: customer.id,
    }));
}
