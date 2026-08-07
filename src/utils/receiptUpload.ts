import { apiService } from '../services/api';
import type { Receipt } from '../types';
import { fileToBase64 } from './fileUtils';

export const MAX_RECEIPT_FILE_SIZE = 25 * 1024 * 1024;
export const RECEIPT_UPLOAD_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

const supportedReceiptTypes = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const receiptTypeByExtension: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export interface ReceiptUploadResult {
  created: Receipt[];
  errors: string[];
}

export function getReceiptContentType(file: File): string {
  const declaredType = file.type.toLowerCase();
  if (supportedReceiptTypes.has(declaredType)) return declaredType;
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  return receiptTypeByExtension[extension] || '';
}

export async function uploadReceiptFiles(files: File[]): Promise<ReceiptUploadResult> {
  const created: Receipt[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const contentType = getReceiptContentType(file);
    if (file.size > MAX_RECEIPT_FILE_SIZE) {
      errors.push(`"${file.name}" ist zu groß. Die maximale Größe beträgt 25 MB.`);
      continue;
    }
    if (!contentType) {
      errors.push(`"${file.name}" wird nicht unterstützt. Bitte PDF, JPG, PNG oder WEBP verwenden.`);
      continue;
    }

    try {
      created.push(await apiService.createReceipt({
        name: file.name,
        content: await fileToBase64(file),
        contentType,
        size: file.size,
      }));
    } catch (uploadError) {
      errors.push(uploadError instanceof Error
        ? `"${file.name}": ${uploadError.message}`
        : `"${file.name}" konnte nicht hochgeladen werden.`);
    }
  }

  return { created, errors };
}
