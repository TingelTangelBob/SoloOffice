import { useEffect, useMemo, useRef, useState } from 'react';
import type { EuerEntryType, EuerVatFields, EuerVatTreatment } from '../types';
import { defaultVatRate, isReverseCharge, reverseChargeAmounts, splitGrossAmount, validateVatAmounts, vatRateOptions } from '../utils/vatEntryForm';
import { LocalizedDateInput } from './LocalizedDateInput';
import { LocalizedNumberInput } from './LocalizedNumberInput';

interface Props {
  entryType: EuerEntryType;
  amount: string | number;
  taxRate: string | number;
  entryDate: string;
  value: EuerVatFields;
  locale?: string;
  dateFormat?: 'DD.MM.YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  numberFormat?: 'european' | 'american';
  isSmallBusiness?: boolean;
  onChange: (value: EuerVatFields) => void;
  onTaxRateChange?: (value: number) => void;
  onAmountChange?: (value: number) => void;
  suggestionLabel?: string;
  onAcceptSuggestion?: () => void;
}

const treatmentLabels: Record<EuerVatTreatment, string> = {
  taxable: 'Mit USt', exempt: 'Steuerfrei (z. B. § 4 Nr. 21 UStG)', no_vat: 'Ohne USt / nicht steuerbar',
  reverse_charge_eu: 'Reverse Charge EU (§ 13b Abs. 1)', reverse_charge_domestic: 'Reverse Charge Inland (§ 13b Abs. 2)',
};

export function VatFieldsEditor({ entryType, amount, taxRate, entryDate, value, locale = 'de-DE', dateFormat, numberFormat, isSmallBusiness, onChange, onTaxRateChange, onAmountChange, suggestionLabel, onAcceptSuggestion }: Props) {
  const gross = Number(amount);
  const rate = Number(taxRate) || 0;
  const parameterYear = Number(entryDate.slice(0, 4)) || new Date().getFullYear();
  const standardAndReducedRates = vatRateOptions(parameterYear);
  const selectedRate = defaultVatRate(rate, parameterYear);
  const [expanded, setExpanded] = useState(!isSmallBusiness);
  const lastCalculation = useRef(`${gross}:${rate}:${value.vatTreatment || ''}`);
  const expense = entryType === 'expense';
  const reverse = isReverseCharge(value.vatTreatment);
  const validation = useMemo(() => validateVatAmounts({ entryType, amount: gross, vatTreatment: value.vatTreatment, netAmount: value.netAmount, vatAmount: value.vatAmount }), [entryType, gross, value.vatAmount, value.netAmount, value.vatTreatment]);

  useEffect(() => {
    if (isSmallBusiness) setExpanded(false);
  }, [isSmallBusiness]);

  useEffect(() => {
    const key = `${gross}:${rate}:${value.vatTreatment || ''}`;
    if (lastCalculation.current === key) return;
    lastCalculation.current = key;
    if (value.vatTreatment === 'taxable') onChange({ ...value, ...(splitGrossAmount(gross, rate) || {}) });
    else if (isReverseCharge(value.vatTreatment)) onChange({ ...value, ...(reverseChargeAmounts(gross, rate) || {}) });
  }, [gross, onChange, rate, value, value.vatTreatment]);

  const chooseTreatment = (treatment: EuerVatTreatment) => {
    let next: EuerVatFields = { ...value, vatTreatment: treatment };
    if (treatment === 'taxable') {
      const split = splitGrossAmount(gross, rate);
      next = { ...next, ...split, inputTaxDeductible: expense ? isSmallBusiness ? false : value.inputTaxDeductible ?? true : null };
    } else if (isReverseCharge(treatment)) {
      next = { ...next, ...(reverseChargeAmounts(gross, rate) || {}), inputTaxDeductible: (isSmallBusiness ? false : value.inputTaxDeductible ?? true) };
    } else {
      next = { ...next, netAmount: gross, vatAmount: 0, inputTaxDeductible: null };
    }
    onChange(next);
  };

  return <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5" aria-labelledby="vat-fields-title">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><h3 id="vat-fields-title" className="text-base font-semibold text-gray-900">Umsatzsteuer</h3><p className="mt-1 text-xs leading-5 text-gray-500">Angaben zur Orientierung; bitte mit Rechnung oder Beleg abgleichen.</p></div>
      {isSmallBusiness && <button type="button" onClick={() => setExpanded(open => !open)} className="shrink-0 text-xs font-medium text-primary-custom">{expanded ? 'Einklappen' : 'Angaben anzeigen'}</button>}
    </div>
    {isSmallBusiness && <p className="mt-3 rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-600">Bei § 19 werden keine Vorsteuerbeträge angesetzt. Reverse Charge kann besondere Umsatzsteuer auslösen.</p>}
    {expanded && <div className="mt-4 space-y-4">
      {suggestionLabel && onAcceptSuggestion && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><span>{suggestionLabel} · bitte vor dem Speichern prüfen.</span><button type="button" onClick={onAcceptSuggestion} className="font-semibold underline">Vorschlag übernehmen</button></div>}
      <label className="block text-sm font-medium text-gray-700">Behandlung<select value={value.vatTreatment || ''} onChange={event => { if (event.target.value) chooseTreatment(event.target.value as EuerVatTreatment); }} className="form-input mt-1 w-full"><option value="">Bitte auswählen</option>{expense ? <><option value="taxable">Mit USt (Vorsteuer)</option><option value="no_vat">Ohne USt</option><option value="reverse_charge_eu">{treatmentLabels.reverse_charge_eu}</option><option value="reverse_charge_domestic">{treatmentLabels.reverse_charge_domestic}</option></> : <><option value="taxable">Mit USt</option><option value="exempt">{treatmentLabels.exempt}</option><option value="no_vat">{treatmentLabels.no_vat}</option></>}</select></label>
      {(value.vatTreatment === 'taxable' || reverse) && <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-gray-700">Steuersatz<select value={selectedRate} onChange={event => { const selected = event.target.value; const nextRate = selected === 'other' ? rate : Number(selected); onTaxRateChange?.(nextRate); const amounts = reverse ? reverseChargeAmounts(gross, nextRate) : splitGrossAmount(gross, nextRate); onChange({ ...value, ...(amounts || {}) }); }} className="form-input mt-1 w-full"><option value={standardAndReducedRates[0]}>{standardAndReducedRates[0]} %</option><option value={standardAndReducedRates[1]}>{standardAndReducedRates[1]} %</option><option value={standardAndReducedRates[2]}>{standardAndReducedRates[2]} %</option><option value="other">Anderer Satz</option></select></label>
        {selectedRate === 'other' && <label className="block text-sm font-medium text-gray-700">Anderer Steuersatz in %<LocalizedNumberInput min="0" max="100" step="0.01" value={rate} locale={locale} numberFormat={numberFormat} onValueChange={nextRate => { const actual = nextRate === '' ? 0 : nextRate; onTaxRateChange?.(actual); onChange({ ...value, ...(reverse ? reverseChargeAmounts(gross, actual) : splitGrossAmount(gross, actual)) }); }} className="mt-1 w-full" /></label>}
        <label className="block text-sm font-medium text-gray-700">Netto<LocalizedNumberInput min="0" step="0.01" value={value.netAmount ?? ''} locale={locale} numberFormat={numberFormat} onValueChange={nextNet => { if (nextNet === '') { onChange({ ...value, netAmount: null }); return; } if (reverse) onAmountChange?.(nextNet); const amounts = reverse ? reverseChargeAmounts(nextNet, rate) : { ...splitGrossAmount(gross, rate), netAmount: nextNet, vatAmount: Math.round((nextNet * rate + Number.EPSILON) * 100) / 100 }; onChange({ ...value, netAmount: amounts?.netAmount, vatAmount: amounts?.vatAmount }); }} className="mt-1 w-full" /></label>
        <label className="block text-sm font-medium text-gray-700">USt{reverse ? ' (Orientierungswert)' : ''}<LocalizedNumberInput min="0" step="0.01" value={value.vatAmount ?? ''} locale={locale} numberFormat={numberFormat} onValueChange={nextVat => onChange({ ...value, vatAmount: nextVat === '' ? null : nextVat })} className="mt-1 w-full" /></label>
      </div>}
      {expense && (value.vatTreatment === 'taxable' || reverse) && <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={value.inputTaxDeductible === true} disabled={isSmallBusiness} onChange={event => onChange({ ...value, inputTaxDeductible: event.target.checked })} className="rounded border-gray-300 text-primary-custom focus:ring-primary-custom" />Vorsteuer abziehbar</label>}
      <label className="block text-sm font-medium text-gray-700">Rechnungs-/Belegdatum, falls abweichend vom Zahlungsdatum<LocalizedDateInput value={value.documentDate || ''} onChange={documentDate => onChange({ ...value, documentDate: documentDate && documentDate !== entryDate ? documentDate : null })} locale={locale} dateFormat={dateFormat} className="mt-1 w-full" aria-label="Rechnungs- oder Belegdatum" /></label>
      {validation && <p role="alert" className="text-xs text-rose-700">{validation}</p>}
    </div>}
  </section>;
}
