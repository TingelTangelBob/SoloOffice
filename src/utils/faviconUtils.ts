/**
 * Utility functions for dynamic favicon management
 */

import logger from './logger';

/**
 * Updates the favicon and various app icons based on the provided icon URL
 */
export const updateFavicon = (iconUrl: string | null) => {
  // Remove existing favicon and icon links
  const existingFavicons = document.querySelectorAll('link[rel*="icon"], link[rel*="apple-touch-icon"], link[rel*="manifest"]');
  existingFavicons.forEach(link => link.remove());

  if (iconUrl) {
    // Create different sizes for various use cases
    const sizes = [
      { size: '16x16', rel: 'icon' },
      { size: '32x32', rel: 'icon' },
      { size: '192x192', rel: 'icon' },
      { size: '512x512', rel: 'icon' },
    ];

    // Add favicon links for different sizes
    sizes.forEach(({ size, rel }) => {
      const link = document.createElement('link');
      link.rel = rel;
      link.type = getIconType(iconUrl);
      link.setAttribute('sizes', size);
      link.href = iconUrl;
      document.head.appendChild(link);
    });

    // Add Apple Touch Icon
    const appleTouchIcon = document.createElement('link');
    appleTouchIcon.rel = 'apple-touch-icon';
    appleTouchIcon.setAttribute('sizes', '180x180');
    appleTouchIcon.href = iconUrl;
    document.head.appendChild(appleTouchIcon);

    // Update web app manifest
    updateWebAppManifest(iconUrl);
  } else {
    // Fallback to default Vite icon
    const defaultFavicon = document.createElement('link');
    defaultFavicon.rel = 'icon';
    defaultFavicon.type = 'image/svg+xml';
    defaultFavicon.href = '/vite.svg';
    document.head.appendChild(defaultFavicon);

    // Update web app manifest with default
    updateWebAppManifest('/vite.svg');
  }
};

/**
 * Determines the MIME type of the icon based on the URL
 */
const getIconType = (iconUrl: string): string => {
  if (iconUrl.includes('data:image/')) {
    // Extract MIME type from data URL
    const match = iconUrl.match(/data:(image\/[^;]+)/);
    return match ? match[1] : 'image/png';
  }
  
  const extension = iconUrl.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'ico':
      return 'image/x-icon';
    default:
      return 'image/png';
  }
};

/**
 * Creates or updates the web app manifest for PWA features
 */
const updateWebAppManifest = (iconUrl: string) => {
  // Get company data from localStorage as fallback
  const companyData = localStorage.getItem('invoice-app-company');
  let companyName = 'SoloOffice';
  
  if (companyData) {
    try {
      const company = JSON.parse(companyData);
      companyName = company.name || 'SoloOffice';
    } catch {
      logger.warn('Could not parse company data from localStorage');
    }
  }

  const manifest = {
    name: `${companyName} - SoloOffice`,
    short_name: companyName,
    description: 'eRechnung-konforme Rechnungsanwendung',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#2563eb',
    orientation: 'portrait-primary',
    icons: [
      {
        src: iconUrl,
        sizes: '192x192',
        type: getIconType(iconUrl),
        purpose: 'maskable any'
      },
      {
        src: iconUrl,
        sizes: '512x512',
        type: getIconType(iconUrl),
        purpose: 'maskable any'
      }
    ],
    categories: ['business', 'productivity', 'finance'],
    lang: 'de-DE',
    dir: 'ltr'
  };

  // Create blob URL for the manifest
  const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: 'application/json'
  });
  const manifestUrl = URL.createObjectURL(manifestBlob);

  // Add or update manifest link
  let manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement;
  if (!manifestLink) {
    manifestLink = document.createElement('link');
    manifestLink.rel = 'manifest';
    document.head.appendChild(manifestLink);
  } else {
    // Revoke previous blob URL to prevent memory leaks
    if (manifestLink.href && manifestLink.href.startsWith('blob:')) {
      URL.revokeObjectURL(manifestLink.href);
    }
  }
  
  manifestLink.href = manifestUrl;
};

/**
 * Updates the page title based on company name
 */
export const updatePageTitle = (companyName?: string) => {
  const baseTitle = 'SoloOffice - eRechnung-konforme Rechnungsanwendung';
  if (companyName && companyName.trim() && companyName !== 'Meine Firma GmbH') {
    document.title = `${companyName} - ${baseTitle}`;
  } else {
    document.title = baseTitle;
  }
};

/**
 * Sets up meta tags for better mobile and PWA support
 */
export const setupMetaTags = () => {
  // Viewport meta tag (should already exist, but ensure it's correct)
  let viewportMeta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement;
  if (!viewportMeta) {
    viewportMeta = document.createElement('meta');
    viewportMeta.name = 'viewport';
    document.head.appendChild(viewportMeta);
  }
  viewportMeta.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover';

  // Theme color for mobile browsers
  let themeColorMeta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement;
  if (!themeColorMeta) {
    themeColorMeta = document.createElement('meta');
    themeColorMeta.name = 'theme-color';
    document.head.appendChild(themeColorMeta);
  }
  themeColorMeta.content = '#2563eb';

  // Apple mobile web app capable
  let appleMobileWebAppMeta = document.querySelector('meta[name="apple-mobile-web-app-capable"]') as HTMLMetaElement;
  if (!appleMobileWebAppMeta) {
    appleMobileWebAppMeta = document.createElement('meta');
    appleMobileWebAppMeta.name = 'apple-mobile-web-app-capable';
    document.head.appendChild(appleMobileWebAppMeta);
  }
  appleMobileWebAppMeta.content = 'yes';

  // Apple mobile web app status bar style
  let appleStatusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]') as HTMLMetaElement;
  if (!appleStatusBarMeta) {
    appleStatusBarMeta = document.createElement('meta');
    appleStatusBarMeta.name = 'apple-mobile-web-app-status-bar-style';
    document.head.appendChild(appleStatusBarMeta);
  }
  appleStatusBarMeta.content = 'default';

  // Application name
  let applicationNameMeta = document.querySelector('meta[name="application-name"]') as HTMLMetaElement;
  if (!applicationNameMeta) {
    applicationNameMeta = document.createElement('meta');
    applicationNameMeta.name = 'application-name';
    document.head.appendChild(applicationNameMeta);
  }
  applicationNameMeta.content = 'SoloOffice';

  // MS Tile Color for Windows
  let msTileColorMeta = document.querySelector('meta[name="msapplication-TileColor"]') as HTMLMetaElement;
  if (!msTileColorMeta) {
    msTileColorMeta = document.createElement('meta');
    msTileColorMeta.name = 'msapplication-TileColor';
    document.head.appendChild(msTileColorMeta);
  }
  msTileColorMeta.content = '#2563eb';
};
