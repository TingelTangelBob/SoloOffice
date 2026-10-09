/** Erweiterungen und bisherige Module an einem zentralen Katalog. */
export const EXTENSION_CATALOG = Object.freeze([
  Object.freeze({ id: 'jobTracking', name: 'Aufträge', label: 'Aufträge', description: 'Aufträge und Zeiterfassung verwalten.', legacyCompanyField: 'job_tracking_enabled', requiredPlan: 'free' }),
  Object.freeze({ id: 'quotes', name: 'Angebote', label: 'Angebote', description: 'Angebote erstellen und verwalten.', legacyCompanyField: 'quotes_enabled', requiredPlan: 'free' }),
  Object.freeze({ id: 'reporting', name: 'Auswertungen', label: 'Auswertungen', description: 'Unternehmensauswertungen anzeigen.', legacyCompanyField: 'reporting_enabled', requiredPlan: 'free' }),
  Object.freeze({ id: 'taxes', name: 'Steuern & Abgaben', label: 'Steuern & Abgaben', description: 'Steuerprofil, private Abgaben und Prognosen verwalten.', requiredPlan: 'free' }),
]);

const catalogById = new Map(EXTENSION_CATALOG.map(definition => [definition.id, definition]));

export function getExtensionDefinition(id) {
  return catalogById.get(id) || null;
}

/** Reine Tarifprüfung; der Tarif muss aus vertrauenswürdigem Serverkontext stammen. */
export function canUseExtension(definition, enabled, plan = 'free') {
  if (!definition || enabled !== true) return false;
  return definition.requiredPlan === 'free' || (definition.requiredPlan === 'pro' && plan === 'pro');
}

export function workspaceExtension(definition, state = {}) {
  return {
    id: definition.id,
    name: definition.name,
    label: definition.name,
    requiredPlan: definition.requiredPlan,
    legacyCompanyField: definition.legacyCompanyField,
    available: canUseExtension(definition, true, state.plan || 'free'),
    description: definition.description,
    enabled: state.enabled === true,
    acceptedAt: state.accepted_at ?? state.acceptedAt ?? null,
    updatedAt: state.updated_at ?? state.updatedAt ?? null,
  };
}
