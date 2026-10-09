/** Zentrale Maximalbreiten für den Seiteninhalt. */
export const contentWidth = {
  compact: 'max-w-[1140px]',
  wide: 'max-w-[1440px]',
} as const;

/** Verwaltungs- und Kontoseiten bleiben kompakt; Datenlisten erhalten mehr Platz. */
const compactPages = new Set(['settings', 'profile', 'workspace', 'support']);

/** Dashboard und Kalender nutzen die komplette verfügbare Breite. */
const fullWidthPages = new Set(['dashboard', 'calendar']);

export function contentWidthClassForPage(page: string): string {
  if (fullWidthPages.has(page)) return 'max-w-none';
  return compactPages.has(page) ? contentWidth.compact : contentWidth.wide;
}
