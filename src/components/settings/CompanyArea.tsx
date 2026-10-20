import type { ChangeEvent } from 'react';
import { Building2, ImageIcon, Mail, Receipt, Upload, X } from 'lucide-react';
import type { LegalForm, TaxBusinessType } from '../../types';
import { updateFavicon } from '../../utils/faviconUtils';
import { SettingsCard, SettingsField, SettingsToggleRow } from './SettingsUi';
import { settingsInputClass } from './settingsStyles';
import type { CompanySettingsAreaProps } from './settingsAreaProps';
import { validateCompanyFormats } from '../../../backend/shared/companyValidation.js';

function readImage(event: ChangeEvent<HTMLInputElement>, onLoad: (dataUrl: string) => void) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = loadEvent => onLoad(loadEvent.target?.result as string);
  reader.readAsDataURL(file);
}

function ImageUpload({ id, title, image, alt, emptyText, buttonLabel, hint, previewClassName, onUpload, onRemove }: {
  id: string;
  title: string;
  image?: string | null;
  alt: string;
  emptyText: string;
  buttonLabel: string;
  hint: string;
  previewClassName: string;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="text-sm font-medium text-gray-900">{title}</p>
      {image ? (
        <div className="relative inline-flex self-start">
          <img src={image} alt={alt} className={`rounded-lg border border-gray-200 bg-white object-contain ${previewClassName}`} />
          <button
            type="button"
            onClick={onRemove}
            aria-label={`${title} entfernen`}
            className="absolute -right-2 -top-2 inline-flex h-6 w-6 min-h-0 min-w-0 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border-2 border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600">
          <Upload className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
          {emptyText}
        </div>
      )}
      <div>
        <input type="file" accept="image/*" onChange={onUpload} className="hidden" id={id} />
        <label htmlFor={id} className="btn-secondary inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium">
          <Upload className="h-4 w-4" aria-hidden="true" />
          {buttonLabel}
        </label>
        <p className="mt-1 text-xs text-gray-500">{hint}</p>
      </div>
    </div>
  );
}

/** Bereich „Firmendaten“ (`#settings/general`). */
export function CompanyArea({ formData, setFormData, terminology }: CompanySettingsAreaProps) {
  const set = <K extends keyof typeof formData>(key: K, value: (typeof formData)[K]) => setFormData(previous => ({ ...previous, [key]: value }));
  const formatErrors = validateCompanyFormats(formData);

  return (
    <>
      <SettingsCard sectionId="stammdaten" icon={Building2} title="Stammdaten" info={`${terminology.organization.nameLabel} und Anschrift erscheinen auf Rechnungen, Angeboten und E-Mails.`}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SettingsField id="company-name" label={terminology.organization.nameLabel} required className="md:col-span-2">
            <input id="company-name" type="text" required name="organization" autoComplete="section-company organization" value={formData.name} onChange={event => set('name', event.target.value)} className={settingsInputClass} />
          </SettingsField>
          <SettingsField id="company-address" label="Adresse" required className="md:col-span-2">
            <input id="company-address" type="text" required name="street-address" autoComplete="section-company street-address" value={formData.address} onChange={event => set('address', event.target.value)} className={settingsInputClass} />
          </SettingsField>
          <SettingsField id="company-postal-code" label="Postleitzahl" required error={formatErrors.postalCode}>
            <input id="company-postal-code" type="text" required name="postal-code" autoComplete="section-company postal-code" aria-invalid={Boolean(formatErrors.postalCode)} aria-describedby={formatErrors.postalCode ? 'company-postal-code-message' : undefined} value={formData.postalCode} onChange={event => set('postalCode', event.target.value)} className={settingsInputClass} />
          </SettingsField>
          <SettingsField id="company-city" label="Stadt" required>
            <input id="company-city" type="text" required name="address-level2" autoComplete="section-company address-level2" value={formData.city} onChange={event => set('city', event.target.value)} className={settingsInputClass} />
          </SettingsField>
          <SettingsField id="company-country" label="Land" required>
            <input id="company-country" type="text" required name="country-name" autoComplete="section-company country-name" value={formData.country} onChange={event => set('country', event.target.value)} className={settingsInputClass} />
          </SettingsField>
        </div>
      </SettingsCard>

      <SettingsCard
        sectionId="steuerangaben"
        icon={Receipt}
        title="Steuerliche Angaben"
        info="Betriebsart und Rechtsform werden in Prüfhinweisen und Exporten verwendet. Sie blenden keine Kernmenüpunkte aus."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SettingsField id="company-tax-id" label="USt-IdNr." error={formatErrors.taxId}>
            <input id="company-tax-id" type="text" name="tax-id" autoComplete="off" aria-invalid={Boolean(formatErrors.taxId)} aria-describedby={formatErrors.taxId ? 'company-tax-id-message' : undefined} value={formData.taxId} onChange={event => set('taxId', event.target.value)} className={settingsInputClass} placeholder="z.B. DE123456789" />
          </SettingsField>
          <SettingsField id="company-tax-number" label="Steuernummer">
            <input id="company-tax-number" type="text" name="tax-identification-number" autoComplete="off" value={formData.taxIdentificationNumber || ''} onChange={event => set('taxIdentificationNumber', event.target.value)} className={settingsInputClass} placeholder="z.B. 123/456/78910" />
          </SettingsField>
          <SettingsField id="company-business-type" label="Betriebsart" required>
            <select id="company-business-type" required value={formData.taxBusinessType || ''} onChange={event => set('taxBusinessType', event.target.value ? event.target.value as TaxBusinessType : undefined)} className={`${settingsInputClass} bg-white text-gray-800`}>
              <option value="" disabled>Bitte wählen …</option>
              <option value="freelance">Freiberuflich</option>
              <option value="commercial">Gewerblich</option>
              <option value="agriculture">Land- und Forstwirtschaft</option>
              <option value="nonprofit">Gemeinnützig</option>
              <option value="other">Sonstige</option>
            </select>
          </SettingsField>
          <SettingsField id="company-legal-form" label="Rechtsform" required>
            <select id="company-legal-form" required value={formData.legalForm || ''} onChange={event => set('legalForm', event.target.value ? event.target.value as LegalForm : undefined)} className={`${settingsInputClass} bg-white text-gray-800`}>
              <option value="" disabled>Bitte wählen …</option>
              <option value="sole_proprietorship">Einzelunternehmen</option>
              <option value="partnership">Personengesellschaft</option>
              <option value="gbr">GbR</option>
              <option value="ug">UG (haftungsbeschränkt)</option>
              <option value="gmbh">GmbH</option>
              <option value="ag">AG</option>
              <option value="eg">eG</option>
              <option value="nonprofit">Verein / gemeinnützige Organisation</option>
              <option value="other">Sonstige</option>
            </select>
          </SettingsField>
        </div>
        <div className="mt-4">
          <SettingsToggleRow
            label="Kleinunternehmerregelung (§ 19 UStG)"
            info="Deaktiviert alle MwSt.-Berechnungen und zeigt die entsprechende Klausel auf Rechnungen an."
            checked={formData.isSmallBusiness || false}
            onChange={checked => set('isSmallBusiness', checked)}
          />
        </div>
      </SettingsCard>

      <SettingsCard sectionId="kontakt" icon={Mail} title="Kontaktdaten">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SettingsField id="company-email" label="E-Mail" required error={formatErrors.email}>
            <input id="company-email" type="email" required name="email" autoComplete="section-company email" aria-invalid={Boolean(formatErrors.email)} aria-describedby={formatErrors.email ? 'company-email-message' : undefined} value={formData.email} onChange={event => set('email', event.target.value)} className={settingsInputClass} />
          </SettingsField>
          <SettingsField id="company-phone" label="Telefon" required>
            <input id="company-phone" type="tel" required name="tel" autoComplete="section-company tel" value={formData.phone} onChange={event => set('phone', event.target.value)} className={settingsInputClass} />
          </SettingsField>
          <SettingsField id="company-website" label="Website">
            <input id="company-website" type="url" name="url" autoComplete="section-company url" value={formData.website || ''} onChange={event => set('website', event.target.value)} className={settingsInputClass} />
          </SettingsField>
        </div>
      </SettingsCard>

      <SettingsCard
        sectionId="logo"
        icon={ImageIcon}
        title="Logo & Icon"
        info="Das Logo erscheint auf Dokumenten, das Icon im Browser-Tab."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ImageUpload
            id="logo-upload"
            title={terminology.organization.logoLabel}
            image={formData.logo}
            alt="Firmenlogo"
            emptyText="Kein Logo hochgeladen"
            buttonLabel="Logo hochladen"
            hint="JPG, PNG oder GIF, maximal 2 MB."
            previewClassName="h-20 lg:h-24"
            onUpload={event => readImage(event, logo => set('logo', logo))}
            onRemove={() => set('logo', null)}
          />
          <ImageUpload
            id="icon-upload"
            title={terminology.organization.iconLabel}
            image={formData.icon}
            alt="Firmen-Icon"
            emptyText="Kein Icon hochgeladen"
            buttonLabel="Icon hochladen"
            hint="JPG, PNG oder GIF, empfohlen 64×64 oder 128×128 px, maximal 1 MB."
            previewClassName="h-16 w-16 lg:h-20 lg:w-20"
            onUpload={event => readImage(event, icon => {
              set('icon', icon);
              // Sofortige Rückmeldung im Browser-Tab.
              updateFavicon(icon);
            })}
            onRemove={() => {
              set('icon', null);
              updateFavicon(null);
            }}
          />
        </div>
      </SettingsCard>
    </>
  );
}
