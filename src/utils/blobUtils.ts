/**
 * Utility functions for handling blob and base64 conversions
 */

/**
 * Safely converts a Blob to base64 string without causing stack overflow
 * This method processes the data in chunks to avoid "Maximum call stack size exceeded" errors
 * that can occur with large files when using the spread operator approach.
 * 
 * @param blob - The Blob to convert
 * @returns Promise<string> - The base64 encoded string
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  // Convert to base64 safely without causing stack overflow
  let binaryString = '';
  const chunkSize = 8192; // Process in chunks to avoid stack overflow
  
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.slice(i, i + chunkSize);
    binaryString += String.fromCharCode.apply(null, Array.from(chunk));
  }
  
  return btoa(binaryString);
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
