import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { apiService } from '../services/api';
import { useCompany } from '../context/CompanyContext';
import { formatCurrency, formatDate, formatTime } from '../utils/formatters';
import type { Invoice, InvoiceHistoryEntry } from '../types';
import { DialogShell } from './DialogShell';
import logger from '../utils/logger';

interface InvoiceHistoryDialogProps {
  invoice: Invoice | null;
  onClose: () => void;
}

/** Felder, deren Änderung fachlich zählt. Technisches wie `updated_at` bleibt außen vor. */
type HistoryField = { keys: string[]; label: string; kind: 'amount' | 'date' | 'number' | 'percent' | 'text' };

const INVOICE_FIELDS: HistoryField[] = [
  { keys: ['status'], label: 'Status', kind: 'text' },
  { keys: ['total'], label: 'Bruttobetrag', kind: 'amount' },
  { keys: ['subtotal'], label: 'Nettobetrag', kind: 'amount' },
  { keys: ['tax_amount', 'taxAmount'], label: 'Steuerbetrag', kind: 'amount' },
  { keys: ['customer_name', 'customerName'], label: 'Empfänger', kind: 'text' },
  { keys: ['issue_date', 'issueDate'], label: 'Rechnungsdatum', kind: 'date' },
  { keys: ['due_date', 'dueDate'], label: 'Fällig am', kind: 'date' },
  { keys: ['notes'], label: 'Hinweistext', kind: 'text' },
];

const ITEM_FIELDS: HistoryField[] = [
  { keys: ['description'], label: 'Position', kind: 'text' },
  { keys: ['quantity'], label: 'Menge', kind: 'number' },
  { keys: ['unit_price', 'unitPrice'], label: 'Einzelpreis', kind: 'amount' },
  { keys: ['tax_rate', 'taxRate'], label: 'MwSt.', kind: 'percent' },
  { keys: ['discount_amount', 'discountAmount'], label: 'Rabatt', kind: 'amount' },
  { keys: ['total'], label: 'Positionswert', kind: 'amount' },
];

const STATUS_LABELS: Record<string, string> = {
  draft: 'Entwurf',
  sent: 'Versendet',
  paid: 'Bezahlt',
  overdue: 'Überfällig',
  reminded_1x: '1. Mahnung',
  reminded_2x: '2. Mahnung',
  reminded_3x: '3. Mahnung',
};

const ACTION_LABELS: Record<InvoiceHistoryEntry['action'], string> = {
  created: 'Angelegt',
  updated: 'Geändert',
  deleted: 'Gelöscht',
};

export function InvoiceHistoryDialog({ invoice, onClose }: InvoiceHistoryDialogProps) {
  const { company } = useCompany();
  const locale = company?.locale || 'de-DE';
  const [entries, setEntries] = useState<InvoiceHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!invoice) return;
    let cancelled = false;

    setLoading(true);
    setError('');
    apiService.getInvoiceHistory(invoice.id)
      .then(result => { if (!cancelled) setEntries(result); })
      .catch(loadError => {
        logger.error('Error loading invoice history:', loadError);
        if (!cancelled) setError('Der Änderungsverlauf konnte nicht geladen werden.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [invoice]);

  if (!invoice) return null;

  const readField = (data: Record<string, unknown> | null | undefined, keys: string[]) => {
    if (!data) return undefined;
    const key = keys.find(candidate => data[candidate] !== undefined);
    return key ? data[key] : undefined;
  };

  const formatValue = (value: unknown, kind: HistoryField['kind']) => {
    if (value === null || value === undefined || value === '') return '–';
    if (kind === 'amount') return formatCurrency(Number(value), locale, company?.numberFormat, company?.currency);
    if (kind === 'number') return Number(value).toLocaleString(locale, { maximumFractionDigits: 4 });
    if (kind === 'percent') return `${Number(value).toLocaleString(locale, { maximumFractionDigits: 2 })} %`;
    if (kind === 'date') return formatDate(new Date(String(value)), locale, company?.dateFormat);
    const text = String(value);
    return STATUS_LABELS[text] || text;
  };

  const describeChanges = (entry: InvoiceHistoryEntry) => {
    if (entry.action === 'created') return [];
    const fields = entry.recordType === 'item' ? ITEM_FIELDS : INVOICE_FIELDS;
    return fields.flatMap(field => {
      const before = readField(entry.oldData, field.keys);
      const after = readField(entry.newData, field.keys);
      if (before === undefined && after === undefined) return [];
      if (String(before ?? '') === String(after ?? '')) return [];
      return [{
        label: field.label,
        before: formatValue(before, field.kind),
        after: formatValue(after, field.kind),
      }];
    });
  };

  return (
    <DialogShell
      titleId="invoice-history-title"
      icon={History}
      title="Änderungsverlauf"
      description={`Alle erfassten Änderungen an ${invoice.invoiceNumber}. Die Einträge werden fortgeschrieben und lassen sich nicht nachträglich ändern.`}
      onClose={onClose}
      size="lg"
      footer={(
        <button
          type="button"
          onClick={onClose}
          className="min-h-12 rounded-lg border border-gray-300 bg-white px-6 py-2 text-base font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Schließen
        </button>
      )}
    >
      <div className="space-y-3 pb-2">
        {loading && <p className="py-8 text-center text-sm text-gray-500">Änderungsverlauf wird geladen …</p>}
        {error && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

        {!loading && !error && entries.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-500">
            Für diese Rechnung sind noch keine Änderungen protokolliert.
          </p>
        )}

        {entries.map(entry => {
          const changes = describeChanges(entry);
          const changedAt = new Date(entry.changedAt);

          return (
            <article key={entry.id} className="rounded-lg border border-gray-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-gray-900">
                  {ACTION_LABELS[entry.action]}
                  {entry.recordType === 'item' && ' · Position'}
                </span>
                <span className="text-xs text-gray-500">
                  {formatDate(changedAt, locale, company?.dateFormat)} {formatTime(changedAt, locale, company?.timeFormat)}
                </span>
              </div>

              {changes.length > 0 && (
                <dl className="mt-3 space-y-1.5 text-sm">
                  {changes.map(change => (
                    <div key={change.label} className="flex flex-wrap items-baseline gap-x-2">
                      <dt className="text-gray-500">{change.label}:</dt>
                      <dd className="text-gray-900">
                        <span className="text-gray-500 line-through">{change.before}</span>
                        <span className="mx-1.5 text-gray-400">→</span>
                        <span className="font-medium">{change.after}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {entry.action === 'updated' && changes.length === 0 && (
                <p className="mt-2 text-sm text-gray-500">Keine der nachweisrelevanten Angaben hat sich geändert.</p>
              )}

              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-gray-500">Technische Werte anzeigen</summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-600">
                  {JSON.stringify({ vorher: entry.oldData, nachher: entry.newData }, null, 2)}
                </pre>
              </details>
            </article>
          );
        })}
      </div>
    </DialogShell>
  );
}
