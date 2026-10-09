import type { VatKennzahlen, VatPayment, VatPaymentStatus, VatPeriodResult } from '../types/vat';
import { resolveTaxParams } from '../../backend/shared/taxParams/index.js';

const paymentStatusLabels: Record<VatPaymentStatus, string> = {
  not_due: 'Noch nicht fällig',
  open: 'Offen',
  partial: 'Teilweise bezahlt',
  paid: 'Bezahlt',
  overpaid: 'Überzahlt',
  refund_open: 'Erstattung erwartet',
  settled: 'Erstattet',
  none: 'Keine Zahllast',
};

export function vatStatusLabel(status: VatPeriodResult['paymentStatus'], overdue = false): string {
  return vatPaymentStatusLabel(status, overdue);
}

export function vatPaymentStatusLabel(status: VatPaymentStatus, overdue = false): string {
  if (overdue && (status === 'open' || status === 'partial')) return 'Überfällig';
  return paymentStatusLabels[status];
}

export function vatPaymentKindLabel(kind: VatPayment['kind']): string {
  const labels: Record<VatPayment['kind'], string> = {
    advance: 'Vorauszahlung',
    special_prepayment: 'Sondervorauszahlung',
    annual_payment: 'Jahresabschlusszahlung',
    refund: 'Erstattung',
  };
  return labels[kind];
}

export function vatPeriodLabel(period: Pick<VatPeriodResult, 'label'>): string {
  return period.label;
}

export function vatPeriodKeyLabel(periodKey?: string | null): string {
  if (!periodKey) return '–';
  const quarter = /^(\d{4})-Q([1-4])$/i.exec(periodKey);
  if (quarter) {
    const months = [['Jan', 'Mär'], ['Apr', 'Jun'], ['Jul', 'Sep'], ['Okt', 'Dez']][Number(quarter[2]) - 1];
    return `Q${quarter[2]} ${quarter[1]} (${months[0]}–${months[1]})`;
  }
  const month = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (month && Number(month[2]) >= 1 && Number(month[2]) <= 12) {
    const date = new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1, 12));
    const label = new Intl.DateTimeFormat('de-DE', { month: 'short', timeZone: 'UTC' }).format(date).replace('.', '');
    return `${label} ${month[1]}`;
  }
  return periodKey;
}

export function vatPeriodAmountLabel(period: Pick<VatPeriodResult, 'liability' | 'estimatedLiability' | 'complete'>): string {
  const amount = period.complete ? period.liability : period.estimatedLiability;
  const prefix = period.complete ? '' : 'Schätzung · ';
  return amount < 0 ? `${prefix}Überschuss ${vatAmountLabel(Math.abs(amount))}` : `${prefix}${vatAmountLabel(amount)}`;
}

export function vatKennzahlRows(kennzahlen: VatKennzahlen, year: number) {
  const labels = resolveTaxParams(year).params.vat.kennzahlen as Record<string, string>;
  const definitions: Array<[keyof VatKennzahlen, string]> = [
    ['kz81', '81'], ['kz86', '86'], ['kz87', '87'], ['kz35', '35'], ['kz36', '36'], ['kz48', '48'],
    ['kz46', '46'], ['kz47', '47'], ['kz84', '84'], ['kz85', '85'], ['kz66', '66'], ['kz67', '67'], ['kz39', '39'], ['kz83', '83'],
  ];
  return definitions
    .filter(([key]) => key === 'kz83' || Math.abs(Number(kennzahlen[key]) || 0) >= 0.005)
    .map(([key, number]) => ({ key, number, label: labels[key] ?? `Kennzahl ${number}`, amount: Number(kennzahlen[key]) || 0 }));
}

export function euerKennzahlRows(euer: {
  smallBusinessIncome: number; exemptIncome: number; taxableIncomeNet: number; vatCollected: number;
  vatRefunded: number; inputTaxPaid: number; vatPaidToOffice: number;
}, year: number) {
  const labels = resolveTaxParams(year).params.vat.euerKennzahlen as Record<string, string>;
  const rows: Array<[keyof typeof euer, string, string]> = [
    ['smallBusinessIncome', 'smallBusinessIncome', 'Umsätze als Kleinunternehmer'],
    ['exemptIncome', 'exemptIncome', 'Steuerfreie und nicht steuerbare Einnahmen'],
    ['taxableIncomeNet', 'taxableIncomeNet', 'Steuerpflichtige Betriebseinnahmen ohne Umsatzsteuer'],
    ['vatCollected', 'vatCollected', 'Vereinnahmte Umsatzsteuer'],
    ['vatRefunded', 'vatRefunded', 'Vom Finanzamt erstattete Umsatzsteuer'],
    ['inputTaxPaid', 'inputTaxPaid', 'Gezahlte abziehbare Vorsteuer'],
    ['vatPaidToOffice', 'vatPaidToOffice', 'An das Finanzamt gezahlte Umsatzsteuer'],
  ];
  return rows.map(([key, labelKey, label]) => ({ key, number: labels[labelKey], label, amount: Number(euer[key]) || 0 }));
}

export function vatAmountLabel(amount: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number.isFinite(amount) ? amount : 0);
}

export function vatDateLabel(value?: string | null): string {
  if (!value) return '–';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

export function vatPeriodPaymentIds(period: VatPeriodResult, payments: VatPayment[]): VatPayment[] {
  const ids = new Set(period.paymentIds);
  return payments.filter(payment => ids.has(payment.id));
}
