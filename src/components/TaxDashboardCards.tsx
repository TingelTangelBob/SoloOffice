import { useState } from 'react';
import { TAX_TEXTS } from '../../backend/shared/taxTexts.js';
import type { ForecastMonth, ForecastResult, LevyPayment, ThresholdResult } from '../types/finance';
import { DashboardEmptyState } from './DashboardEmptyState';
import { FloatingInfoTooltip } from './InfoTooltip';
import { MetricCard, MetricCardContent, MetricCardDescription, MetricCardHeader, MetricCardTitle, MetricBadge, MetricValue } from './DashboardMetrics';
import { TaxThresholdBar } from './TaxThresholdBar';
import { fixedCostMonthlyComparison, germanThresholdStatus, isRecordedAdvanceOverdue, previousRevenueDisplay, reserveRatioDisplay, taxBreakdown } from '../utils/taxDashboardDisplay';

export type TaxDashboardCardId = 'taxes' | 'tax-reserve' | 'tax-position' | 'small-business' | 'fixed-costs' | 'tax-advances' | 'health-backpayment';

interface TaxDashboardCardsProps {
  id: TaxDashboardCardId;
  forecast: ForecastResult | null;
  year: number;
  month?: string;
  compareMonth?: string;
  comparisonForecast?: ForecastMonth;
  monthView?: boolean;
  privateLeviesVisible?: boolean;
  loading: boolean;
  error: string | null;
  onSetup: () => void;
  onFixedCosts: () => void;
}

const money = (amount: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
const thresholdOf = (forecast: ForecastResult, id: ThresholdResult['id']) => forecast.thresholds.find(item => item.id === id);
const privateCard = (id: TaxDashboardCardId) => id !== 'fixed-costs' && id !== 'small-business';
const dateLabel = (date: string) => new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));

function StateContent({ loading, error, forecast, onSetup }: Pick<TaxDashboardCardsProps, 'loading' | 'error' | 'forecast' | 'onSetup'>) {
  if (loading) return <p role="status" className="px-4 py-6 text-sm text-gray-500">Steuerschätzung wird geladen …</p>;
  if (error) return <div className="px-4 py-5"><p role="alert" className="text-sm text-red-700">{error}</p><p className="mt-1 text-xs text-gray-500">Es werden keine älteren Werte dieses Workspaces angezeigt.</p></div>;
  if (!forecast) return <DashboardEmptyState variant="metric" title="Keine Schätzung verfügbar" description="Prüfe Erweiterung und Berechtigung für das Steuerprofil." />;
  if (!forecast.profileComplete) return <DashboardEmptyState variant="metric" title="Steuerprofil noch offen" description="Mit den noch fehlenden Angaben kann SoloOffice eine Schätzung erstellen." action={{ label: 'Steuern & Abgaben einrichten', onClick: onSetup }} />;
  return null;
}

export function TaxDashboardCards({ id, forecast, year, month, compareMonth, comparisonForecast, monthView = false, privateLeviesVisible = false, loading, error, onSetup, onFixedCosts }: TaxDashboardCardsProps) {
  const [position, setPosition] = useState<ThresholdResult['id']>('est');
  const title: Record<TaxDashboardCardId, string> = {
    taxes: 'Steuern & Sozialabgaben', 'tax-reserve': 'Verbleibende Rücklage', 'tax-position': 'Wo stehe ich?',
    'small-business': 'Kleinunternehmerregelung (§ 19 UStG)', 'fixed-costs': 'Betriebliche Fixkosten',
    'tax-advances': 'Vorauszahlungen', 'health-backpayment': 'Mögliche KV-Nachzahlung',
  };
  const infoText: Record<TaxDashboardCardId, string> = {
    taxes: `${TAX_TEXTS.socialNotice} ${TAX_TEXTS.tooltip(year)}`,
    'tax-reserve': `Die Rücklage ist eine Schätzung. ${TAX_TEXTS.tooltip(year)}`,
    'tax-position': `Schwellen und Belastungswerte sind Richtwerte. ${TAX_TEXTS.tooltip(year)}`,
    'small-business': `${TAX_TEXTS.smallBusinessNotice} ${TAX_TEXTS.tooltip(year)}`,
    'fixed-costs': `Geplante betriebliche Fixkosten aus den erfassten Vorlagen. ${TAX_TEXTS.tooltip(year)}`,
    'tax-advances': `Termine und Zahlungen aus gespeicherten Bescheiden und Profilangaben. ${TAX_TEXTS.tooltip(year)}`,
    'health-backpayment': `${TAX_TEXTS.socialNotice} ${TAX_TEXTS.tooltip(year)}`,
  };
  if (privateCard(id) && !privateLeviesVisible) return null;

  const isAnnual = ['taxes', 'tax-reserve', 'tax-position', 'small-business', 'health-backpayment'].includes(id);
  const showState = loading || Boolean(error) || !forecast || (isAnnual && !forecast.profileComplete);
  const state = showState ? <StateContent loading={loading} error={error} forecast={forecast} onSetup={onSetup} /> : null;
  const extended = forecast;
  const yearWarning = forecast && forecast.parameterYear !== year ? <p role="note" className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">{TAX_TEXTS.missingYearNotice(year, forecast.parameterYear, forecast.paramsAsOf)}</p> : null;
  const selectedMonth = monthView ? forecast?.monthly.find(item => item.month === month) : undefined;
  const selectedComparisonMonth = comparisonForecast;
  const social = forecast?.social;

  let body = state;
  if (!state && forecast && extended) {
    if (id === 'taxes') {
      const breakdown = taxBreakdown(forecast.taxes);
      const monthlyTotal = selectedMonth ? selectedMonth.social + selectedMonth.taxReserve : null;
      const comparedTotal = selectedComparisonMonth ? selectedComparisonMonth.social + selectedComparisonMonth.taxReserve : null;
      body = <div className="space-y-3 px-4 pb-4">
        <MetricValue>{money(monthView && monthlyTotal !== null ? monthlyTotal : forecast.annualBurden)}</MetricValue>
        <MetricCardDescription>{monthView ? 'Monatsrichtwert für Sozialbeiträge und Steuern' : 'Jahresprognose für Sozialbeiträge und Steuern'}</MetricCardDescription>
        {monthView && comparedTotal !== null && <p className="text-xs text-gray-600">{month} gegenüber {compareMonth}: {money(monthlyTotal!)} gegenüber {money(comparedTotal)} · Veränderung {money(monthlyTotal! - comparedTotal)}</p>}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-gray-100 pt-2 text-xs text-gray-600">
          <span>Krankenversicherung (Jahr)</span><span className="text-right tabular-nums">{money(social?.health ?? 0)}</span>
          <span>Pflegeversicherung (Jahr)</span><span className="text-right tabular-nums">{money(social?.care ?? 0)}</span>
          <span>Rentenversicherung (Jahr)</span><span className="text-right tabular-nums">{money(social?.pension ?? 0)}</span>
          <span>Arbeitslosenversicherung (Jahr)</span><span className="text-right tabular-nums">{money(social?.unemployment ?? 0)}</span>
          <span>Einkommensteuer nach möglicher §-35-Anrechnung (Jahr)</span><span className="text-right tabular-nums">{money(breakdown.incomeTax)}</span>
          <span>Solidaritätszuschlag (Jahr)</span><span className="text-right tabular-nums">{money(breakdown.solidarity)}</span>
          <span>Kirchensteuer (Jahr)</span><span className="text-right tabular-nums">{money(breakdown.churchTax)}</span>
          <span>Gewerbesteuer, vor Anrechnung (Jahr)</span><span className="text-right tabular-nums">{money(breakdown.tradeTax)}</span>
          <span>§ 35 EStG, in der ESt berücksichtigt</span><span className="text-right tabular-nums">{money(breakdown.tradeCredit)}</span>
          <span>Umsatzsteuer-Richtwert, separat</span><span className="text-right tabular-nums">{money(forecast.vatReserveGrossEstimate)}</span>
        </div>
        <p className="text-xs text-gray-600">Im Jahr erfasste Steuer- und Sozialzahlungen: {money(forecast.paidNonVatLevies)} · verbleibender Jahresbedarf: {money(forecast.remainingReserve)}.</p>
        <p className="text-xs text-gray-500">Jahreswerte bleiben auch in der Monatsansicht als Zusatzinformation ausgewiesen. {TAX_TEXTS.pensionNotice}</p>
      </div>;
    } else if (id === 'tax-reserve') {
      const reserve = reserveRatioDisplay(extended.expectedRemainingInflows ?? 0, forecast.remainingReserve);
      body = <div className="space-y-2 px-4 pb-4">
        <MetricValue>{money(monthView && selectedMonth ? selectedMonth.social + selectedMonth.taxReserve : forecast.remainingReserve)}</MetricValue>
        <MetricCardDescription>{monthView ? 'Monatsrichtwert Sozialbeiträge und Steuern; Umsatzsteuer separat' : 'Verbleibende Jahresrücklage für Steuern und Sozialbeiträge'}</MetricCardDescription>
        {!monthView && <p className="text-xs text-gray-600">Erwartete Resteinnahmen: {money(reserve.denominator)} · Anteil der Rücklage: {reserve.ratio === null ? 'nicht berechenbar' : new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1 }).format(reserve.ratio)}.</p>}
        {monthView && selectedMonth && <p className="text-xs text-gray-600">Sozial- und Steuerrichtwert: {money(selectedMonth.social + selectedMonth.taxReserve)} · Umsatzsteuer-Richtwert: {money(selectedMonth.vatReserve)}.</p>}
        {!monthView && <p className="text-xs text-gray-600">Umsatzsteuer-Restbedarf (grob), separat: {money(forecast.vatRemainingReserve)}. {TAX_TEXTS.vatRoughNotice}</p>}
        {monthView && selectedComparisonMonth && <p className="text-xs text-gray-600">Vergleich {compareMonth}: {money(selectedComparisonMonth.social + selectedComparisonMonth.taxReserve)}.</p>}
        <p className="text-xs text-gray-500">Die Rücklage wird den erwarteten Resteinnahmen gegenübergestellt und ist keine persönliche Gestaltungsempfehlung.</p>
      </div>;
    } else if (id === 'tax-position') {
      const options: { id: ThresholdResult['id']; label: string }[] = [
        { id: 'est', label: 'ESt' }, { id: 'kv', label: 'KV' }, { id: 'rv', label: 'RV' },
        { id: 'small_business', label: '§ 19' }, { id: 'trade', label: 'Gewerbe' }, { id: 'ihk', label: 'IHK' }, { id: 'bookkeeping_profit', label: 'Buchführung Gewinn' }, { id: 'bookkeeping_revenue', label: 'Buchführung Umsatz' }, { id: 'ksk', label: 'KSK' },
      ];
      const chosen = thresholdOf(forecast, position);
      body = <div className="space-y-3 px-4 pb-4">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Schwelle auswählen">{options.map(option => <button type="button" key={option.id} onClick={() => setPosition(option.id)} aria-pressed={position === option.id} className={`min-h-9 rounded-md px-2 text-xs font-medium ${position === option.id ? 'bg-primary-custom text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{option.label}</button>)}</div>
        {chosen ? <TaxThresholdBar threshold={chosen} modeLabel={position === 'small_business' ? 'Ist-Umsatz im Jahr' : 'Jahresprognose'} projectionValue={position === 'small_business' ? forecast.smallBusiness.forecastValue : undefined} marginalRate={position === 'est' ? forecast.taxes.marginalRate : undefined} combinedMarginalRate={position === 'est' ? forecast.combinedMarginalRate : undefined} /> : <p className="text-sm text-gray-500">Für diese Einordnung liegen keine Werte vor.</p>}
        {position === 'kv' && <p className="text-xs text-gray-600">{forecast.social.warnings.join(' ') || TAX_TEXTS.socialNotice}</p>}
        {position === 'rv' && <p className="text-xs text-gray-600">{TAX_TEXTS.pensionNotice}</p>}
        {position === 'ksk' && <p className="text-xs text-gray-600">{TAX_TEXTS.kskNotice}</p>}
      </div>;
    } else if (id === 'small-business') {
      const prior = previousRevenueDisplay(forecast.smallBusiness.previousValue, extended.previousYearRevenueKnown ?? forecast.smallBusiness.previousValue > 0);
      const statusLabel = germanThresholdStatus(forecast.smallBusiness.current);
      const priorStatusLabel = germanThresholdStatus(forecast.smallBusiness.previous);
      const warningBoundary = thresholdOf(forecast, 'small_business')?.bands.find(band => band.tone === 'warning')?.from ?? forecast.smallBusiness.currentLimit;
      const forecastTone = forecast.smallBusiness.forecastValue > forecast.smallBusiness.currentLimit ? 'negative' : forecast.smallBusiness.forecastValue >= warningBoundary ? 'warning' : 'positive';
      body = <div className="space-y-3 px-4 pb-4">
        <div className="grid grid-cols-2 gap-2 text-sm"><span>Vorjahresumsatz</span><strong className="text-right">{prior === null ? 'Nicht bekannt' : money(prior)}</strong><span>Ist-Umsatz {year}</span><strong className="text-right">{money(forecast.smallBusiness.currentValue)}</strong><span>Jahresprognose</span><strong className="text-right">{money(forecast.smallBusiness.forecastValue)}</strong></div>
        {prior !== null && <p className="text-xs text-gray-600">Vorjahresampel: {priorStatusLabel} · Ist-Ampel: {statusLabel}</p>}
        <p className="flex flex-wrap items-center gap-2 text-xs text-gray-600"><span>Grenzwert: {money(forecast.smallBusiness.currentLimit)}</span><MetricBadge tone={forecast.smallBusiness.current === 'green' ? 'positive' : forecast.smallBusiness.current === 'red' ? 'negative' : 'warning'}>Ist: {statusLabel}</MetricBadge><MetricBadge tone={forecastTone}>Prognose: {forecast.smallBusiness.forecastValue > forecast.smallBusiness.currentLimit ? `über dem Richtwert um ${money(forecast.smallBusiness.forecastValue - forecast.smallBusiness.currentLimit)}` : `Abstand ${money(forecast.smallBusiness.currentLimit - forecast.smallBusiness.forecastValue)}`}</MetricBadge></p>
        {forecast.smallBusiness.currentValue > forecast.smallBusiness.currentLimit && <p className="text-xs text-rose-700">Die erfassten Umsätze liegen oberhalb des hinterlegten Richtwerts.</p>}
        <p className="text-xs text-gray-600">{forecast.vatStatus && forecast.vatStatus !== 'small_business' ? `Im Profil ist ${forecast.vatStatus === 'regular' ? 'Regelbesteuerung' : 'Bildungsbefreiung'} hinterlegt. ` : ''}{TAX_TEXTS.smallBusinessNotice}</p>
      </div>;
    } else if (id === 'fixed-costs') {
      const comparison = fixedCostMonthlyComparison(selectedMonth, selectedComparisonMonth);
      const upcoming = (extended.dueExpenses ?? forecast.upcomingExpenses ?? []).filter(run => (run.scope ?? 'business') === 'business' && run.status === 'planned' && (!monthView || run.dueDate.startsWith(`${month}-`))).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 3);
      const now = monthView && month ? `${month}-01` : new Date().toISOString().slice(0, 10);
      const noticeLimit = monthView && month ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10) : new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
      const soonNotices = (extended.expenseNotices ?? []).filter(notice => notice.noticeDeadline && notice.noticeDeadline >= now && notice.noticeDeadline <= noticeLimit).sort((a, b) => a.noticeDeadline!.localeCompare(b.noticeDeadline!));
      body = <div className="space-y-3 px-4 pb-4">
        <div className="grid grid-cols-2 gap-2"><div><MetricValue className="text-xl">{money(comparison?.current ?? forecast.fixedCostsMonthly)}</MetricValue><MetricCardDescription>{monthView ? `im gewählten Monat ${month ?? ''}` : 'pro Monat'}</MetricCardDescription></div><div><MetricValue className="text-xl">{money(forecast.fixedCostsAnnual)}</MetricValue><MetricCardDescription>Jahreswert, Zusatz</MetricCardDescription></div></div>
        {monthView && comparison && comparison.comparison !== null && <p className="text-xs text-gray-600">{month} gegenüber {compareMonth}: {money(comparison.current)} gegenüber {money(comparison.comparison)} · Veränderung {money(comparison.difference ?? 0)}</p>}
        {upcoming.length ? <div><p className="text-xs font-medium text-gray-700">Nächste offene oder geplante betriebliche Fälligkeiten</p><ul className="divide-y divide-gray-100">{upcoming.map(run => <li key={run.id} className="flex justify-between gap-3 py-1.5 text-xs"><span>{run.name || 'Fixkosten'} · {dateLabel(run.dueDate)}{run.status === 'planned' && <span className="block text-gray-500">Geplant · keine Buchung</span>}</span><strong className="shrink-0 tabular-nums">{money(run.amountGross)}</strong></li>)}</ul></div> : <DashboardEmptyState variant="metric" title="Noch keine geplanten Fälligkeiten" description="Erfasste betriebliche Fixkosten erscheinen hier vor ihrem Termin." action={{ label: 'Fixkosten einrichten', onClick: onFixedCosts }} />}
        {soonNotices.length > 0 && <div><p className="text-xs font-medium text-gray-700">{monthView ? 'Kündigungsfristen im gewählten Monat' : 'Kündigungsfristen in den nächsten 60 Tagen'}</p><ul className="text-xs text-gray-600">{soonNotices.map(notice => <li key={notice.id}>{notice.name} · Frist {dateLabel(notice.noticeDeadline!)}{notice.endDate ? ` · Vertragsende ${dateLabel(notice.endDate)}` : ''}</li>)}</ul></div>}
        <p className="text-xs text-gray-600">Geplante Fälligkeiten sind Richtwerte und lösen keine Buchung aus.</p>
        <button type="button" className="action-button" onClick={onFixedCosts}>Fixkosten öffnen</button>
      </div>;
    } else if (id === 'tax-advances') {
      const advances: LevyPayment[] = forecast.upcomingLevies.filter(item => ['est_vz', 'gewst_vz', 'ust'].includes(item.kind) && (!monthView || item.dueDate.startsWith(`${month}-`)));
      const paid = monthView && extended.paidAdvanceMonths?.find(item => item.month === month)
        ? extended.paidAdvanceMonths.find(item => item.month === month)!
        : extended.paidAdvances;
      const paidAmount = paid ? paid.est_vz + paid.gewst_vz + paid.ust : 0;
      const now = new Date().toISOString().slice(0, 10);
      const groupedPaid = paid ? `ESt ${money(paid.est_vz)} · GewSt ${money(paid.gewst_vz)} · USt ${money(paid.ust)}` : 'Keine Vorauszahlungen erfasst';
      body = <div className="space-y-2 px-4 pb-4">
        <p className="text-xs text-gray-600">Gezahlt je Art{monthView ? ` im Monat ${month}` : ' im Jahr'}: {groupedPaid}. Gesamt {money(paidAmount)}.</p>
        {advances.length ? <ul className="divide-y divide-gray-100">{advances.slice(0, 5).map(item => <li key={item.id} className="flex justify-between gap-3 py-2 text-sm"><span>{item.kind === 'est_vz' ? 'ESt' : item.kind === 'gewst_vz' ? 'GewSt' : 'USt'} · {dateLabel(item.dueDate)}{isRecordedAdvanceOverdue(item, now) && <span className="block text-rose-700">Überfällig · Zahlung nicht erfasst</span>}{item.id.startsWith('forecast:') && <span className="block text-xs text-gray-500">Terminrichtwert · keine Zahlungsbuchung</span>}</span><strong className="shrink-0 tabular-nums">{money(item.amount)}</strong></li>)}</ul> : <DashboardEmptyState variant="metric" title="Keine Vorauszahlungen erfasst" description="Erfasste ESt-, GewSt- und USt-Zahlungen erscheinen mit Termin und Zahlungsstatus." action={{ label: 'Vorauszahlungen einrichten', onClick: onSetup }} />}
        <p className="text-xs text-gray-500">KV- und RV-Zahlungen werden nicht als Steuervorauszahlungen ausgewiesen.</p>
      </div>;
    } else if (id === 'health-backpayment') {
      const risk = forecast.social.healthBackpaymentRisk;
      body = <div className="space-y-2 px-4 pb-4">
        {risk === null ? <p className="text-sm text-gray-600">Mangels Beitragsbescheid oder ausreichender Angaben nicht schätzbar.</p> : <><MetricValue>{money(monthView && selectedMonth ? risk * (forecast.social.total > 0 ? selectedMonth.social / forecast.social.total : 0) : risk)}</MetricValue><MetricCardDescription>{risk === 0 ? 'Kein rechnerischer Mehrbedarf gegenüber dem erfassten Bescheid.' : monthView ? 'Monatsrichtwert einer möglichen jährlichen Differenz.' : 'Möglicher jährlicher Mehrbedarf gegenüber den erfassten KV-/PV-Bescheidwerten.'}</MetricCardDescription></>}
        <p className="text-xs text-gray-500">{monthView ? 'Monats- und Jahreswert sind Schätzungen.' : 'Jahresbezogene Schätzung.'} {TAX_TEXTS.socialNotice}</p>
      </div>;
    }
  }

  return <MetricCard>
    <MetricCardHeader bordered>
      <div className="flex min-w-0 items-start gap-2"><div className="min-w-0"><MetricCardTitle>{title[id]}</MetricCardTitle></div><FloatingInfoTooltip text={infoText[id]} label={`Hinweise zu ${title[id]}`} /></div>
      <MetricBadge tone="warning" className="max-w-[9rem] whitespace-normal text-center">{TAX_TEXTS.badge}</MetricBadge>
    </MetricCardHeader>
    {yearWarning && <div className="px-4 pt-3">{yearWarning}</div>}
    <MetricCardContent className="flex flex-1 flex-col justify-center pt-4">{body}</MetricCardContent>
  </MetricCard>;
}
