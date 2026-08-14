import React, { useState } from 'react';
import logger from '../utils/logger';
import { 
  Paperclip, 
  Upload, 
  X, 
  Download, 
  FileText, 
  Image, 
  File,
  AlertCircle,
  CheckCircle,
  Eye
} from 'lucide-react';
import { JobAttachment, InvoiceAttachment } from '../types';
import { fileToBase64, formatFileSize, validateFile, generateUniqueFileName } from '../utils/fileUtils';
import { generateUUID } from '../utils/uuid';
import { useCompany } from '../context/CompanyContext';
import { formatDate } from '../utils/formatters';
import { useFeedback } from '../context/FeedbackContext';

interface AttachmentManagerProps {
  attachments: (JobAttachment | InvoiceAttachment)[];
  onAttachmentsChange: (attachments: (JobAttachment | InvoiceAttachment)[]) => void;
  allowUpload?: boolean;
  allowSelection?: boolean;
  selectedAttachmentIds?: string[];
  onSelectionChange?: (selectedIds: string[]) => void;
  maxFileSize?: number; // in MB
  title?: string;
  uploadAreaClassName?: string;
  allowPreview?: boolean;
  onPreview?: (attachments: (JobAttachment | InvoiceAttachment)[], initialIndex: number) => void;
}

export function AttachmentManager({
  attachments,
  onAttachmentsChange,
  allowUpload = true,
  allowSelection = false,
  selectedAttachmentIds = [],
  onSelectionChange,
  maxFileSize = 25,
  title = 'Anhänge',
  uploadAreaClassName = '',
  allowPreview = false,
  onPreview
}: AttachmentManagerProps) {
  const { notify } = useFeedback();
  const { company } = useCompany();
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFileUpload = async (files: FileList) => {
    setUploading(true);
    setUploadError(null);
    
    try {
      const newAttachments: (JobAttachment | InvoiceAttachment)[] = [];
      
      // Get existing file names for uniqueness check
      const existingNames = attachments.map(att => att.name);
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Validate file
        const validation = validateFile(file, maxFileSize);
        if (!validation.valid) {
          setUploadError(validation.error || 'Ungültige Datei');
          continue;
        }
        
        // Generate unique filename
        const uniqueFileName = generateUniqueFileName(file.name, [
          ...existingNames,
          ...newAttachments.map(att => att.name)
        ]);
        
        // Convert to base64
        const base64Content = await fileToBase64(file);
        
        const attachment: JobAttachment | InvoiceAttachment = {
          id: generateUUID(),
          name: uniqueFileName,
          content: base64Content,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          uploadedAt: new Date()
        };
        
        newAttachments.push(attachment);
      }
      
      if (newAttachments.length > 0) {
        onAttachmentsChange([...attachments, ...newAttachments]);
      }
    } catch (error) {
      logger.error('Fehler beim Hochladen der Anhänge:', error);
      setUploadError('Fehler beim Hochladen der Dateien');
    } finally {
      setUploading(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const removeAttachment = (id: string) => {
    const updatedAttachments = attachments.filter(att => att.id !== id);
    onAttachmentsChange(updatedAttachments);
    
    // Update selection if needed
    if (allowSelection && onSelectionChange && selectedAttachmentIds.includes(id)) {
      onSelectionChange(selectedAttachmentIds.filter(selectedId => selectedId !== id));
    }
  };

  const downloadAttachment = (attachment: JobAttachment | InvoiceAttachment) => {
    try {
      // Convert base64 to blob
      const byteCharacters = atob(attachment.content);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: attachment.contentType });
      
      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      logger.error('Fehler beim Download des Anhangs:', error);
      notify({ variant: 'error', message: 'Fehler beim Download der Datei' });
    }
  };

  const handleSelectionChange = (attachmentId: string, selected: boolean) => {
    if (!onSelectionChange) return;
    
    let newSelection = [...selectedAttachmentIds];
    
    if (selected) {
      if (!newSelection.includes(attachmentId)) {
        newSelection.push(attachmentId);
      }
    } else {
      newSelection = newSelection.filter(id => id !== attachmentId);
    }
    
    onSelectionChange(newSelection);
  };

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    
    const allSelected = attachments.length > 0 && attachments.every(att => selectedAttachmentIds.includes(att.id));
    
    if (allSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(attachments.map(att => att.id));
    }
  };

  const getFileIconComponent = (contentType: string) => {
    if (contentType.startsWith('image/')) {
      return <Image className="h-4 w-4 text-blue-500" />;
    } else if (contentType === 'application/pdf') {
      return <FileText className="h-4 w-4 text-red-500" />;
    } else {
      return <File className="h-4 w-4 text-gray-500" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center text-lg font-semibold text-gray-900">
          <Paperclip className="h-5 w-5 mr-2" />
          {title}
          {attachments.length > 0 && (
            <span className="ml-2 text-sm text-gray-500">({attachments.length})</span>
          )}
        </h3>
        
        {allowSelection && attachments.length > 0 && (
          <button
            onClick={handleSelectAll}
            className="text-sm text-primary-custom hover:text-primary-custom/80 flex items-center"
          >
            {attachments.length > 0 && attachments.every(att => selectedAttachmentIds.includes(att.id)) ? (
              <>
                <X className="h-4 w-4 mr-1" />
                Alle abwählen
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-1" />
                Alle auswählen
              </>
            )}
          </button>
        )}
      </div>

      {/* Upload Area */}
      {allowUpload && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`border-2 border-dashed rounded-lg p-3 sm:p-4 text-center transition-colors ${uploadAreaClassName} ${
            dragOver 
              ? 'border-primary-custom bg-primary-custom/5' 
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <input
            type="file"
            id="attachment-upload"
            multiple
            onChange={handleFileInputChange}
            className="hidden"
            accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.gif,.xls,.xlsx"
          />
          
          <Upload className="h-6 w-6 text-gray-400 mx-auto mb-1" />
          <p className="text-sm text-gray-600 mb-2">
            Dateien hier ablegen oder{' '}
            <label htmlFor="attachment-upload" className="text-primary-custom hover:text-primary-custom/80 cursor-pointer">
              durchsuchen
            </label>
          </p>
          <p className="text-xs text-gray-500">
            Unterstützte Formate: PDF, Word, Text, Bilder, Excel (max. {maxFileSize}MB)
          </p>
          
          {uploading && (
            <div className="mt-2 flex items-center justify-center text-sm text-gray-600">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-custom mr-2"></div>
              Dateien werden hochgeladen...
            </div>
          )}
          
          {uploadError && (
            <div className="mt-2 flex items-center justify-center text-sm text-red-600">
              <AlertCircle className="h-4 w-4 mr-1" />
              {uploadError}
            </div>
          )}
        </div>
      )}

      {/* Attachments List */}
      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
            >
              <div className="flex items-center space-x-3 flex-1 min-w-0">
                {allowSelection && (
                  <input
                    type="checkbox"
                    checked={selectedAttachmentIds.includes(attachment.id)}
                    onChange={(e) => handleSelectionChange(attachment.id, e.target.checked)}
                    className="custom-checkbox"
                  />
                )}
                
                {getFileIconComponent(attachment.contentType)}
                
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {attachment.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatFileSize(attachment.size)} • {formatDate(attachment.uploadedAt, company.locale, company.dateFormat)}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    downloadAttachment(attachment);
                  }}
                  type="button"
                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                  title="Herunterladen"
                >
                  <Download className="h-4 w-4" />
                </button>
                
                {allowPreview && onPreview && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const attachmentIndex = attachments.findIndex(a => a.id === attachment.id);
                      onPreview(attachments, attachmentIndex);
                    }}
                    type="button"
                    className="p-1 text-gray-400 hover:text-green-600 transition-colors"
                    title="Vorschau"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                )}
                
                {allowUpload && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      removeAttachment(attachment.id);
                    }}
                    type="button"
                    className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                    title="Entfernen"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      
      {attachments.length === 0 && !allowUpload && (
        <p className="text-sm text-gray-500 text-center py-4">
          Keine Anhänge vorhanden
        </p>
      )}
    </div>
  );
}
