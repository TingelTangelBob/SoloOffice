/**
 * Utility functions for file handling
 */

import logger from './logger';

export interface AttachmentFile {
  id: string;
  file: File;
  name: string;
  size: number;
}

export interface ProcessedAttachment {
  name: string;
  content: string; // Base64 content
  contentType: string;
}

/**
 * Convert a File to base64 string
 */
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix (e.g., "data:application/pdf;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Process attachments from File objects to API format
 */
export const processAttachments = async (attachments: AttachmentFile[]): Promise<ProcessedAttachment[]> => {
  const processedAttachments: ProcessedAttachment[] = [];
  
  for (const attachment of attachments) {
    try {
      const base64Content = await fileToBase64(attachment.file);
      
      processedAttachments.push({
        name: attachment.name,
        content: base64Content,
        contentType: attachment.file.type || 'application/octet-stream'
      });
    } catch (error) {
      logger.error('Fehler beim Verarbeiten des Anhangs', { fileName: attachment.name, error });
      throw new Error(`Fehler beim Verarbeiten der Datei "${attachment.name}"`);
    }
  }
  
  return processedAttachments;
};

/**
 * Format file size to human readable string
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Get file icon based on file type
 */
export const getFileIcon = (fileName: string): string => {
  const extension = fileName.split('.').pop()?.toLowerCase();
  
  switch (extension) {
    case 'pdf':
      return '📄';
    case 'doc':
    case 'docx':
      return '📝';
    case 'txt':
      return '📄';
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
      return '🖼️';
    case 'xls':
    case 'xlsx':
      return '📊';
    default:
      return '📎';
  }
};

/**
 * Generate a unique filename to avoid conflicts
 */
export const generateUniqueFileName = (originalName: string, existingNames: string[]): string => {
  // Extract file extension
  const lastDotIndex = originalName.lastIndexOf('.');
  const extension = lastDotIndex !== -1 ? originalName.substring(lastDotIndex) : '';
  const nameWithoutExtension = lastDotIndex !== -1 ? originalName.substring(0, lastDotIndex) : originalName;
  
  // Add timestamp to make it more unique
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').substring(0, 19);
  
  // Create base name with timestamp
  const uniqueName = `${nameWithoutExtension}_${timestamp}${extension}`;
  
  // If still conflicts, add counter
  let counter = 1;
  let finalName = uniqueName;
  
  while (existingNames.includes(finalName)) {
    finalName = `${nameWithoutExtension}_${timestamp}_${counter}${extension}`;
    counter++;
  }
  
  return finalName;
};

/**
 * Validate file type and size
 */
export const validateFile = (file: File, maxSizeInMB: number = 25): { valid: boolean; error?: string } => {
  // Check file size
  if (file.size > maxSizeInMB * 1024 * 1024) {
    return {
      valid: false,
      error: `Datei "${file.name}" ist zu groß. Maximale Größe: ${maxSizeInMB}MB`
    };
  }
  
  // Check file type (basic validation)
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  
  if (!allowedTypes.includes(file.type) && file.type !== '') {
    // Allow files without type (fallback for some systems)
    const extension = file.name.split('.').pop()?.toLowerCase();
    const allowedExtensions = ['pdf', 'doc', 'docx', 'txt', 'jpg', 'jpeg', 'png', 'gif', 'xls', 'xlsx'];
    
    if (!extension || !allowedExtensions.includes(extension)) {
      return {
        valid: false,
        error: `Dateityp "${file.type || 'unbekannt'}" wird nicht unterstützt.`
      };
    }
  }
  
  return { valid: true };
};
