import { useState } from 'react';
import { Calculator, ShieldCheck } from 'lucide-react';
import { DialogShell } from './DialogShell';
import { TAX_TEXTS } from '../../backend/shared/taxTexts.js';

interface TaxConsentDialogProps {
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/** Profilhinweis; das Datum der Einwilligung wird ausschließlich serverseitig gesetzt. */
export function TaxProfileDisclaimerDialog({ onClose, onConfirm }: TaxConsentDialogProps) {
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!accepted || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Die Bestätigung konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      title={TAX_TEXTS.activationTitle}
      description={TAX_TEXTS.badge}
      icon={Calculator}
      titleId="tax-profile-disclaimer-title"
      onClose={onClose}
      size="md"
      fitContent
      footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="btn-secondary rounded-lg px-4 py-2 text-sm">Abbrechen</button><button type="button" disabled={!accepted || saving} onClick={() => void confirm()} className="btn-primary rounded-lg px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Wird gespeichert …' : 'Bestätigen'}</button></div>}
    >
      <div className="space-y-4 text-sm leading-6 text-gray-700">
        <p>{TAX_TEXTS.activationBody}</p>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3">
          <input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} className="mt-1 h-4 w-4 accent-primary-custom" />
          <span>{TAX_TEXTS.activationCheckbox}</span>
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>
    </DialogShell>
  );
}

interface ChurchConsentDialogProps extends Omit<TaxConsentDialogProps, 'onConfirm'> {
  onConfirm: (liable: boolean) => Promise<void>;
  editing?: boolean;
}

/** Separate, widerrufbare Einwilligung ohne Erfassung der Konfession. */
export function ChurchConsentDialog({ onClose, onConfirm, editing = false }: ChurchConsentDialogProps) {
  const [liable, setLiable] = useState<boolean | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!accepted || liable === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm(liable);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Die Einwilligung konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      title={editing ? 'Kirchensteuerangabe ändern' : TAX_TEXTS.churchTitle}
      description={TAX_TEXTS.badge}
      icon={ShieldCheck}
      titleId="tax-church-consent-title"
      onClose={onClose}
      size="md"
      fitContent
      footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="btn-secondary rounded-lg px-4 py-2 text-sm">Abbrechen</button><button type="button" disabled={!accepted || liable === null || saving} onClick={() => void confirm()} className="btn-primary rounded-lg px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Wird gespeichert …' : editing ? 'Einwilligung erneuern' : 'Einwilligen & speichern'}</button></div>}
    >
      <div className="space-y-4 text-sm leading-6 text-gray-700">
        <p>{TAX_TEXTS.churchBody}</p>
        <fieldset className="space-y-2">
          <legend className="font-medium text-gray-800">Bist du kirchensteuerpflichtig?</legend>
          <label className="flex items-center gap-2"><input type="radio" name="church-tax-liable" checked={liable === true} onChange={() => setLiable(true)} /> Ja</label>
          <label className="flex items-center gap-2"><input type="radio" name="church-tax-liable" checked={liable === false} onChange={() => setLiable(false)} /> Nein</label>
        </fieldset>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3">
          <input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} className="mt-1 h-4 w-4 accent-primary-custom" />
          <span>{TAX_TEXTS.churchCheckbox}</span>
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>
    </DialogShell>
  );
}
