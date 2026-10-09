import { useId, useMemo, useState } from 'react';
import { BookOpenText, Calculator, ShieldAlert } from 'lucide-react';
import { resolveTaxParams } from '../../backend/shared/taxParams/index.js';
import { TAX_TEXTS } from '../../backend/shared/taxTexts.js';
import { DialogShell } from './DialogShell';

interface TaxForecastHelpProps {
  onClose?: () => void;
}

/** Erklärt Rechenkette, Datenbasis und Grenzen der unverbindlichen Schätzung. */
export function TaxForecastHelp({ onClose = () => undefined }: TaxForecastHelpProps) {
  const titleId = useId();
  const [yearInput, setYearInput] = useState(String(new Date().getFullYear()));
  const year = Number(yearInput);
  const validYear = Number.isInteger(year) && year >= 2000 && year <= 2200;
  const resolved = useMemo(() => validYear ? resolveTaxParams(year) : null, [validYear, year]);
  if (!resolved) {
    return (
      <DialogShell title={TAX_TEXTS.helpTitle} titleId={titleId} onClose={onClose} icon={BookOpenText} size="lg">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
            <span>Steuerjahr</span>
            <input type="number" min={2000} max={2200} value={yearInput} onChange={event => setYearInput(event.target.value)} className="form-input w-24" />
          </label>
          <p className="text-sm text-gray-700">Bitte gib ein Steuerjahr zwischen 2000 und 2200 ein.</p>
        </div>
      </DialogShell>
    );
  }
  const { params, parameterYear, warning } = resolved;

  return (
    <DialogShell
      title={TAX_TEXTS.helpTitle}
      titleId={titleId}
      description="Rechenweg, verwendete Parameter und bekannte Grenzen im Überblick."
      onClose={onClose}
      icon={BookOpenText}
      size="lg"
    >
      <div className="space-y-6 pb-4 text-sm leading-6 text-gray-700">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div>
            <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">{TAX_TEXTS.badge}</span>
            <p className="mt-2">{TAX_TEXTS.tooltip(year)}</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
            <span>Steuerjahr</span>
            <input
              type="number"
              min={2000}
              max={2200}
              value={yearInput}
              onChange={event => setYearInput(event.target.value)}
              className="form-input w-24"
            />
          </label>
        </div>

        {warning && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">{TAX_TEXTS.missingYearNotice(year, parameterYear, params.asOf)}</div>}

        <section>
          <h3 className="flex items-center gap-2 font-semibold text-gray-900"><Calculator className="h-4 w-4 text-primary-custom" /> Rechenkette</h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5">
            <li>Als Ausgangspunkt dienen erfasste und bezahlte EÜR-Zahlungen. Offene Rechnungen zählen nicht als Zahlung.</li>
            <li>Der Jahresgewinn wird aus dem bisherigen Ergebnis und einer Hochrechnung geschätzt. Erfasste betriebliche Fixkosten werden dabei berücksichtigt.</li>
            <li>Sozialbeiträge werden anhand der im Profil erfassten Angaben und der Parameter für das Steuerjahr geschätzt. Tatsächlich gezahlte Beiträge können als Vorsorgeaufwendungen das zu versteuernde Einkommen mindern.</li>
            <li>Auf dieser Grundlage werden Einkommensteuer, Solidaritätszuschlag und – soweit Angaben vorliegen – Kirchensteuer geschätzt. Bei Gewerbe können zusätzlich Gewerbesteuer und eine mögliche Anrechnung auf die Einkommensteuer berücksichtigt werden.</li>
            <li>Eine Umsatzsteuer-Rücklage wird nur grob aus erfassten Zahlungen und Steuersätzen abgeleitet.</li>
          </ol>
        </section>

        <section>
          <h3 className="font-semibold text-gray-900">Private Angaben und EÜR</h3>
          <p className="mt-2">Private Abgaben wie Kranken-, Pflege- und Rentenversicherungsbeiträge sowie Einkommensteuer- oder Gewerbesteuervorauszahlungen sind keine betrieblichen Fixkosten und werden nicht als EÜR-Ausgaben gebucht. Gewerbesteuer mindert den steuerlichen Gewinn nicht als Betriebsausgabe.</p>
        </section>

        <section>
          <h3 className="font-semibold text-gray-900">Verwendete Parameter</h3>
          <p className="mt-2">Parameterjahr {parameterYear}, Version {params.version}, Stand {params.asOf}. Für ein anderes Jahr ohne eigenen geprüften Parametersatz wird das verfügbare Vorjahr verwendet und darauf hingewiesen.</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            {params.sources.map(source => (
              <li key={source.id}>
                <a className="font-medium text-primary-custom underline" href={source.url} target="_blank" rel="noreferrer">{source.id}</a>
                <span> – {source.covers.join(', ')}. {source.status}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="flex items-center gap-2 font-semibold text-gray-900"><ShieldAlert className="h-4 w-4 text-amber-600" /> Grenzen und Hinweise</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            {params.limitations.map(limitation => <li key={limitation}>{limitation}</li>)}
            <li>{TAX_TEXTS.socialNotice}</li>
            <li>{TAX_TEXTS.educationNotice}</li>
            <li>{TAX_TEXTS.pensionNotice}</li>
            <li>{TAX_TEXTS.kskNotice}</li>
            <li>{TAX_TEXTS.vatRoughNotice}</li>
          </ul>
        </section>

        <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">{TAX_TEXTS.draftNotice} {TAX_TEXTS.termsDraft}</p>
      </div>
    </DialogShell>
  );
}
