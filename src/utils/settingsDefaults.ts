import type { Company } from '../types';

/**
 * Felder, die „Standardwerte wiederherstellen“ zurücksetzt: Darstellung,
 * Formate, Module und Begriffe. Firmendaten, Bankverbindung, Logo,
 * Zahlungsbedingungen und Nummernkreise gehören nicht dazu.
 */
export const SETTINGS_PREFERENCE_KEYS = [
  'locale',
  'numberFormat',
  'currency',
  'dateFormat',
  'timeFormat',
  'timeZone',
  'themeMode',
  'primaryColor',
  'secondaryColor',
  'terminologyProfile',
  'terminologyColorSource',
  'receiptLabel',
  'jobTrackingEnabled',
  'reportingEnabled',
  'quotesEnabled',
  'discountsEnabled',
] as const satisfies readonly (keyof Company)[];

export type SettingsPreferenceKey = (typeof SETTINGS_PREFERENCE_KEYS)[number];

/** Setzt nur die Präferenzfelder auf die Standardwerte. Alle übrigen Felder bleiben unverändert. */
export function resetSettingsPreferences(current: Company, defaults: Company): Company {
  const preferences = Object.fromEntries(
    SETTINGS_PREFERENCE_KEYS.map(key => [key, defaults[key]]),
  ) as Pick<Company, SettingsPreferenceKey>;
  return { ...current, ...preferences };
}
