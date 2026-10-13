import { useEffect, useState } from 'react';
import { ArrowRight, CalendarClock, CreditCard, FileCheck2, Hash, Plus, Trash2 } from 'lucide-react';
import logger from '../../utils/logger';
import { apiService } from '../../services/api';
import type { YearlyInvoiceStartNumber } from '../../types';
import { formatInvoiceNumberPattern, validateInvoiceNumberPattern } from '../../utils/invoiceNumberPattern';
import { SettingsCard, SettingsField, type SettingsSaveMessage } from './SettingsUi';
import { choiceCardClass, DEFAULT_CREDIT_NOTE_NUMBER_PATTERN, DEFAULT_INVOICE_NUMBER_PATTERN, settingsInputClass } from './settingsStyles';
import type { CompanySettingsAreaProps } from './settingsAreaProps';

function YearlyStartNumbers() {
  const [entries, setEntries] = useState<YearlyInvoiceStartNumber[]>([]);
  const [newYear, setNewYear] = useState<number>(new Date().getFullYear());
  const [newStartNumber, setNewStartNumber] = useState<number>(1);
  const [message, setMessage] = useState<SettingsSaveMessage | null>(null);

  const load = async () => {
    try {
      setEntries(await apiService.getYearlyInvoiceStartNumbers());
    } catch (error) {
      logger.error('Error loading yearly start numbers:', { error: error instanceof Error ? error.message : String(error) });
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    try {
      await apiService.createOrUpdateYearlyInvoiceStartNumber(newYear, newStartNumber);
      await load();
      setNewYear(new Date().getFullYear() + 1);
      setNewStartNumber(1);
      setMessage({ type: 'success', text: 'Jahresnummer wurde gespeichert.' });
    } catch (error) {
      logger.error('Error adding yearly start number:', { error: error instanceof Error ? error.message : String(error) });
      setMessage({ type: 'error', text: 'Die Jahresnummer konnte nicht gespeichert werden.' });
    }
  };

  const remove = async (year: number) => {
    try {
      await apiService.deleteYearlyInvoiceStartNumber(year);
      await load();
      setMessage({ type: 'success', text: 'Jahresnummer wurde gelöscht.' });
    } catch (error) {
      logger.error('Error deleting yearly start number:', { error: error instanceof Error ? error.message : String(error) });
      setMessage({ type: 'error', text: 'Die Jahresnummer konnte nicht gelöscht werden.' });
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-gray-500" aria-hidden="true" />
        <p className="text-sm font-medium text-gray-900">Startnummern je Jahr</p>
      </div>
      <p className="mt-1 text-xs text-gray-600">Werden sofort gespeichert. Jahre ohne Eintrag verwenden die Fallback-Startnummer.</p>
      {entries.length > 0 && (
        <ul className="mt-3 space-y-2">
          {entries.map(entry => (
            <li key={entry.year} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
              <span><span className="font-medium text-gray-900">{entry.year}</span> <span className="text-gray-600">startet bei {entry.start_number}</span></span>
              <button type="button" onClick={() => void remove(entry.year)} aria-label={`Startnummer für ${entry.year} löschen`} className="inline-flex h-8 w-8 min-h-0 min-w-0 items-center justify-center rounded-md text-red-600 hover:bg-red-50 hover:text-red-800">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <SettingsField id="yearly-start-year" label="Jahr" className="w-28">
          <input id="yearly-start-year" type="number" min="2000" max="2100" value={newYear} onChange={event => setNewYear(parseInt(event.target.value) || new Date().getFullYear())} className={settingsInputClass} />
        </SettingsField>
        <SettingsField id="yearly-start-number" label="Startnummer" className="w-32">
          <input id="yearly-start-number" type="number" min="1" max="9999" value={newStartNumber} onChange={event => setNewStartNumber(parseInt(event.target.value) || 1)} className={settingsInputClass} />
        </SettingsField>
        <button type="button" onClick={() => void add()} className="btn-secondary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Hinzufügen
        </button>
      </div>
      {message && <p role={message.type === 'error' ? 'alert' : 'status'} className={`mt-2 text-xs ${message.type === 'error' ? 'text-red-700' : 'text-green-700'}`}>{message.text}</p>}
    </div>
  );
}

/** Bereich „Rechnungen & Zahlung“ (`#settings/invoices`). */
export function InvoicingArea({ formData, setFormData, terminology, onNavigate }: CompanySettingsAreaProps & { onNavigate?: (page: string) => void }) {
  const invoiceNumberPattern = formData.invoiceNumberPattern || DEFAULT_INVOICE_NUMBER_PATTERN;
  const creditNoteNumberPattern = formData.creditNoteNumberPattern || DEFAULT_CREDIT_NOTE_NUMBER_PATTERN;
  const invoiceNumberPatternError = validateInvoiceNumberPattern(invoiceNumberPattern);
  const creditNoteNumberPatternError = validateInvoiceNumberPattern(creditNoteNumberPattern);
  const linkedHolder = formData.paymentInformationMode === 'company';
  const setPayment = (patch: Partial<NonNullable<typeof formData.paymentInformation>>) => setFormData(previous => ({
    ...previous,
    paymentInformation: { ...previous.paymentInformation, ...patch },
  }));

  return (
    <>
      <SettingsCard
        sectionId="bankverbindung"
        icon={CreditCard}
        title="Bankverbindung"
        description="Erscheint im Zahlungsbereich Ihrer Rechnungen und in eRechnungen."
        info={`Wählen Sie, ob der Kontoinhaber automatisch dem ${terminology.organization.nameInDativeLabel} folgen oder unabhängig davon gepflegt werden soll.`}
      >
        <div role="radiogroup" aria-label="Kontoinhaber" className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {[
            { id: 'separate' as const, title: 'Getrennt verwalten', text: `Kontoinhaber kann vom ${terminology.organization.nameInDativeLabel} abweichen.` },
            { id: 'company' as const, title: `Mit ${terminology.organization.dataLabel} verknüpfen`, text: `Kontoinhaber wird aus dem ${terminology.organization.nameInDativeLabel} übernommen.` },
          ].map(option => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={formData.paymentInformationMode === option.id}
              onClick={() => setFormData(previous => ({ ...previous, paymentInformationMode: option.id }))}
              className={choiceCardClass(formData.paymentInformationMode === option.id)}
            >
              <span className="block text-sm font-medium text-gray-900">{option.title}</span>
              <span className="mt-1 block text-xs text-gray-500">{option.text}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SettingsField
            id="payment-holder"
            label="Kontoinhaber"
            className="md:col-span-2"
            hint={linkedHolder
              ? `Wird automatisch aus dem aktuellen ${terminology.organization.nameInDativeLabel} gebildet.`
              : `Kann vom ${terminology.organization.nameInDativeLabel} abweichen (z. B. Geschäftsführer oder Inhaber).`}
          >
            <input
              id="payment-holder"
              type="text"
              name="account-holder"
              autoComplete="section-company name"
              value={linkedHolder ? formData.name : (formData.paymentInformation?.accountHolder || formData.name)}
              onChange={event => setPayment({ accountHolder: event.target.value })}
              disabled={linkedHolder}
              placeholder={`${formData.name} (${terminology.organization.nameLabel} als Standard)`}
              className={settingsInputClass}
            />
          </SettingsField>
          <SettingsField id="payment-iban" label="IBAN" required>
            <input id="payment-iban" type="text" name="iban" autoComplete="off" value={formData.paymentInformation?.bankAccount || formData.bankAccount || ''} onChange={event => setPayment({ bankAccount: event.target.value })} placeholder="DE89 3704 0044 0532 0130 00" className={settingsInputClass} />
          </SettingsField>
          <SettingsField id="payment-bic" label="BIC">
            <input id="payment-bic" type="text" name="bic" autoComplete="off" value={formData.paymentInformation?.bic || formData.bic || ''} onChange={event => setPayment({ bic: event.target.value })} placeholder="COBADEFFXXX" className={settingsInputClass} />
          </SettingsField>
          <SettingsField id="payment-bank-name" label="Bankname" className="md:col-span-2">
            <input id="payment-bank-name" type="text" name="bank-name" autoComplete="off" value={formData.paymentInformation?.bankName || ''} onChange={event => setPayment({ bankName: event.target.value })} placeholder="z.B. Commerzbank AG" className={settingsInputClass} />
          </SettingsField>
        </div>
      </SettingsCard>

      <SettingsCard sectionId="zahlungsbedingungen" icon={CalendarClock} title="Zahlungsbedingungen" description="Standardwerte für neue Rechnungen und Angebote.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SettingsField id="payment-days" label="Standard-Zahlungsziel (Tage)" required hint="Bei 0 Tagen ist die Rechnung sofort fällig.">
            <input
              id="payment-days"
              type="number"
              required
              min="0"
              max="365"
              value={formData.defaultPaymentDays !== undefined ? formData.defaultPaymentDays : 30}
              onChange={event => {
                const value = parseInt(event.target.value);
                setFormData(previous => ({ ...previous, defaultPaymentDays: isNaN(value) ? 30 : value }));
              }}
              className={settingsInputClass}
            />
          </SettingsField>
          <SettingsField id="payment-methods" label="Zahlungsarten" hint="Mehrere Zahlungsarten durch Komma trennen.">
            <input
              id="payment-methods"
              type="text"
              value={(formData.paymentInformation?.paymentMethods || []).join(', ')}
              onChange={event => setPayment({ paymentMethods: event.target.value.split(',').map(method => method.trim()).filter(Boolean) })}
              placeholder="z.B. Überweisung, PayPal, Barzahlung"
              className={settingsInputClass}
            />
          </SettingsField>
          <SettingsField id="payment-immediate-clause" label="Sofortzahlungsklausel" info="Diese Klausel wird in Rechnungen mit 0 Tagen Zahlungsziel in den Zahlungsbedingungen angezeigt." className="md:col-span-2">
            <textarea
              id="payment-immediate-clause"
              value={formData.immediatePaymentClause || 'Rechnung ist per sofort fällig, ohne Abzug'}
              onChange={event => setFormData(previous => ({ ...previous, immediatePaymentClause: event.target.value }))}
              className={settingsInputClass}
              rows={2}
              placeholder="Text, der bei sofortiger Zahlung in der Rechnung angezeigt wird"
            />
          </SettingsField>
          <SettingsField id="payment-terms" label="Zusätzliche Zahlungsbedingungen" info="Diese Bedingungen werden in Rechnungen und Angeboten angezeigt." className="md:col-span-2">
            <textarea
              id="payment-terms"
              value={formData.paymentInformation?.paymentTerms || ''}
              onChange={event => setPayment({ paymentTerms: event.target.value })}
              placeholder="z.B. Bei Zahlungsrückstand werden Verzugszinsen berechnet"
              className={settingsInputClass}
              rows={3}
            />
          </SettingsField>
        </div>
      </SettingsCard>

      <SettingsCard
        sectionId="nummernkreise"
        icon={Hash}
        title="Nummernkreise"
        description="Aufbau und Start der fortlaufenden Rechnungs- und Gutschriftsnummern."
        info="Die Startnummer wird nur bei neuen Systemen oder beim Jahreswechsel verwendet. Bereits vergebene Nummern werden weitergezählt und auch nach dem Löschen eines Entwurfs nicht erneut verwendet. Platzhalter: {YYYY} Jahr, {YY} Kurzjahr, {MM} Monat und genau ein fortlaufender Zähler von {N} bis {NNNNNNNN}; mehrere N bestimmen die Mindestbreite."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SettingsField
            id="invoice-number-pattern"
            label="Muster für Rechnungen"
            error={invoiceNumberPatternError || undefined}
            hint={`Vorschau: ${formatInvoiceNumberPattern(invoiceNumberPattern, new Date(), formData.invoiceStartNumber || 1)}`}
          >
            <input
              id="invoice-number-pattern"
              value={invoiceNumberPattern}
              maxLength={50}
              onChange={event => setFormData(previous => ({ ...previous, invoiceNumberPattern: event.target.value }))}
              className={`${settingsInputClass} font-mono text-sm ${invoiceNumberPatternError ? 'border-red-300' : ''}`}
              aria-invalid={Boolean(invoiceNumberPatternError)}
              aria-describedby="invoice-number-pattern-message"
            />
          </SettingsField>
          <SettingsField
            id="credit-note-number-pattern"
            label="Muster für Gutschriften"
            error={creditNoteNumberPatternError || undefined}
            hint={`Vorschau: ${formatInvoiceNumberPattern(creditNoteNumberPattern, new Date(), formData.invoiceStartNumber || 1)}`}
          >
            <input
              id="credit-note-number-pattern"
              value={creditNoteNumberPattern}
              maxLength={50}
              onChange={event => setFormData(previous => ({ ...previous, creditNoteNumberPattern: event.target.value }))}
              className={`${settingsInputClass} font-mono text-sm ${creditNoteNumberPatternError ? 'border-red-300' : ''}`}
              aria-invalid={Boolean(creditNoteNumberPatternError)}
              aria-describedby="credit-note-number-pattern-message"
            />
          </SettingsField>
          <SettingsField id="invoice-start-number" label="Fallback-Startnummer" required hint="Gilt, wenn für das Rechnungsjahr keine eigene Startnummer hinterlegt ist.">
            <input
              id="invoice-start-number"
              type="number"
              required
              min="1"
              max="999999"
              value={formData.invoiceStartNumber ?? 1}
              onChange={event => setFormData(previous => ({ ...previous, invoiceStartNumber: parseInt(event.target.value, 10) || 1 }))}
              className={settingsInputClass}
            />
          </SettingsField>
        </div>
        <div className="mt-4">
          <YearlyStartNumbers />
        </div>
      </SettingsCard>

      <SettingsCard
        sectionId="erechnung"
        icon={FileCheck2}
        title="eRechnung & Vorlagen"
        description={`ZUGFeRD und XRechnung stehen beim Export zur Verfügung. Prüfen Sie vor dem Versand Ihre ${terminology.organization.dataLabel}, Zahlungsinformationen und die Leitweg-ID des Empfängers.`}
        actions={onNavigate && (
          <button type="button" onClick={() => onNavigate('templates')} className="btn-secondary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium">
            Vorlagen öffnen
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      >
        <p className="text-sm text-gray-600">PDF-Layouts, Farben, Logos und Dokumenttexte werden separat in den Vorlagen verwaltet.</p>
      </SettingsCard>
    </>
  );
}
