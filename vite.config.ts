import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
// index.html ist für die öffentliche Demo geschrieben („Testdaten bleiben in
// diesem Browser“). Der gehostete/self-gehostete Build darf das nicht anzeigen:
// ohne VITE_DEMO_MODE=true werden Titel und Beschreibung auf das Produkt umgestellt.
function productHtml() {
  return {
    name: 'solooffice-product-html',
    transformIndexHtml(html: string) {
      if (process.env.VITE_DEMO_MODE === 'true') return html;
      return html
        .replace('SoloOffice-Demo – Rechnungen, Angebote, EÜR und Belege ausprobieren. Die Testdaten bleiben in diesem Browser.', 'SoloOffice – Rechnungen, Angebote, EÜR und Belege für Selbstständige und kleine Teams.')
        .replaceAll('SoloOffice-Demo', 'SoloOffice');
    },
  };
}

export default defineConfig({
  plugins: [react(), productHtml()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
