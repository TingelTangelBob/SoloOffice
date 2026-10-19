import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Save } from 'lucide-react';
import { InfoTooltip } from '../InfoTooltip';
import { ToggleSwitch } from '../ToggleSwitch';
import { settingsSectionElementId } from '../../utils/settingsNavigation';

interface SettingsCardProps {
  /** Abschnitts-ID aus `settingsNavigation`; Ziel für Suche und Deep-Links. */
  sectionId?: string;
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Längere Erklärung, erscheint als Info-Kurzhilfe neben dem Titel. */
  info?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

/** Ein Abschnitt der Einstellungen als eigenständige Karte. */
export function SettingsCard({ sectionId, icon: Icon, title, description, info, actions, children }: SettingsCardProps) {
  const titleId = sectionId ? `${settingsSectionElementId(sectionId)}-title` : undefined;
  return (
    <section
      id={sectionId ? settingsSectionElementId(sectionId) : undefined}
      aria-labelledby={titleId}
      className="settings-card"
    >
      <header className="settings-card-header">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className="settings-card-icon" aria-hidden="true">
              <Icon className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <h3 id={titleId} className="text-base font-semibold text-gray-900">{title}</h3>
              {info && <InfoTooltip text={info} label={`Hinweis zu ${title}`} />}
            </div>
            {description && <p className="mt-0.5 text-sm text-gray-600">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </header>
      {children && <div className="settings-card-body">{children}</div>}
    </section>
  );
}

interface SettingsFieldProps {
  id: string;
  label: ReactNode;
  required?: boolean;
  info?: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}

/** Feld mit Beschriftung, optionaler Kurzhilfe und Hinweis- oder Fehlertext. */
export function SettingsField({ id, label, required, info, hint, error, className = '', children }: SettingsFieldProps) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-1 flex min-h-6 items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium text-gray-700">
          {label}{required && <span aria-hidden="true"> *</span>}
        </label>
        {info && <InfoTooltip text={info} label={typeof label === 'string' ? `Hinweis zu ${label}` : undefined} />}
      </div>
      {children}
      {error
        ? <p id={`${id}-message`} className="mt-1 text-xs text-red-600">{error}</p>
        : hint && <p id={`${id}-message`} className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

interface SettingsToggleRowProps {
  label: string;
  description?: ReactNode;
  info?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** Zeile mit Beschreibung links und Schalter rechts. */
export function SettingsToggleRow({ label, description, info, checked, onChange, disabled }: SettingsToggleRowProps) {
  return (
    <div className="settings-row">
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <p className="text-sm font-medium text-gray-900">{label}</p>
          {info && <InfoTooltip text={info} label={`Hinweis zu ${label}`} />}
        </div>
        {description && <p className="mt-0.5 text-xs leading-5 text-gray-600">{description}</p>}
      </div>
      <fieldset disabled={disabled} className="shrink-0 disabled:opacity-60">
        <ToggleSwitch
          checked={checked}
          label={label}
          showLabel={false}
          onChange={() => onChange(!checked)}
          className="h-7 w-12 min-h-0 justify-start rounded-full border-0 bg-transparent p-0 hover:border-0 hover:bg-transparent"
        />
      </fieldset>
    </div>
  );
}

export interface SettingsSaveMessage {
  type: 'success' | 'error';
  text: string;
}

interface SettingsSaveBarProps {
  dirty: boolean;
  saving: boolean;
  /** Ersetzt „Ungespeicherte Änderungen“, etwa wenn nur eine Bestätigung fehlt. */
  statusText?: string;
  /** Wo die Änderungen liegen, z. B. „Firmendaten, Darstellung“. */
  dirtyLabel?: string;
  message?: SettingsSaveMessage | null;
  saveLabel?: string;
  saveDisabled?: boolean;
  onDiscard?: () => void;
  /** Ohne `onSave` sendet die Schaltfläche das umgebende Formular ab. */
  onSave?: () => void;
}

/**
 * Gemeinsame Speicherleiste aller Einstellungsbereiche. Sie erscheint nur,
 * wenn es etwas zu speichern oder zu melden gibt, und bleibt am unteren Rand
 * sichtbar.
 */
export function SettingsSaveBar({
  dirty,
  saving,
  statusText = 'Ungespeicherte Änderungen',
  dirtyLabel,
  message,
  saveLabel = 'Speichern',
  saveDisabled = false,
  onDiscard,
  onSave,
}: SettingsSaveBarProps) {
  if (!dirty && !saving && !message) return null;
  return (
    <div className="settings-save-bar" role="region" aria-label="Änderungen speichern" data-dirty={dirty ? 'true' : 'false'}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm sm:flex-row sm:items-center sm:gap-2" aria-live="polite">
        {dirty && (
          <span className="flex min-w-0 items-center gap-2">
            <span className="settings-dirty-dot" aria-hidden="true" />
            <span className="font-medium text-gray-900">{statusText}</span>
          </span>
        )}
        {dirty && dirtyLabel && <span className="min-w-0 truncate text-xs text-gray-600 sm:text-sm">in {dirtyLabel}</span>}
        {message && (
          <span role={message.type === 'error' ? 'alert' : 'status'} className={message.type === 'success' ? 'text-green-700' : 'text-red-700'}>
            {message.text}
          </span>
        )}
      </div>
      {dirty && (
        <div className="flex shrink-0 items-center gap-2">
          {onDiscard && (
            <button type="button" onClick={onDiscard} disabled={saving} className="btn-secondary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
              Verwerfen
            </button>
          )}
          <button
            type={onSave ? 'button' : 'submit'}
            onClick={onSave}
            disabled={saving || saveDisabled}
            className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{saving ? 'Speichert …' : saveLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
}
