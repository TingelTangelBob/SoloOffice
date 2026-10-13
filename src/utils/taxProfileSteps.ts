export type TaxProfileStepId = 'activity' | 'craft' | 'vat' | 'insurance' | 'personal';

export interface TaxProfileStep {
  id: TaxProfileStepId;
  title: string;
  shortTitle: string;
  purpose: string;
  /** Laufende Nummer unter den sichtbaren Schritten, beginnend bei 1. */
  number: number;
  total: number;
}

const STEP_DEFINITIONS: Array<Omit<TaxProfileStep, 'number' | 'total'>> = [
  { id: 'activity', title: 'Tätigkeit und Beginn', shortTitle: 'Tätigkeit', purpose: 'Die Tätigkeit ordnet passende Schätzungsbereiche wie Gewerbesteuer oder mögliche Sozialversicherung ein. Sie begründet für sich allein keine Versicherungspflicht.' },
  { id: 'craft', title: 'Handwerk und mögliche Vorschläge', shortTitle: 'Handwerk', purpose: 'Die Kammerangabe hilft, mögliche Kammerbeiträge als Richtwert zu erfassen. Ein Rentenversicherungsstatus wird nur anhand eines passenden Bescheids angegeben.' },
  { id: 'vat', title: 'Umsatzsteuer', shortTitle: 'Umsatzsteuer', purpose: 'Status, Vorjahresumsatz und Besteuerungsart helfen, Umsatzsteuergrenzen und mögliche Vorauszahlungen einzuordnen.' },
  { id: 'insurance', title: 'Kranken-, Pflege- und Rentenversicherung', shortTitle: 'Versicherungen', purpose: 'Versicherungsart und Angaben aus Bescheiden beeinflussen die Schätzung von Kranken-, Pflege- und Rentenversicherungsbeiträgen.' },
  { id: 'personal', title: 'Persönliche Angaben und Vorauszahlungen', shortTitle: 'Persönliches', purpose: 'Veranlagungsart, weitere Einkünfte und Vorauszahlungen fließen in die Schätzung der persönlichen Einkommensteuer ein.' },
];

export function isCraftBusinessKind(businessKind: string | null | undefined): boolean {
  return businessKind === 'craft_a' || businessKind === 'craft_b';
}

/**
 * Sichtbare Schritte des Steuerprofils mit lückenloser Nummerierung.
 * Der Handwerksschritt erscheint nur bei Handwerk; die übrigen Schritte
 * rücken dann nach, statt „Schritt 1 von 5, Schritt 3 von 5“ anzuzeigen.
 */
export function visibleTaxProfileSteps(businessKind: string | null | undefined): TaxProfileStep[] {
  const visible = STEP_DEFINITIONS.filter(step => step.id !== 'craft' || isCraftBusinessKind(businessKind));
  return visible.map((step, index) => ({ ...step, number: index + 1, total: visible.length }));
}
