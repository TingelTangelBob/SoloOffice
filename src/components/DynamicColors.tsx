import { useCompany } from '../context/CompanyContext';

export function DynamicColors() {
  const { company } = useCompany();
  
  // Default colors if not set
  const primaryColor = company.primaryColor || '#2563eb';
  const secondaryColor = company.secondaryColor || '#64748b';

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

  return (
    <style>
      {`
        :root {
          --primary-color: ${primaryColor};
          --primary-light: ${primaryLight};
          --primary-medium: ${primaryMedium};
          --primary-text-color: ${primaryTextColor};
          --secondary-color: ${secondaryColor};
          --secondary-light: ${secondaryLight};
          --secondary-text-color: ${secondaryTextColor};
        }
        
        /* Button styles */
        .btn-primary {
          background-color: var(--primary-color) !important;
          border-color: var(--primary-color) !important;
          color: var(--primary-text-color) !important;
        }
        .btn-primary:hover {
          background-color: var(--primary-color) !important;
          filter: brightness(0.9) !important;
          border-color: var(--primary-color) !important;
          color: var(--primary-text-color) !important;
        }
        
        .btn-secondary {
          background-color: var(--secondary-color) !important;
          border-color: var(--secondary-color) !important;
          color: var(--secondary-text-color) !important;
        }
        .btn-secondary:hover {
          background-color: var(--secondary-color) !important;
          filter: brightness(0.9) !important;
          border-color: var(--secondary-color) !important;
          color: var(--secondary-text-color) !important;
        }
        
        /* Focus styles */
        .focus-primary:focus {
          box-shadow: 0 0 0 2px var(--primary-light), 0 0 0 4px var(--primary-color) !important;
          border-color: var(--primary-color) !important;
        }
        
        /* Text colors */
        .text-primary-custom {
          color: var(--primary-color) !important;
        }
        .text-secondary-custom {
          color: var(--secondary-color) !important;
        }
        
        /* Background colors */
        .bg-primary-custom {
          background-color: var(--primary-color) !important;
          color: var(--primary-text-color) !important;
        }
        .bg-primary-light-custom {
          background-color: var(--primary-light) !important;
        }
        .bg-primary-medium-custom {
          background-color: var(--primary-medium) !important;
        }
        .bg-secondary-custom {
          background-color: var(--secondary-color) !important;
          color: var(--secondary-text-color) !important;
        }
        
        /* Border colors */
        .border-primary-custom {
          border-color: var(--primary-color) !important;
        }
        .border-secondary-custom {
          border-color: var(--secondary-color) !important;
        }
        
        /* Navigation active state */
        .nav-active {
          background-color: var(--primary-light) !important;
          color: var(--primary-color) !important;
          border-right: 2px solid var(--primary-color) !important;
        }
        
        /* Loading spinner */
        .spinner-primary {
          border-color: var(--primary-light) var(--primary-light) var(--primary-light) var(--primary-color) !important;
        }
        
        /* Status colors - override for primary colored elements */
        .status-sent {
          background-color: var(--primary-light) !important;
          color: var(--primary-color) !important;
        }
        
        /* Links */
        .link-primary {
          color: var(--primary-color) !important;
        }
        .link-primary:hover {
          color: var(--primary-color) !important;
          filter: brightness(0.8) !important;
        }
      `}
    </style>
  );
}
