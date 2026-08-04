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

  // Function to determine text color based on background luminance
  const getTextColor = (backgroundColor: string) => {
    const luminance = getLuminance(backgroundColor);
    // If luminance is greater than 0.5, use dark text, otherwise use light text
    return luminance > 0.5 ? '#000000' : '#ffffff';
  };

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
  }, [company.themeMode, primaryColor, primaryLight, primaryMedium, primaryTextColor, secondaryColor, secondaryLight, secondaryTextColor]);

  return (
    <style>
      {`
        /* Button styles */
        #app-shell .btn-primary {
          background-color: var(--primary-color) !important;
          border-color: var(--primary-color) !important;
          color: var(--primary-text-color) !important;
        }
        #app-shell .btn-primary:hover {
          background-color: var(--primary-color) !important;
          filter: brightness(0.9) !important;
          border-color: var(--primary-color) !important;
          color: var(--primary-text-color) !important;
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
        
        /* Focus styles */
        #app-shell .focus-primary:focus {
          box-shadow: 0 0 0 2px var(--primary-light), 0 0 0 4px var(--primary-color) !important;
          border-color: var(--primary-color) !important;
        }
        
        /* Text colors */
        #app-shell .text-primary-custom {
          color: var(--primary-color) !important;
        }
        #app-shell .text-secondary-custom {
          color: var(--secondary-color) !important;
        }
        
        /* Background colors */
        #app-shell .bg-primary-custom {
          background-color: var(--primary-color) !important;
          color: var(--primary-text-color) !important;
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
        
        /* Navigation active state */
        #app-shell .nav-active {
          background-color: var(--primary-light) !important;
          color: var(--primary-color) !important;
          border-right: 2px solid var(--primary-color) !important;
        }
        
        /* Loading spinner */
        #app-shell .spinner-primary {
          border-color: var(--primary-light) var(--primary-light) var(--primary-light) var(--primary-color) !important;
        }
        
        /* Status colors - override for primary colored elements */
        #app-shell .status-sent {
          background-color: var(--primary-light) !important;
          color: var(--primary-color) !important;
        }
        
        /* Links */
        #app-shell .link-primary {
          color: var(--primary-color) !important;
        }
        #app-shell .link-primary:hover {
          color: var(--primary-color) !important;
          filter: brightness(0.8) !important;
        }

        #app-shell .action-menu-trigger {
          background-color: var(--primary-light) !important;
          color: var(--primary-color) !important;
        }
        #app-shell .action-menu-trigger:hover {
          background-color: var(--primary-medium) !important;
          color: var(--primary-color) !important;
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
          background-color: #111827 !important;
          color: #e5e7eb;
        }
        #app-shell[data-theme="dark"] .bg-white {
          background-color: #1f2937 !important;
        }
        #app-shell[data-theme="dark"] .bg-gray-50 {
          background-color: #111827 !important;
        }
        #app-shell[data-theme="dark"] .bg-gray-100 {
          background-color: #374151 !important;
        }
        #app-shell[data-theme="dark"] .bg-gray-200 {
          background-color: #4b5563 !important;
        }
        #app-shell[data-theme="dark"] .bg-gray-300 {
          background-color: #6b7280 !important;
        }
        #app-shell[data-theme="dark"] .text-gray-900,
        #app-shell[data-theme="dark"] .text-gray-800,
        #app-shell[data-theme="dark"] .text-gray-700 {
          color: #f3f4f6 !important;
        }
        #app-shell[data-theme="dark"] .text-gray-600,
        #app-shell[data-theme="dark"] .text-gray-500,
        #app-shell[data-theme="dark"] .text-gray-400 {
          color: #d1d5db !important;
        }
        #app-shell[data-theme="dark"] .border-gray-100,
        #app-shell[data-theme="dark"] .border-gray-200,
        #app-shell[data-theme="dark"] .border-gray-300 {
          border-color: #4b5563 !important;
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
          background-color: #1f2937 !important;
          border-color: #4b5563 !important;
          color: #d1d5db !important;
        }
        #app-shell[data-theme="dark"] .bg-blue-50 {
          background-color: #172554 !important;
        }
        #app-shell[data-theme="dark"] .bg-blue-100 {
          background-color: #1e3a8a !important;
        }
        #app-shell[data-theme="dark"] .bg-green-50 {
          background-color: #052e16 !important;
        }
        #app-shell[data-theme="dark"] .bg-green-100 {
          background-color: #14532d !important;
        }
        #app-shell[data-theme="dark"] .bg-red-50 {
          background-color: #450a0a !important;
        }
        #app-shell[data-theme="dark"] .bg-red-100 {
          background-color: #7f1d1d !important;
        }
        #app-shell[data-theme="dark"] .bg-yellow-50,
        #app-shell[data-theme="dark"] .bg-amber-50 {
          background-color: #451a03 !important;
        }
        #app-shell[data-theme="dark"] .bg-yellow-100,
        #app-shell[data-theme="dark"] .bg-amber-100 {
          background-color: #78350f !important;
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
        #app-shell[data-theme="dark"] .text-blue-950,
        #app-shell[data-theme="dark"] .text-blue-900,
        #app-shell[data-theme="dark"] .text-blue-800,
        #app-shell[data-theme="dark"] .text-blue-700 {
          color: #dbeafe !important;
        }
        #app-shell[data-theme="dark"] .text-green-900,
        #app-shell[data-theme="dark"] .text-green-800,
        #app-shell[data-theme="dark"] .text-green-700 {
          color: #bbf7d0 !important;
        }
        #app-shell[data-theme="dark"] .text-red-900,
        #app-shell[data-theme="dark"] .text-red-800,
        #app-shell[data-theme="dark"] .text-red-700,
        #app-shell[data-theme="dark"] .text-red-600 {
          color: #fecaca !important;
        }
        #app-shell[data-theme="dark"] .text-yellow-900,
        #app-shell[data-theme="dark"] .text-yellow-800,
        #app-shell[data-theme="dark"] .text-yellow-700,
        #app-shell[data-theme="dark"] .text-amber-900,
        #app-shell[data-theme="dark"] .text-amber-800 {
          color: #fde68a !important;
        }
        #app-shell[data-theme="dark"] input:not([type="checkbox"]):not([type="radio"]),
        #app-shell[data-theme="dark"] textarea,
        #app-shell[data-theme="dark"] select {
          background-color: #1f2937 !important;
          color: #f3f4f6 !important;
          border-color: #4b5563 !important;
        }
        #app-shell[data-theme="dark"] .hover\\:bg-gray-50:hover {
          background-color: #374151 !important;
        }

        /* Terminologie previews use the app theme without losing their profile accent. */
        #app-shell[data-theme="dark"] .terminology-profile-card,
        #app-shell[data-theme="dark"] .terminology-preview {
          background-color: #1f2937 !important;
          border-color: #4b5563 !important;
        }
        #app-shell[data-theme="dark"] .terminology-profile-card-selected {
          background-color: #111827 !important;
        }
        #app-shell[data-theme="dark"] .terminology-preview-header {
          background-color: #111827 !important;
          border-color: #4b5563 !important;
        }
        #app-shell[data-theme="dark"] .terminology-preview-search {
          background-color: #111827 !important;
          border-color: #4b5563 !important;
        }
        #app-shell[data-theme="dark"] .terminology-preview-active {
          background-color: #374151 !important;
        }
        #app-shell[data-theme="dark"] .terminology-profile-selected-label {
          background-color: #374151 !important;
        }
      `}
    </style>
  );
}
