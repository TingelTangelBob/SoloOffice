import { useState } from 'react';
import { Globe, Monitor, Moon, Palette, Sun, SunMoon } from 'lucide-react';
import type { DateFormat, NumberFormat, ThemeMode, TimeFormat } from '../../types';
import { ColorPicker } from '../ColorPicker';
import { useMotionPreference } from '../../context/MotionProvider';
import { getCurrencySymbol } from '../../utils/formatters';
import { terminologyProfiles } from '../../utils/terminology';
import { DEFAULT_TIME_ZONE, TIME_ZONE_OPTIONS } from '../../utils/timeZones';
import { SettingsCard, SettingsField, SettingsToggleRow } from './SettingsUi';
import { choiceCardClass, settingsInputClass } from './settingsStyles';
import type { CompanySettingsAreaProps } from './settingsAreaProps';

const colorPresets = [
  { name: 'Klassisch Blau', primary: '#2563eb', secondary: '#64748b' },
  { name: 'Waldgrün', primary: '#15803d', secondary: '#475569' },
  { name: 'Violett', primary: '#7c3aed', secondary: '#64748b' },
  { name: 'Koralle', primary: '#ea580c', secondary: '#475569' },
] as const;

const themeModes = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Hell', icon: Sun },
  { id: 'dark', label: 'Dunkel', icon: Moon },
] as const;

/** Bereich „Darstellung & Sprache“ (`#settings/appearance`). */
export function AppearanceArea({ formData, setFormData }: CompanySettingsAreaProps) {
  const { animationsEnabled, setAnimationsEnabled } = useMotionPreference();
  const [motionError, setMotionError] = useState(false);
  const currencySymbol = getCurrencySymbol(formData.locale || 'de-DE', formData.numberFormat, formData.currency);
  const terminologyColorSource = formData.terminologyColorSource || 'profile';
  const activeProfile = terminologyProfiles.find(profile => profile.id === (formData.terminologyProfile || 'customers'));
  const set = <K extends keyof typeof formData>(key: K, value: (typeof formData)[K]) => setFormData(previous => ({ ...previous, [key]: value }));

  const changeColorSource = (source: 'appearance' | 'profile') => {
    setFormData(previous => {
      const next = { ...previous, terminologyColorSource: source };
      if (source === 'profile') {
        const profile = terminologyProfiles.find(item => item.id === (previous.terminologyProfile || 'customers')) || terminologyProfiles[0];
        if (profile.preview) {
          next.primaryColor = profile.preview.accent;
          next.secondaryColor = profile.preview.secondary;
        }
      }
      return next;
    });
  };

  return (
    <>
      <SettingsCard sectionId="sprache" icon={Globe} title="Sprache & Formate">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SettingsField id="locale" label="Sprache">
            <select id="locale" value={formData.locale || 'de-DE'} onChange={event => set('locale', event.target.value as 'de-DE' | 'en-US' | 'fr-FR' | 'es-ES')} className={settingsInputClass}>
              <option value="de-DE">Deutsch (Deutschland) - 1.234,56 {currencySymbol}</option>
              <option value="en-US">English (United States) - $1,234.56</option>
              <option value="fr-FR">Français (France) - 1 234,56 {currencySymbol}</option>
              <option value="es-ES">Español (España) - 1.234,56 {currencySymbol}</option>
            </select>
          </SettingsField>
          <SettingsField id="number-format" label="Zahlenformat">
            <select id="number-format" value={formData.numberFormat || 'european'} onChange={event => set('numberFormat', event.target.value as NumberFormat)} className={settingsInputClass}>
              <option value="european">Europäisch – 1.234,56</option>
              <option value="american">Amerikanisch – 1,234.56</option>
            </select>
          </SettingsField>
          <SettingsField id="currency" label="Währung" info="Die Währung wird in Beträgen, PDFs und eRechnungen verwendet.">
            <select id="currency" value={formData.currency || 'EUR'} onChange={event => set('currency', event.target.value)} className={settingsInputClass}>
              <option value="EUR">Euro (EUR)</option>
              <option value="USD">US-Dollar (USD)</option>
              <option value="CHF">Schweizer Franken (CHF)</option>
              <option value="GBP">Pfund Sterling (GBP)</option>
            </select>
          </SettingsField>
          <SettingsField id="date-format" label="Datumsformat">
            <select id="date-format" value={formData.dateFormat || 'DD.MM.YYYY'} onChange={event => set('dateFormat', event.target.value as DateFormat)} className={settingsInputClass}>
              <option value="DD.MM.YYYY">31.12.2025</option>
              <option value="DD/MM/YYYY">31/12/2025</option>
              <option value="MM/DD/YYYY">12/31/2025</option>
              <option value="YYYY-MM-DD">2025-12-31</option>
            </select>
          </SettingsField>
          <SettingsField id="time-format" label="Zeitformat">
            <select id="time-format" value={formData.timeFormat || '24h'} onChange={event => set('timeFormat', event.target.value as TimeFormat)} className={settingsInputClass}>
              <option value="24h">24-Stunden-Format</option>
              <option value="12h">12-Stunden-Format</option>
            </select>
          </SettingsField>
          <SettingsField id="time-zone" label="Workspace-Zeitzone" info="Die Workspace-Zeitzone wird standardmäßig für neue Kurse und Termine verwendet.">
            <select id="time-zone" value={formData.timeZone || DEFAULT_TIME_ZONE} onChange={event => set('timeZone', event.target.value)} className={settingsInputClass}>
              {TIME_ZONE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </SettingsField>
        </div>
      </SettingsCard>

      <SettingsCard sectionId="erscheinungsbild" icon={SunMoon} title="Erscheinungsbild" info="Der Farbmodus betrifft die App-Oberfläche. Dokumente und E-Mails behalten ihre eigene Darstellung.">
        <div role="radiogroup" aria-label="Farbmodus" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {themeModes.map(mode => (
            <button
              key={mode.id}
              type="button"
              role="radio"
              aria-checked={formData.themeMode === mode.id}
              onClick={() => set('themeMode', mode.id as ThemeMode)}
              className={choiceCardClass(formData.themeMode === mode.id)}
            >
              <mode.icon className="h-5 w-5 text-gray-700" aria-hidden="true" />
              <span className="mt-2 block text-sm font-medium text-gray-900">{mode.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-4">
          <SettingsToggleRow
            label="Animationen"
            description={motionError ? <span role="alert" className="text-red-700">Die Einstellung konnte nicht gespeichert werden.</span> : undefined}
            info="Gilt sofort für Ihr Benutzerkonto auf allen Geräten. „Bewegung reduzieren“ im Betriebssystem schaltet Animationen zusätzlich aus."
            checked={animationsEnabled}
            onChange={() => {
              setMotionError(false);
              void setAnimationsEnabled(!animationsEnabled).catch(() => setMotionError(true));
            }}
          />
        </div>
      </SettingsCard>

      <SettingsCard sectionId="farbschema" icon={Palette} title="Farbschema" info="Die Akzentfarben gelten für die App-Oberfläche. Dokumentfarben werden in den Vorlagen festgelegt.">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <ColorPicker label="Primärfarbe" value={formData.primaryColor || '#2563eb'} onChange={color => set('primaryColor', color)} defaultColor="#2563eb" />
          <ColorPicker label="Sekundärfarbe" value={formData.secondaryColor || '#64748b'} onChange={color => set('secondaryColor', color)} defaultColor="#64748b" />
        </div>

        <p className="mb-2 mt-6 text-sm font-medium text-gray-700">Vorlagen</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {colorPresets.map(preset => {
            const selected = formData.primaryColor === preset.primary && formData.secondaryColor === preset.secondary;
            return (
              <button
                key={preset.name}
                type="button"
                aria-pressed={selected}
                onClick={() => setFormData(previous => ({ ...previous, primaryColor: preset.primary, secondaryColor: preset.secondary }))}
                className={choiceCardClass(selected)}
              >
                <span className="mb-2 block text-xs font-medium text-gray-700">{preset.name}</span>
                <span className="flex gap-2" aria-hidden="true">
                  <span className="h-6 w-6 rounded-full" style={{ backgroundColor: preset.primary }} />
                  <span className="h-6 w-6 rounded-full" style={{ backgroundColor: preset.secondary }} />
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 p-4">
          <span className="text-sm font-medium text-gray-700">Vorschau</span>
          <span className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: formData.primaryColor || '#2563eb' }}>Primäre Aktion</span>
          <span className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: formData.secondaryColor || '#64748b' }}>Sekundäre Aktion</span>
        </div>

        <div className="mt-6 border-t border-gray-200 pt-4">
          <p className="flex items-center gap-1 text-sm font-medium text-gray-900">Farben der Fachsprache</p>
          <p className="mt-1 text-xs text-gray-500">Soll die gewählte Fachsprache eigene App-Farben verwenden oder das Farbschema oben übernehmen?</p>
          <div role="radiogroup" aria-label="Farben der Fachsprache" className="mt-3 grid items-stretch gap-3 min-[480px]:grid-cols-2">
            <button type="button" role="radio" aria-checked={terminologyColorSource === 'appearance'} onClick={() => changeColorSource('appearance')} className={choiceCardClass(terminologyColorSource === 'appearance')}>
              <span className="block text-sm font-semibold text-gray-900">Aus Farbschema übernehmen</span>
              <span className="mt-1 block text-xs text-gray-500">Fachbegriffe verwenden die oben gewählte Primär- und Sekundärfarbe.</span>
            </button>
            <button type="button" role="radio" aria-checked={terminologyColorSource === 'profile'} onClick={() => changeColorSource('profile')} className={choiceCardClass(terminologyColorSource === 'profile')}>
              <span className="block text-sm font-semibold text-gray-900">Profilfarben verwenden</span>
              <span className="mt-1 block text-xs text-gray-500">Die Auswahl übernimmt die passende Akzent- und Sekundärfarbe.</span>
              <span className="mt-2 flex h-5 items-center gap-2" aria-hidden="true">
                <span className="h-4 w-4 rounded-full" style={{ backgroundColor: activeProfile?.preview?.accent }} />
                <span className="h-4 w-4 rounded-full" style={{ backgroundColor: activeProfile?.preview?.secondary }} />
              </span>
            </button>
          </div>
        </div>
      </SettingsCard>
    </>
  );
}
