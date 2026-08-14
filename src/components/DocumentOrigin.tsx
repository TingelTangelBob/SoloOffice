import { ArrowUpRight } from 'lucide-react';
import type { Invoice } from '../types';

interface DocumentOriginProps {
  invoice: Invoice;
  onNavigate?: (page: string, filter?: string, searchTerm?: string) => void;
}

/**
 * Zeigt, woraus eine Rechnung entstanden ist.
 *
 * Die Verknüpfungen liegen bereits an der Rechnung (`sourceQuoteNumber`,
 * `sourceJobs`, `referenceInvoiceNumber`), waren aber nirgends sichtbar. Ohne
 * sie lässt sich im Nachhinein nicht nachvollziehen, welches Angebot oder
 * welche Auftragseinheiten abgerechnet wurden.
 */
export function DocumentOrigin({ invoice, onNavigate }: DocumentOriginProps) {
  const jobCount = invoice.sourceJobs?.length || 0;
  const links: Array<{ key: string; label: string; page: string; searchTerm?: string }> = [];

  if (invoice.sourceQuoteNumber) {
    links.push({
      key: 'quote',
      label: `aus ${invoice.sourceQuoteNumber}`,
      page: 'quotes',
      searchTerm: invoice.sourceQuoteNumber,
    });
  }

  if (jobCount > 0) {
    const firstJob = invoice.sourceJobs?.[0];
    links.push({
      key: 'jobs',
      label: jobCount === 1 && firstJob?.jobNumber ? `aus ${firstJob.jobNumber}` : `aus ${jobCount} Einheiten`,
      page: 'jobs',
      searchTerm: jobCount === 1 ? firstJob?.jobNumber : undefined,
    });
  }

  if (invoice.referenceInvoiceNumber) {
    links.push({
      key: 'reference',
      label: `zu ${invoice.referenceInvoiceNumber}`,
      page: 'invoices',
      searchTerm: invoice.referenceInvoiceNumber,
    });
  }

  if (links.length === 0) return null;

  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {links.map(link => (
        <button
          key={link.key}
          type="button"
          onClick={event => {
            event.stopPropagation();
            onNavigate?.(link.page, undefined, link.searchTerm);
          }}
          disabled={!onNavigate}
          className="inline-flex min-h-0 items-center gap-0.5 rounded-sm text-xs font-normal text-gray-500 transition-colors hover:text-primary-custom disabled:cursor-default disabled:hover:text-gray-500"
          title={onNavigate ? 'Herkunftsdokument öffnen' : undefined}
        >
          {link.label}
          {onNavigate && <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden="true" />}
        </button>
      ))}
    </span>
  );
}
