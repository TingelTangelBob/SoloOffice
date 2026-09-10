import { useEffect } from 'react';
import { useCompany } from '../context/CompanyContext';
import { terminologyProfiles } from '../utils/terminology';

export function DynamicColors() {
  const { company } = useCompany();
  
  // Default colors if not set
  const terminologyProfile = terminologyProfiles.find(profile => profile.id === company.terminologyProfile) || terminologyProfiles[0];
  const useTerminologyColors = company.terminologyColorSource === 'profile';
  const primaryColor = useTerminologyColors
    ? terminologyProfile.preview.accent
    : company.primaryColor || '#2563eb';
  const secondaryColor = useTerminologyColors
    ? terminologyProfile.preview.secondary
    : company.secondaryColor || '#64748b';

  // Function to calculate luminance of a color
  const getLuminance = (color: string) => {
    // Remove the hash symbol if present
    const hex = color.replace('#', '');
    
    // Parse r, g, b values
    const r = parseInt(hex.substr(0, 2), 16) / 255;
    const g = parseInt(hex.substr(2, 2), 16) / 255;
    const b = parseInt(hex.substr(4, 2), 16) / 255;
    
    // Apply gamma correction
    const rLinear = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    const gLinear = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    const bLinear = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
    
    // Calculate relative luminance
    return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
  };

  /**
   * Kontrastverhältnis nach WCAG zwischen zwei Farben.
   */
  const contrastRatio = (foreground: string, background: string) => {
    const a = getLuminance(foreground);
    const b = getLuminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };

  // Choose the higher-contrast text color instead of relying on a luminance
  // cutoff. The cutoff selected white for mid-tone accent colors below 4.5:1.
  const getTextColor = (backgroundColor: string) => (
    contrastRatio('#000000', backgroundColor) >= contrastRatio('#ffffff', backgroundColor)
      ? '#000000'
      : '#ffffff'
  );

  // Calculate optimal text colors
  const primaryTextColor = getTextColor(primaryColor);
  const secondaryTextColor = getTextColor(secondaryColor);

  // Function to create lighter variants for backgrounds
  const lightenColor = (color: string, percent: number) => {
    // Remove the hash symbol if present
    const hex = color.replace('#', '');
    
    // Parse r, g, b values
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // Calculate lighter values
    const newR = Math.min(255, Math.floor(r + (255 - r) * (percent / 100)));
    const newG = Math.min(255, Math.floor(g + (255 - g) * (percent / 100)));
    const newB = Math.min(255, Math.floor(b + (255 - b) * (percent / 100)));
    
    return `rgb(${newR}, ${newG}, ${newB})`;
  };

  const primaryLight = lightenColor(primaryColor, 90);
  const primaryMedium = lightenColor(primaryColor, 80);
  const secondaryLight = lightenColor(secondaryColor, 90);

  /**
   * Akzentfarbe so weit aufhellen bzw. abdunkeln, bis sie auf der jeweiligen
   * Fläche lesbar ist (WCAG AA, 4,5:1 für Fließtext).
   *
   * Hintergrund: Die Akzentfarbe ist frei einstellbar und wurde bisher in
   * beiden Themes unverändert als Textfarbe verwendet. Im Dunkelmodus ergab
   * der Standardwert #2563eb auf den dunklen Flächen nur 2,84:1 – für Links
   * und den aktiven Navigationseintrag deutlich zu wenig. Statt einzelne
   * Regeln nachzubessern, wird der Wert hier einmal zentral tauglich gemacht.
   */
  const accessibleOn = (color: string, background: string, target = 4.5) => {
    const toHex = (value: number) => Math.round(value).toString(16).padStart(2, '0');
    const hex = color.replace('#', '');
    const channels = [0, 2, 4].map(offset => parseInt(hex.substr(offset, 2), 16));
    if (channels.some(Number.isNaN)) return color;

    const backgroundIsDark = getLuminance(background) < 0.5;
    let candidate = color;
    // In 5-%-Schritten annähern; 20 Schritte reichen bis Weiß bzw. Schwarz.
    for (let step = 0; step <= 20; step++) {
      const mixed = channels.map(value => (backgroundIsDark
        ? value + (255 - value) * (step * 0.05)
        : value * (1 - step * 0.05)));
      candidate = `#${mixed.map(toHex).join('')}`;
      if (contrastRatio(candidate, background) >= target) return candidate;
    }
    return candidate;
  };

  // Flächen, auf denen die Akzentfarbe als Text erscheint: helle Karten (weiß)
  // und dunkle Karten. Maßgeblich ist im Dunkelmodus nicht die Karte selbst
  // (#141416), sondern die hellste Fläche, auf der Akzenttext vorkommt: die
  // Markierung des ausgewählten Tages im Kalender (#232326). Gegen alle
  // dunkleren Flächen bleibt der Wert dadurch besser als gefordert.
  /**
   * Tönung der Akzentfarbe als echter rgba-Wert.
   *
   * Bewusst hier statt als `color-mix` im Stylesheet: Die Auswertung von
   * `color-mix` innerhalb einer Custom Property lieferte im Browser eine
   * vollständig transparente Farbe, obwohl alle Bestandteile korrekt
   * aufgelöst waren. Die Datei rechnet Farben ohnehin an dieser Stelle aus.
   */
  const tintOf = (color: string, alpha: number) => {
    const hex = color.replace('#', '');
    const channels = [0, 2, 4].map(offset => parseInt(hex.substr(offset, 2), 16));
    if (channels.some(Number.isNaN)) return color;
    return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
  };

  const primaryOnLightSurface = accessibleOn(primaryColor, '#ffffff');
  const primaryOnDarkSurface = accessibleOn(primaryColor, '#232326');

  useEffect(() => {
    const appShell = document.getElementById('app-shell');
    if (!appShell) return undefined;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const resolvedTheme = company.themeMode === 'dark'
        || (company.themeMode !== 'light' && mediaQuery.matches)
        ? 'dark'
        : 'light';
      appShell.dataset.theme = resolvedTheme;
      appShell.style.colorScheme = resolvedTheme;
      // Muss beim Themenwechsel mitgeführt werden – deshalb hier und nicht
      // einmalig weiter unten.
      appShell.style.setProperty(
        '--primary-on-surface',
        resolvedTheme === 'dark' ? primaryOnDarkSurface : primaryOnLightSurface,
      );
      // Auswahlzustände: getönte Fläche plus Akzentrahmen, nach dem Muster der
      // Fachsprachen-Einstellung. Auf dunklen Flächen braucht die Tönung mehr
      // Deckung, um überhaupt sichtbar zu werden.
      appShell.style.setProperty('--accent-tint', tintOf(primaryColor, resolvedTheme === 'dark' ? 0.26 : 0.12));
      appShell.style.setProperty('--accent-edge', tintOf(primaryColor, resolvedTheme === 'dark' ? 0.55 : 0.42));
    };

    appShell.style.setProperty('--primary-color', primaryColor);
    appShell.style.setProperty('--primary-light', primaryLight);
    appShell.style.setProperty('--primary-medium', primaryMedium);
    appShell.style.setProperty('--primary-text-color', primaryTextColor);
    appShell.style.setProperty('--secondary-color', secondaryColor);
    appShell.style.setProperty('--secondary-light', secondaryLight);
    appShell.style.setProperty('--secondary-text-color', secondaryTextColor);
    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);

    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
    };
  }, [company.themeMode, primaryColor, primaryLight, primaryMedium, primaryTextColor, primaryOnDarkSurface, primaryOnLightSurface, secondaryColor, secondaryLight, secondaryTextColor]);

  return (
    <style>
      {`
        /* Button styles */
        /* Primäraktionen tragen Tinte statt der Akzentfarbe: fast schwarz im
           Hellmodus, fast weiß im Dunkelmodus. Die Akzentfarbe bleibt für
           Links, Fokus, aktive Navigation und Diagramme reserviert. */
        #app-shell .btn-primary {
          background-color: var(--ink-solid) !important;
          border-color: var(--ink-solid) !important;
          color: var(--ink-solid-text) !important;
        }
        #app-shell .btn-primary:hover {
          background-color: var(--ink-solid) !important;
          filter: brightness(1.35) !important;
          border-color: var(--ink-solid) !important;
          color: var(--ink-solid-text) !important;
        }
        #app-shell[data-theme="dark"] .btn-primary:hover {
          filter: brightness(0.88) !important;
        }
        
        #app-shell .btn-secondary {
          background-color: var(--secondary-color) !important;
          border-color: var(--secondary-color) !important;
          color: var(--secondary-text-color) !important;
        }
        #app-shell .btn-secondary:hover {
          background-color: var(--secondary-color) !important;
          filter: brightness(0.9) !important;
          border-color: var(--secondary-color) !important;
          color: var(--secondary-text-color) !important;
        }

        #app-shell[data-theme="dark"] .theme-switch-option:not(.theme-switch-active):hover {
          background-color: #232326 !important;
          border-color: #3f3f46 !important;
          color: #ffffff !important;
        }
        #app-shell .theme-control-button:hover {
          background-color: var(--primary-light) !important;
          border-color: var(--primary-color) !important;
          color: var(--primary-color) !important;
        }
        #app-shell[data-theme="dark"] .theme-control-button:hover {
          background-color: #202024 !important;
        }
        #app-shell .theme-series-panel {
          border-color: rgba(148, 163, 184, 0.42) !important;
        }
        #app-shell[data-theme="dark"] .theme-series-panel {
          border-color: #232326 !important;
        }
        #app-shell[data-theme="dark"] .theme-option-button--primary:hover {
          background-color: #202024 !important;
          border-color: var(--primary-color) !important;
        }
        #app-shell[data-theme="dark"] .theme-option-button--neutral:hover {
          background-color: #232326 !important;
          border-color: #3f3f46 !important;
        }
        
        /* Focus styles */
        #app-shell .focus-primary:focus {
          box-shadow: 0 0 0 2px var(--primary-light), 0 0 0 4px var(--primary-color) !important;
          border-color: var(--primary-color) !important;
        }
        
        /* Text colors */
        #app-shell .text-primary-custom {
          color: var(--primary-on-surface, var(--primary-color)) !important;
        }
        #app-shell .bg-primary-custom .text-primary-custom,
        #app-shell .btn-primary .text-primary-custom,
        #app-shell .action-menu-trigger-primary .text-primary-custom,
        #app-shell .theme-tab-active .text-primary-custom {
          color: var(--primary-text-color) !important;
        }
        #app-shell .text-secondary-custom {
          color: var(--secondary-color) !important;
        }
        
        /* Background colors */
        #app-shell .bg-primary-custom {
          background-color: var(--ink-solid) !important;
          color: var(--ink-solid-text) !important;
        }
        #app-shell .bg-primary-light-custom {
          background-color: var(--primary-light) !important;
        }
        #app-shell .bg-primary-medium-custom {
          background-color: var(--primary-medium) !important;
        }
        #app-shell .bg-secondary-custom {
          background-color: var(--secondary-color) !important;
          color: var(--secondary-text-color) !important;
        }

        /* Toggle track colors */
        #app-shell label:has(> input[type="checkbox"]:checked) > div {
          background-color: var(--primary-color) !important;
        }
        
        /* Border colors */
        #app-shell .border-primary-custom {
          border-color: var(--primary-color) !important;
        }
        #app-shell .border-secondary-custom {
          border-color: var(--secondary-color) !important;
        }
        
        /* Navigation active state.
           Die Markierung liegt als innerer Schatten links im Element: Eine
           echte Rahmenkante würde an den abgerundeten Ecken als abgeschnittener
           Bogen neben dem Menüpunkt stehen. */
        /* Aktive Navigation nach dem Muster der Fachsprachen-Einstellung:
           getönte Akzentfläche statt voller Farbfläche, Schrift in der auf die
           jeweilige Fläche abgestimmten Akzentfarbe. */
        #app-shell .nav-active {
          background-color: var(--accent-tint) !important;
          color: var(--primary-on-surface) !important;
          font-weight: 500 !important;
          box-shadow: none !important;
        }
        
        /* Loading spinner */
        #app-shell .spinner-primary {
          border-color: var(--primary-light) var(--primary-light) var(--primary-light) var(--primary-color) !important;
        }
        
        /* Status colors - override for primary colored elements */
        #app-shell .status-sent {
          background-color: var(--primary-light) !important;
          color: var(--primary-on-surface) !important;
        }
        
        /* Links */
        #app-shell .link-primary {
          color: var(--primary-on-surface) !important;
        }
        #app-shell .link-primary:hover {
          color: var(--primary-on-surface) !important;
          filter: brightness(0.8) !important;
        }

        #app-shell .action-menu-trigger {
          background-color: var(--primary-light) !important;
          color: var(--primary-on-surface) !important;
        }
        #app-shell .action-menu-trigger:hover {
          background-color: var(--primary-medium) !important;
          color: var(--primary-on-surface) !important;
        }

        #app-shell .action-menu-trigger-primary {
          background-color: var(--primary-color) !important;
          color: var(--primary-text-color) !important;
        }
        #app-shell .action-menu-trigger-primary:hover {
          background-color: var(--primary-color) !important;
          color: var(--primary-text-color) !important;
          filter: brightness(0.9) !important;
        }

        /* Selection controls follow the configured application color. */
        #app-shell .custom-checkbox:checked {
          background-color: var(--primary-color) !important;
          border-color: var(--primary-color) !important;
        }
        #app-shell .custom-checkbox:focus-visible {
          border-color: var(--primary-color) !important;
          box-shadow: 0 0 0 2px var(--primary-light) !important;
        }

        /* Theme overrides stay inside the app shell. */
        #app-shell[data-theme="dark"] {
          background-color: #0a0a0b !important;
          color: #e5e7eb;
        }
        #app-shell[data-theme="dark"] .theme-tab-bar {
          background-color: #141416 !important;
          border-color: #2f2f34 !important;
          box-shadow: none !important;
        }
        #app-shell[data-theme="dark"] .theme-tab-button:not(.theme-tab-active) {
          color: #a1a1aa !important;
        }
        #app-shell[data-theme="dark"] .theme-tab-button:not(.theme-tab-active):hover {
          background-color: #232326 !important;
          color: #ffffff !important;
        }
        #app-shell[data-theme="dark"] .theme-tab-count {
          background-color: #232326 !important;
          color: #a1a1aa !important;
        }
        #app-shell[data-theme="dark"] .theme-tab-active .theme-tab-count {
          background-color: rgb(255 255 255 / 0.2) !important;
          color: inherit !important;
        }
        #app-shell[data-theme="dark"] .settings-save-bar {
          background-color: rgba(17, 24, 39, 0.95) !important;
          border-color: #2f2f34 !important;
        }
        #app-shell[data-theme="dark"] .theme-scrollbar {
          scrollbar-color: #2f2f34 #141416 !important;
          scrollbar-width: thin;
        }
        #app-shell[data-theme="dark"] .theme-scrollbar::-webkit-scrollbar-track {
          background: #141416 !important;
        }
        #app-shell[data-theme="dark"] .theme-scrollbar::-webkit-scrollbar-thumb {
          background: #2f2f34 !important;
        }
        #app-shell[data-theme="dark"] .theme-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3f3f46 !important;
        }
        #app-shell[data-theme="dark"] .bg-white {
          background-color: #141416 !important;
        }
        /* Die Seitenleiste liegt auf der Seitenfläche, nicht auf einer eigenen
           gehobenen Fläche. Die Regel steht hier und nicht in index.css, weil
           die Klassenüberschreibung darüber sonst gewinnt. */
        #app-shell[data-theme="dark"] .sidebar-shell {
          background-color: #0a0a0b !important;
        }
        /* Aktionssymbole tragen im Dunkelmodus keine Farbfläche, sondern
           bleiben bis zum Zeigen zurückhaltend. */
        #app-shell[data-theme="dark"] .action-icon-blue,
        #app-shell[data-theme="dark"] .action-icon-green,
        #app-shell[data-theme="dark"] .action-icon-red,
        #app-shell[data-theme="dark"] .action-icon-indigo {
          background-color: transparent !important;
          color: #9a9aa2 !important;
        }
        #app-shell[data-theme="dark"] .action-icon-blue:hover,
        #app-shell[data-theme="dark"] .action-icon-blue:focus-visible {
          background-color: #172554 !important;
          color: #bfdbfe !important;
        }
        #app-shell[data-theme="dark"] .action-icon-green:hover,
        #app-shell[data-theme="dark"] .action-icon-green:focus-visible {
          background-color: #052e16 !important;
          color: #bbf7d0 !important;
        }
        #app-shell[data-theme="dark"] .action-icon-red:hover,
        #app-shell[data-theme="dark"] .action-icon-red:focus-visible {
          background-color: #450a0a !important;
          color: #fecaca !important;
        }
        #app-shell[data-theme="dark"] .action-icon-indigo:hover,
        #app-shell[data-theme="dark"] .action-icon-indigo:focus-visible {
          background-color: #1e1b4b !important;
          color: #c7d2fe !important;
        }
        #app-shell[data-theme="dark"] .bg-gray-50 {
          background-color: #0a0a0b !important;
        }
        #app-shell[data-theme="dark"] .page-header {
          background-color: #0a0a0b !important;
          border-color: #232326 !important;
        }
        #app-shell[data-theme="dark"] .calendar-toolbar-button,
        #app-shell[data-theme="dark"] .calendar-period-label {
          background-color: #141416 !important;
          border-color: #475569 !important;
          color: #a1a1aa !important;
        }
        #app-shell[data-theme="dark"] .calendar-toolbar-button:hover,
        #app-shell[data-theme="dark"] .calendar-period-label:hover {
          background-color: #232326 !important;
          color: #ffffff !important;
        }
        #app-shell[data-theme="dark"] .calendar-toolbar-outline {
          background-color: transparent !important;
          border-color: var(--primary-color) !important;
          color: var(--primary-on-surface) !important;
        }
        #app-shell[data-theme="dark"] .calendar-toolbar-outline:hover {
          background-color: #1c1c20 !important;
        }
        #app-shell[data-theme="dark"] .calendar-view-switcher {
          background-color: #0a0a0b !important;
          border-color: #475569 !important;
        }
        #app-shell[data-theme="dark"] .calendar-view-option:not(.bg-primary-custom) {
          color: #a1a1aa !important;
        }
        #app-shell[data-theme="dark"] .calendar-view-option:not(.bg-primary-custom):hover {
          background-color: #232326 !important;
          color: #ffffff !important;
        }
        #app-shell[data-theme="dark"] .bg-gray-100 {
          background-color: #232326 !important;
        }
        #app-shell[data-theme="dark"] .bg-gray-200 {
          background-color: #2f2f34 !important;
        }
        #app-shell[data-theme="dark"] .bg-gray-300 {
          background-color: #2f2f34 !important;
        }
        #app-shell[data-theme="dark"] .bg-gray-50\\/60 {
          background-color: #141416 !important;
        }
        #app-shell[data-theme="dark"] .bg-primary-light-custom {
          background-color: #232326 !important;
        }
        #app-shell[data-theme="dark"] .bg-primary-medium-custom {
          background-color: #2f2f34 !important;
        }
        #app-shell[data-theme="dark"] .bg-primary-custom\\/5 {
          background-color: #1c1c20 !important;
        }
        #app-shell[data-theme="dark"] .bg-primary-custom\\/10 {
          background-color: #202024 !important;
        }
        #app-shell[data-theme="dark"] .bg-primary-custom\\/15 {
          background-color: #232326 !important;
        }
        #app-shell[data-theme="dark"] .bg-primary-custom\\/20 {
          background-color: #2f2f34 !important;
        }
        #app-shell[data-theme="dark"] .bg-slate-50 {
          background-color: #141416 !important;
        }
        #app-shell[data-theme="dark"] .bg-slate-100 {
          background-color: #232326 !important;
        }
        #app-shell[data-theme="dark"] .bg-slate-200 {
          background-color: #2f2f34 !important;
        }
        #app-shell[data-theme="dark"] .text-slate-600,
        #app-shell[data-theme="dark"] .text-slate-500 {
          color: #a1a1aa !important;
        }
        #app-shell[data-theme="dark"] .text-slate-400 {
          color: #71717a !important;
        }
        #app-shell[data-theme="dark"] .border-slate-200 {
          border-color: #2f2f34 !important;
        }
        #app-shell[data-theme="dark"] .border-slate-300 {
          border-color: #3f3f46 !important;
        }
        #app-shell[data-theme="dark"] .text-gray-950,
        #app-shell[data-theme="dark"] .text-gray-900,
        #app-shell[data-theme="dark"] .text-gray-800,
        #app-shell[data-theme="dark"] .text-gray-700 {
          color: #fafafa !important;
        }
        #app-shell[data-theme="dark"] .text-gray-600,
        #app-shell[data-theme="dark"] .text-gray-500,
        #app-shell[data-theme="dark"] .text-gray-400 {
          color: #a1a1aa !important;
        }
        #app-shell[data-theme="dark"] .border-gray-100,
        #app-shell[data-theme="dark"] .border-gray-200,
        #app-shell[data-theme="dark"] .border-gray-300 {
          border-color: #2f2f34 !important;
        }
        #app-shell[data-theme="dark"] .nav-active {
          background-color: var(--accent-tint) !important;
          color: var(--primary-on-surface) !important;
          box-shadow: none !important;
        }
        #app-shell[data-theme="dark"] .action-button {
          background-color: #141416 !important;
          border-color: #2f2f34 !important;
          color: #e5e7eb !important;
        }
        #app-shell[data-theme="dark"] .action-button:hover {
          background-color: #232326 !important;
          color: #ffffff !important;
        }
        #app-shell[data-theme="dark"] .action-button.text-rose-700 {
          color: #fecaca !important;
        }
        /* Die Akzentfarbe ist auf helle Flächen abgestimmt. Als Text auf einer
           dunklen Karte erreicht sie nur rund 2:1. Die Variable
           --primary-on-surface ist dieselbe Farbe, so weit aufgehellt, dass
           4,5:1 erreicht werden. */
        #app-shell[data-theme="dark"] .text-primary-custom {
          color: var(--primary-on-surface) !important;
        }
        /* Die Icon-Aktionen setzen ihre Farben über @apply zusammen. Dabei
           landen die Deklarationen direkt in .action-icon-*, die weiter unten
           stehenden Regeln für .bg-blue-100 & Co. greifen also nicht. Der
           Dunkelmodus braucht deshalb eigene Regeln. */
        #app-shell[data-theme="dark"] .action-icon-button:disabled {
          opacity: 0.45;
        }
        #app-shell[data-theme="dark"] .position-row-drag-handle {
          color: #71717a !important;
        }
        #app-shell[data-theme="dark"] .position-row-drag-handle:hover {
          background-color: #232326 !important;
          color: #ffffff !important;
        }
        #app-shell[data-theme="dark"] .position-row-action {
          color: #a1a1aa !important;
        }
        #app-shell[data-theme="dark"] .position-row-action:hover:not(:disabled) {
          background-color: #232326 !important;
          color: #ffffff !important;
        }
        #app-shell[data-theme="dark"] .position-row-delete {
          color: #fecaca !important;
        }
        #app-shell[data-theme="dark"] .position-row-delete:hover:not(:disabled) {
          background-color: #7f1d1d !important;
          color: #fee2e2 !important;
        }
        #app-shell[data-theme="dark"] .quote-editor-option:hover {
          background-color: #1e3a8a !important;
          color: #eff6ff !important;
        }
        #app-shell[data-theme="dark"] .custom-checkbox:not(:checked),
        #app-shell[data-theme="dark"] .custom-radio:not(:checked) {
          background-color: #141416 !important;
          border-color: #3f3f46 !important;
        }
        #app-shell[data-theme="dark"] .custom-checkbox:disabled:not(:checked),
        #app-shell[data-theme="dark"] .custom-radio:disabled:not(:checked) {
          background-color: #232326 !important;
          border-color: #3f3f46 !important;
        }
        #app-shell[data-theme="dark"] .notice-info {
          background-color: #172554 !important;
          border-color: #2563eb !important;
          color: #dbeafe !important;
        }
        #app-shell[data-theme="dark"] .notice-success {
          background-color: #052e16 !important;
          border-color: #16a34a !important;
          color: #bbf7d0 !important;
        }
        #app-shell[data-theme="dark"] .notice-warning {
          background-color: #451a03 !important;
          border-color: #d97706 !important;
          color: #fde68a !important;
        }
        #app-shell[data-theme="dark"] .notice-error {
          background-color: #450a0a !important;
          border-color: #dc2626 !important;
          color: #fecaca !important;
        }
        #app-shell[data-theme="dark"] .guidance-panel {
          background-color: #141416 !important;
          border-color: #2f2f34 !important;
          color: #a1a1aa !important;
        }
        #app-shell[data-theme="dark"] .bg-blue-50 {
          background-color: #172554 !important;
        }
        #app-shell[data-theme="dark"] .bg-blue-100 {
          background-color: #1e3a8a !important;
        }
        #app-shell[data-theme="dark"] .bg-blue-100\\/80 {
          background-color: #1e3a8a !important;
        }
        /* Solid status/action colours need a dark-theme shade as well. White
           button text on the regular 500-stops falls below 4.5:1. */
        #app-shell[data-theme="dark"] .bg-blue-500,
        #app-shell[data-theme="dark"] .bg-blue-600,
        #app-shell[data-theme="dark"] .bg-blue-700 {
          background-color: #1d4ed8 !important;
        }
        #app-shell[data-theme="dark"] .hover\\:bg-blue-600:hover,
        #app-shell[data-theme="dark"] .hover\\:bg-blue-700:hover,
        #app-shell[data-theme="dark"] .hover\\:bg-blue-800:hover {
          background-color: #1d4ed8 !important;
        }
        #app-shell[data-theme="dark"] .bg-green-50 {
          background-color: #052e16 !important;
        }
        #app-shell[data-theme="dark"] .bg-green-100 {
          background-color: #14532d !important;
        }
        #app-shell[data-theme="dark"] .bg-green-500,
        #app-shell[data-theme="dark"] .bg-green-600 {
          background-color: #15803d !important;
        }
        #app-shell[data-theme="dark"] .hover\\:bg-green-600:hover,
        #app-shell[data-theme="dark"] .hover\\:bg-green-700:hover {
          background-color: #15803d !important;
        }
        #app-shell[data-theme="dark"] .bg-red-50 {
          background-color: #450a0a !important;
        }
        #app-shell[data-theme="dark"] .bg-red-100 {
          background-color: #7f1d1d !important;
        }
        #app-shell[data-theme="dark"] .bg-red-500,
        #app-shell[data-theme="dark"] .bg-red-600,
        #app-shell[data-theme="dark"] .bg-red-700 {
          background-color: #b91c1c !important;
        }
        #app-shell[data-theme="dark"] .hover\\:bg-red-600:hover,
        #app-shell[data-theme="dark"] .hover\\:bg-red-700:hover,
        #app-shell[data-theme="dark"] .hover\\:bg-red-800:hover {
          background-color: #b91c1c !important;
        }
        #app-shell[data-theme="dark"] .bg-yellow-50,
        #app-shell[data-theme="dark"] .bg-amber-50 {
          background-color: #451a03 !important;
        }
        #app-shell[data-theme="dark"] .bg-yellow-100,
        #app-shell[data-theme="dark"] .bg-amber-100 {
          background-color: #78350f !important;
        }
        #app-shell[data-theme="dark"] .bg-yellow-500,
        #app-shell[data-theme="dark"] .bg-amber-500,
        #app-shell[data-theme="dark"] .bg-amber-600 {
          background-color: #b45309 !important;
        }
        #app-shell[data-theme="dark"] .hover\\:bg-yellow-100:hover,
        #app-shell[data-theme="dark"] .hover\\:bg-amber-700:hover,
        #app-shell[data-theme="dark"] .hover\\:bg-amber-800:hover {
          background-color: #b45309 !important;
        }
        #app-shell[data-theme="dark"] .bg-orange-50 {
          background-color: #451a03 !important;
        }
        #app-shell[data-theme="dark"] .bg-orange-100 {
          background-color: #7c2d12 !important;
        }
        #app-shell[data-theme="dark"] .bg-orange-200 {
          background-color: #9a3412 !important;
        }
        #app-shell[data-theme="dark"] .bg-orange-500,
        #app-shell[data-theme="dark"] .bg-orange-600 {
          background-color: #c2410c !important;
        }
        #app-shell[data-theme="dark"] .hover\\:bg-orange-600:hover,
        #app-shell[data-theme="dark"] .hover\\:bg-orange-700:hover {
          background-color: #c2410c !important;
        }
        #app-shell[data-theme="dark"] .bg-emerald-50 {
          background-color: #052e16 !important;
        }
        #app-shell[data-theme="dark"] .bg-emerald-100 {
          background-color: #14532d !important;
        }
        #app-shell[data-theme="dark"] .bg-emerald-500 {
          background-color: #047857 !important;
        }
        #app-shell[data-theme="dark"] .bg-rose-50 {
          background-color: #450a0a !important;
        }
        #app-shell[data-theme="dark"] .bg-rose-100 {
          background-color: #7f1d1d !important;
        }
        #app-shell[data-theme="dark"] .bg-rose-500 {
          background-color: #be123c !important;
        }
        #app-shell[data-theme="dark"] .bg-purple-600 {
          background-color: #7e22ce !important;
        }
        #app-shell[data-theme="dark"] .hover\\:bg-purple-700:hover {
          background-color: #7e22ce !important;
        }
        #app-shell[data-theme="dark"] .bg-purple-50,
        #app-shell[data-theme="dark"] .bg-purple-100 {
          background-color: #581c87 !important;
        }
        #app-shell[data-theme="dark"] .bg-violet-50 {
          background-color: #2e1065 !important;
        }
        #app-shell[data-theme="dark"] .border-blue-100,
        #app-shell[data-theme="dark"] .border-blue-200,
        #app-shell[data-theme="dark"] .border-blue-300 {
          border-color: #2563eb !important;
        }
        #app-shell[data-theme="dark"] .border-green-100,
        #app-shell[data-theme="dark"] .border-green-200 {
          border-color: #16a34a !important;
        }
        #app-shell[data-theme="dark"] .border-red-100,
        #app-shell[data-theme="dark"] .border-red-200 {
          border-color: #dc2626 !important;
        }
        #app-shell[data-theme="dark"] .border-yellow-200,
        #app-shell[data-theme="dark"] .border-amber-200 {
          border-color: #d97706 !important;
        }
        #app-shell[data-theme="dark"] .border-orange-100,
        #app-shell[data-theme="dark"] .border-orange-200,
        #app-shell[data-theme="dark"] .border-orange-300 {
          border-color: #c2410c !important;
        }
        #app-shell[data-theme="dark"] .border-emerald-100,
        #app-shell[data-theme="dark"] .border-emerald-200 {
          border-color: #16a34a !important;
        }
        #app-shell[data-theme="dark"] .border-rose-100,
        #app-shell[data-theme="dark"] .border-rose-200 {
          border-color: #dc2626 !important;
        }
        #app-shell[data-theme="dark"] .border-amber-100,
        #app-shell[data-theme="dark"] .border-amber-200 {
          border-color: #d97706 !important;
        }
        #app-shell[data-theme="dark"] .border-purple-200,
        #app-shell[data-theme="dark"] .border-purple-500 {
          border-color: #a855f7 !important;
        }
        #app-shell[data-theme="dark"] .border-violet-200 {
          border-color: #8b5cf6 !important;
        }
        #app-shell[data-theme="dark"] .text-blue-950,
        #app-shell[data-theme="dark"] .text-blue-900,
        #app-shell[data-theme="dark"] .text-blue-800,
        #app-shell[data-theme="dark"] .text-blue-700,
        #app-shell[data-theme="dark"] .text-blue-600,
        #app-shell[data-theme="dark"] .text-blue-500 {
          color: #dbeafe !important;
        }
        #app-shell[data-theme="dark"] .text-green-900,
        #app-shell[data-theme="dark"] .text-green-800,
        #app-shell[data-theme="dark"] .text-green-700,
        #app-shell[data-theme="dark"] .text-green-600,
        #app-shell[data-theme="dark"] .text-green-500 {
          color: #bbf7d0 !important;
        }
        #app-shell[data-theme="dark"] .text-red-900,
        #app-shell[data-theme="dark"] .text-red-800,
        #app-shell[data-theme="dark"] .text-red-700,
        #app-shell[data-theme="dark"] .text-red-600,
        #app-shell[data-theme="dark"] .text-red-500 {
          color: #fecaca !important;
        }
        #app-shell[data-theme="dark"] .text-yellow-900,
        #app-shell[data-theme="dark"] .text-yellow-800,
        #app-shell[data-theme="dark"] .text-yellow-700,
        #app-shell[data-theme="dark"] .text-yellow-600,
        #app-shell[data-theme="dark"] .text-amber-900,
        #app-shell[data-theme="dark"] .text-amber-800 {
          color: #fde68a !important;
        }
        /* Statusabzeichen nutzen die 600er-Stufe als Textfarbe. Ohne eigene
           Regel bleibt sie dunkel und steht auf der abgedunkelten Fläche bei
           knapp 3:1. */
        #app-shell[data-theme="dark"] .text-purple-900,
        #app-shell[data-theme="dark"] .text-purple-800,
        #app-shell[data-theme="dark"] .text-purple-700,
        #app-shell[data-theme="dark"] .text-purple-600,
        #app-shell[data-theme="dark"] .text-purple-500 {
          color: #e9d5ff !important;
        }
        #app-shell[data-theme="dark"] .text-indigo-900,
        #app-shell[data-theme="dark"] .text-indigo-800,
        #app-shell[data-theme="dark"] .text-indigo-700,
        #app-shell[data-theme="dark"] .text-indigo-600 {
          color: #c7d2fe !important;
        }
        #app-shell[data-theme="dark"] .text-orange-950,
        #app-shell[data-theme="dark"] .text-orange-900,
        #app-shell[data-theme="dark"] .text-orange-800,
        #app-shell[data-theme="dark"] .text-orange-700,
        #app-shell[data-theme="dark"] .text-orange-600,
        #app-shell[data-theme="dark"] .text-orange-500 {
          color: #fdba74 !important;
        }
        #app-shell[data-theme="dark"] .text-emerald-900,
        #app-shell[data-theme="dark"] .text-emerald-800,
        #app-shell[data-theme="dark"] .text-emerald-700,
        #app-shell[data-theme="dark"] .text-emerald-600,
        #app-shell[data-theme="dark"] .text-emerald-500 {
          color: #a7f3d0 !important;
        }
        #app-shell[data-theme="dark"] .text-rose-900,
        #app-shell[data-theme="dark"] .text-rose-800,
        #app-shell[data-theme="dark"] .text-rose-700,
        #app-shell[data-theme="dark"] .text-rose-600,
        #app-shell[data-theme="dark"] .text-rose-500 {
          color: #fecaca !important;
        }
        #app-shell[data-theme="dark"] .text-amber-900,
        #app-shell[data-theme="dark"] .text-amber-800,
        #app-shell[data-theme="dark"] .text-amber-700,
        #app-shell[data-theme="dark"] .text-amber-600,
        #app-shell[data-theme="dark"] .text-amber-500 {
          color: #fde68a !important;
        }
        #app-shell[data-theme="dark"] .text-yellow-500 {
          color: #fde68a !important;
        }
        #app-shell[data-theme="dark"] .text-violet-900,
        #app-shell[data-theme="dark"] .text-violet-800,
        #app-shell[data-theme="dark"] .text-violet-700 {
          color: #ddd6fe !important;
        }
        /* Hover utilities otherwise restore Tailwind's dark source colour
           over the dark surface. Keep interactive states readable too. */
        #app-shell[data-theme="dark"] .hover\\:text-gray-500:hover,
        #app-shell[data-theme="dark"] .hover\\:text-gray-600:hover,
        #app-shell[data-theme="dark"] .hover\\:text-gray-700:hover,
        #app-shell[data-theme="dark"] .hover\\:text-gray-800:hover,
        #app-shell[data-theme="dark"] .hover\\:text-gray-900:hover {
          color: #fafafa !important;
        }
        #app-shell[data-theme="dark"] .hover\\:text-blue-700:hover,
        #app-shell[data-theme="dark"] .hover\\:text-blue-800:hover {
          color: #dbeafe !important;
        }
        #app-shell[data-theme="dark"] .hover\\:text-green-600:hover,
        #app-shell[data-theme="dark"] .hover\\:text-green-800:hover {
          color: #bbf7d0 !important;
        }
        #app-shell[data-theme="dark"] .hover\\:text-indigo-800:hover {
          color: #c7d2fe !important;
        }
        #app-shell[data-theme="dark"] .hover\\:text-purple-700:hover {
          color: #e9d5ff !important;
        }
        #app-shell[data-theme="dark"] .hover\\:text-red-600:hover,
        #app-shell[data-theme="dark"] .hover\\:text-red-700:hover,
        #app-shell[data-theme="dark"] .hover\\:text-red-800:hover {
          color: #fecaca !important;
        }
        #app-shell[data-theme="dark"] .hover\\:text-rose-700:hover {
          color: #fecaca !important;
        }
        #app-shell[data-theme="dark"] .hover\\:text-primary-custom:hover,
        #app-shell[data-theme="dark"] .hover\\:text-primary-custom\\/80:hover {
          color: var(--primary-on-surface) !important;
        }
        #app-shell[data-theme="dark"] input:not([type="checkbox"]):not([type="radio"]),
        #app-shell[data-theme="dark"] textarea,
        #app-shell[data-theme="dark"] select {
          background-color: #141416 !important;
          color: #fafafa !important;
          border-color: #2f2f34 !important;
        }
        #app-shell[data-theme="dark"] select:not(.select-with-chevron) {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%23cbd5e1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m5 7.5 5 5 5-5'/%3E%3C/svg%3E");
        }
        #app-shell[data-theme="dark"] select:not(.select-with-chevron):focus {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%23fb923c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m5 12.5 5-5 5 5'/%3E%3C/svg%3E");
        }
        #app-shell[data-theme="dark"] .hover\\:bg-gray-50:hover {
          background-color: #232326 !important;
        }
        #app-shell[data-theme="dark"] .hover\\:bg-gray-100:hover,
        #app-shell[data-theme="dark"] .hover\\:bg-gray-200:hover,
        #app-shell[data-theme="dark"] .hover\\:bg-gray-400:hover {
          background-color: #232326 !important;
        }
        #app-shell[data-theme="dark"] .document-preview-tool-button:hover,
        #app-shell[data-theme="dark"] .document-preview-tool-button:focus-visible {
          background-color: #232326 !important;
          color: #ffffff !important;
        }
        #app-shell[data-theme="dark"] .focus\\:bg-gray-50:focus {
          background-color: #232326 !important;
        }
        #app-shell[data-theme="dark"] .action-menu-trigger {
          background-color: #232326 !important;
          color: #dbeafe !important;
        }
        #app-shell[data-theme="dark"] .action-menu-trigger:hover {
          background-color: #2f2f34 !important;
          color: #eff6ff !important;
        }
        #app-shell[data-theme="dark"] .action-menu {
          background-color: #141416 !important;
          border-color: #2f2f34 !important;
          color: #fafafa !important;
        }
        #app-shell[data-theme="dark"] .action-menu-item {
          color: #e5e7eb !important;
        }
        #app-shell[data-theme="dark"] .action-menu-item:hover {
          background-color: #232326 !important;
          color: #ffffff !important;
        }

        /* Terminologie previews use the app theme without losing their profile accent. */
        #app-shell[data-theme="dark"] .terminology-profile-card,
        #app-shell[data-theme="dark"] .terminology-preview {
          background-color: #141416 !important;
          border-color: #2f2f34 !important;
        }
        #app-shell[data-theme="dark"] .terminology-profile-card-selected {
          background-color: #0a0a0b !important;
        }
        #app-shell[data-theme="dark"] .terminology-preview-header {
          background-color: #0a0a0b !important;
          border-color: #2f2f34 !important;
        }
        #app-shell[data-theme="dark"] .terminology-preview-search {
          background-color: #0a0a0b !important;
          border-color: #2f2f34 !important;
        }
        #app-shell[data-theme="dark"] .terminology-preview-active {
          background-color: #232326 !important;
        }
        #app-shell[data-theme="dark"] .terminology-profile-selected-label {
          background-color: #232326 !important;
        }
      `}
    </style>
  );
}
