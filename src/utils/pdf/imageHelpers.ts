/**
 * Image helper utilities for PDF generation
 */

/**
 * Load an image from a URL or data URL
 * @param src - Image source (URL or data URL)
 * @returns Promise that resolves with the loaded image
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    
    // Fremde URLs müssen auch auf einer Canvas lesbar sein.
    if (!src.startsWith('data:') && !src.startsWith('blob:')) img.crossOrigin = 'anonymous';

    // Handle data URLs and regular URLs
    if (src.startsWith('data:')) {
      img.src = src;
    } else if (src.startsWith('blob:')) {
      img.src = src;
    } else {
      // Regular URL
      img.src = src;
    }
  });
}

export interface PdfImage {
  source: string;
  format: 'PNG';
  width: number;
  height: number;
}

/**
 * Browser und jsPDF unterstützen unterschiedliche Bildformate. Beide
 * Zeichenflächen erhalten deshalb dasselbe, vom Browser dekodierte PNG.
 * So funktionieren auch SVG-, WebP- und GIF-Logos im exportierten Dokument.
 */
export async function loadPdfImage(source: string): Promise<PdfImage> {
  const image = await loadImage(source);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!(width > 0 && height > 0)) throw new Error('Das Logo hat keine gültigen Bildmaße.');

  // Große Uploads nicht nochmals in voller Auflösung im Speicher anlegen.
  const scale = Math.min(1, 2048 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Das Logo konnte nicht für das PDF aufbereitet werden.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const normalized = canvas.toDataURL('image/png');
  if (!normalized.startsWith('data:image/png;base64,')) throw new Error('Das Logo konnte nicht als PNG gelesen werden.');
  return { source: normalized, format: 'PNG', width, height };
}
