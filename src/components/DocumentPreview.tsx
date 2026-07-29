import React, { useState, useRef, useEffect } from 'react';
import logger from '../utils/logger';
import { 
  X, 
  Download, 
  ZoomIn, 
  ZoomOut, 
  RotateCw,
  FileText,
  Image,
  File,
  Eye,
  Maximize,
  Minimize,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { generateInvoicePDF, generateJobPDF, downloadBlob } from '../utils/pdfGenerator';
import { Invoice, Quote, JobEntry } from '../types';
import { useCustomers } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';

interface DocumentPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  documents?: PreviewDocument[];
  initialIndex?: number;
}

export interface PreviewDocument {
  id: string;
  name: string;
  type: 'invoice-pdf' | 'job-pdf' | 'quote-pdf' | 'attachment';
  size?: number;
  content?: string; // Base64 content for attachments
  contentType?: string;
  // For PDF generation
  invoice?: Invoice;
  job?: JobEntry;
  quote?: Quote;
  pdfFormat?: 'zugferd' | 'xrechnung';
}

export function DocumentPreview({ isOpen, onClose, documents = [], initialIndex = 0 }: DocumentPreviewProps) {
  const { company } = useCompany();
  const { customers } = useCustomers();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0); // For forcing iframe reload
  
  const modalRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Mobile detection
  const isMobile = () => {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (window.innerWidth <= 768);
  };

  const currentDocument = documents[currentIndex];

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  // Load document content when current document changes
  useEffect(() => {
    if (!isOpen || !currentDocument) return;

    loadDocumentContent();
  }, [isOpen, currentDocument, currentIndex]);
  

  // Cleanup URL when component unmounts or closes
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const loadDocumentContent = async () => {
    if (!currentDocument) return;

    setIsLoading(true);
    setError(null);
    
    // Cleanup previous URL before creating new one (prevent memory leaks)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    let temporaryUrl: string | null = null;

    try {
      let blob: Blob;

      if (currentDocument.type === 'attachment' && currentDocument.content) {
        // Handle attachment preview
        const binaryString = atob(currentDocument.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        blob = new Blob([bytes], { type: currentDocument.contentType || 'application/octet-stream' });
      } else if (currentDocument.type === 'invoice-pdf' && currentDocument.invoice) {
        // Generate invoice PDF
        const customer = customers.find(c => c.id === currentDocument.invoice!.customerId);
        if (!customer || !company) {
          throw new Error('Fehlende Kunden- oder Firmendaten');
        }

        blob = await generateInvoicePDF(currentDocument.invoice, {
          format: currentDocument.pdfFormat || 'zugferd',
          company,
          customer
        });
      } else if (currentDocument.type === 'job-pdf' && currentDocument.job) {
        // Generate job PDF
        const customer = customers.find(c => c.id === currentDocument.job!.customerId);
        if (!customer || !company) {
          throw new Error('Fehlende Kunden- oder Firmendaten');
        }

        blob = await generateJobPDF(currentDocument.job, {
          company,
          customer
        });
      } else if (currentDocument.type === 'quote-pdf' && currentDocument.quote) {
        // Generate quote PDF
        const customer = customers.find(c => c.id === currentDocument.quote!.customerId);
        if (!customer) {
          throw new Error('Kunde nicht gefunden');
        }
        if (!company) {
          throw new Error('Firmendaten nicht geladen');
        }

        const { generateQuotePDF } = await import('../utils/pdfGenerator');
        blob = await generateQuotePDF(currentDocument.quote, {
          company,
          customer
        });
      } else {
        throw new Error('Ungültiger Dokumenttyp oder fehlende Daten');
      }

      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setIframeKey(prev => prev + 1); // Force iframe reload
    } catch (err) {
      // Cleanup temporary URL if we created one but failed to set it to state
      if (temporaryUrl) {
        URL.revokeObjectURL(temporaryUrl);
      }
      
      logger.error('Fehler beim Laden des Dokuments:', err);
      setError(err instanceof Error ? err.message : 'Fehler beim Laden des Dokuments');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!currentDocument) return;

    try {
      setIsLoading(true);
      
      let blob: Blob;
      let filename: string;

      if (currentDocument.type === 'attachment' && currentDocument.content) {
        const binaryString = atob(currentDocument.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        blob = new Blob([bytes], { type: currentDocument.contentType || 'application/octet-stream' });
        filename = currentDocument.name;
      } else if (currentDocument.type === 'invoice-pdf' && currentDocument.invoice) {
        const customer = customers.find(c => c.id === currentDocument.invoice!.customerId);
        if (!customer || !company) {
          throw new Error('Fehlende Kunden- oder Firmendaten');
        }

        blob = await generateInvoicePDF(currentDocument.invoice, {
          format: currentDocument.pdfFormat || 'zugferd',
          company,
          customer
        });

        const format = currentDocument.pdfFormat || 'zugferd';
        if (format === 'xrechnung') {
          filename = `${currentDocument.invoice.invoiceNumber}_xrechnung.xml`;
        } else {
          const formatSuffix = format === 'zugferd' ? '' : `_${format}`;
          filename = `${currentDocument.invoice.invoiceNumber}${formatSuffix}.pdf`;
        }
      } else if (currentDocument.type === 'job-pdf' && currentDocument.job) {
        const customer = customers.find(c => c.id === currentDocument.job!.customerId);
        if (!customer || !company) {
          throw new Error('Fehlende Kunden- oder Firmendaten');
        }

        blob = await generateJobPDF(currentDocument.job, {
          company,
          customer
        });
        
        const jobNumber = currentDocument.job.jobNumber || currentDocument.job.id.slice(-8).toUpperCase();
        filename = `Auftrag_${jobNumber}.pdf`;
      } else if (currentDocument.type === 'quote-pdf' && currentDocument.quote) {
        const customer = customers.find(c => c.id === currentDocument.quote!.customerId);
        if (!customer) {
          throw new Error('Kunde nicht gefunden');
        }
        if (!company) {
          throw new Error('Firmendaten nicht geladen');
        }

        const { generateQuotePDF } = await import('../utils/pdfGenerator');
        blob = await generateQuotePDF(currentDocument.quote, {
          company,
          customer
        });
        
        filename = `${currentDocument.quote.quoteNumber.replace(/\//g, '-')}.pdf`;
      } else {
        throw new Error('Ungültiger Dokumenttyp');
      }

      downloadBlob(blob, filename);
    } catch (err) {
      logger.error('Fehler beim Download:', err);
      setError(err instanceof Error ? err.message : 'Fehler beim Download');
    } finally {
      setIsLoading(false);
    }
  };

  const navigateDocument = (direction: 'prev' | 'next') => {
    if (direction === 'prev' && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    } else if (direction === 'next' && currentIndex < documents.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handleZoom = (direction: 'in' | 'out' | 'reset') => {
    switch (direction) {
      case 'in':
        setZoom(prev => Math.min(prev + 25, 300));
        break;
      case 'out':
        setZoom(prev => Math.max(prev - 25, 25));
        break;
      case 'reset':
        setZoom(100);
        break;
    }
  };

  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const getFileIcon = (contentType?: string) => {
    if (!contentType) return <File className="w-4 h-4" />;
    
    if (contentType.startsWith('image/')) {
      return <Image className="w-4 h-4" />;
    } else if (contentType === 'application/pdf' || contentType.includes('pdf')) {
      return <FileText className="w-4 h-4" />;
    } else {
      return <File className="w-4 h-4" />;
    }
  };

  const openPDFInNewTab = () => {
    if (previewUrl) {
      window.open(previewUrl, '_blank');
    }
  };

  const canPreview = (contentType?: string) => {
    // For generated PDFs (invoice-pdf, job-pdf, quote-pdf), we can always preview
    if (currentDocument?.type === 'invoice-pdf' || currentDocument?.type === 'job-pdf' || currentDocument?.type === 'quote-pdf') {
      return true;
    }
    
    // For attachments, check content type
    if (!contentType) return false;
    
    return (
      contentType === 'application/pdf' ||
      contentType.startsWith('image/') ||
      contentType.startsWith('text/')
    );
  };

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleModalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[60]"
      onClick={handleOverlayClick}
    >
      <div 
        ref={modalRef}
        className={`bg-white rounded-lg shadow-xl flex flex-col ${
          isFullscreen ? 'w-full h-full' : 'w-11/12 h-5/6 max-w-6xl max-h-screen'
        }`}
        onClick={handleModalClick}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-gray-50 rounded-t-lg">
          <div className="flex items-center space-x-3">
            {getFileIcon(currentDocument?.contentType)}
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {currentDocument?.name || 'Unbekanntes Dokument'}
              </h3>
              {documents.length > 1 && (
                <p className="text-sm text-gray-500">
                  {currentIndex + 1} von {documents.length} Dokumenten
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Navigation buttons */}
            {documents.length > 1 && (
              <>
                <button
                  onClick={() => navigateDocument('prev')}
                  disabled={currentIndex === 0}
                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Vorheriges Dokument"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => navigateDocument('next')}
                  disabled={currentIndex === documents.length - 1}
                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Nächstes Dokument"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="w-px h-6 bg-gray-300 mx-2" />
              </>
            )}

            {/* Control buttons - Hide zoom/rotate controls on mobile for PDFs */}
            {canPreview(currentDocument?.contentType) && 
             !(isMobile() && (currentDocument?.type === 'invoice-pdf' || currentDocument?.type === 'job-pdf' || currentDocument?.type === 'quote-pdf' || currentDocument?.contentType?.includes('pdf'))) && (
              <>
                <button
                  onClick={() => handleZoom('out')}
                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded"
                  title="Verkleinern"
                >
                  <ZoomOut className="w-5 h-5" />
                </button>
                <span className="text-sm text-gray-600 min-w-[3rem] text-center">
                  {zoom}%
                </span>
                <button
                  onClick={() => handleZoom('in')}
                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded"
                  title="Vergrößern"
                >
                  <ZoomIn className="w-5 h-5" />
                </button>
                <button
                  onClick={handleRotate}
                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded"
                  title="Drehen"
                >
                  <RotateCw className="w-5 h-5" />
                </button>
                <div className="w-px h-6 bg-gray-300 mx-2" />
              </>
            )}

            {/* Mobile PDF - Show open in new tab button in header */}
            {isMobile() && canPreview(currentDocument?.contentType) && 
             (currentDocument?.type === 'invoice-pdf' || currentDocument?.type === 'job-pdf' || currentDocument?.type === 'quote-pdf' || currentDocument?.contentType?.includes('pdf')) && (
              <>
                <button
                  onClick={openPDFInNewTab}
                  className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                  title="In neuem Tab öffnen"
                >
                  <Eye className="w-5 h-5" />
                </button>
                <div className="w-px h-6 bg-gray-300 mx-2" />
              </>
            )}

            <button
              onClick={toggleFullscreen}
              className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded"
              title={isFullscreen ? "Vollbild verlassen" : "Vollbild"}
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>

            <button
              onClick={handleDownload}
              disabled={isLoading}
              className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded disabled:opacity-50"
              title="Herunterladen"
            >
              <Download className="w-5 h-5" />
            </button>

            <button
              onClick={onClose}
              className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded"
              title="Schließen"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex items-center justify-center p-4 bg-gray-100">
          {isLoading && (
            <div className="flex flex-col items-center space-y-3">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="text-gray-600">Dokument wird geladen...</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center space-y-3 text-red-600">
              <File className="w-16 h-16" />
              <p className="text-center">{error}</p>
              <button
                onClick={loadDocumentContent}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Erneut versuchen
              </button>
            </div>
          )}

          {!isLoading && !error && currentDocument && !canPreview(currentDocument.contentType) && (
            <div className="flex flex-col items-center space-y-3 text-gray-600">
              {getFileIcon(currentDocument.contentType)}
              <p className="text-center">
                Vorschau für diesen Dateityp nicht verfügbar.<br />
                Klicken Sie auf "Herunterladen", um die Datei zu öffnen.
              </p>
            </div>
          )}

          {!isLoading && !error && previewUrl && canPreview(currentDocument?.contentType) && (
            <div className="w-full h-full flex items-center justify-center">
              {currentDocument?.contentType?.startsWith('image/') ? (
                <div
                  style={{
                    transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                    transition: 'transform 0.2s ease-in-out',
                  }}
                >
                  <img
                    src={previewUrl}
                    alt={currentDocument.name}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              ) : (
                <>
                  {/* Mobile PDF Handling */}
                  {isMobile() && (currentDocument?.type === 'invoice-pdf' || currentDocument?.type === 'job-pdf' || currentDocument?.type === 'quote-pdf' || currentDocument?.contentType?.includes('pdf')) ? (
                    <div className="flex flex-col items-center space-y-4 text-center p-6">
                      <FileText className="w-16 h-16 text-blue-600" />
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                          {currentDocument.name}
                        </h3>
                        <p className="text-gray-600 mb-4">
                          PDF-Vorschau ist auf mobilen Geräten eingeschränkt.<br />
                          Öffnen Sie das PDF in einem neuen Tab für die beste Ansicht aller Seiten.
                        </p>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <button
                          onClick={openPDFInNewTab}
                          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
                        >
                          <Eye className="w-5 h-5" />
                          <span>In neuem Tab öffnen</span>
                        </button>
                        <button
                          onClick={handleDownload}
                          disabled={isLoading}
                          className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center space-x-2 disabled:opacity-50"
                        >
                          <Download className="w-5 h-5" />
                          <span>Herunterladen</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Desktop PDF Handling */
                    <div 
                      className="w-full h-full flex items-center justify-center"
                      style={{
                        transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                        transition: 'transform 0.2s ease-in-out',
                      }}
                    >
                      <iframe
                        key={iframeKey}
                        ref={iframeRef}
                        src={previewUrl}
                        className="w-full h-full border-0"
                        title={currentDocument?.name}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer with document info */}
        {currentDocument && (
          <div className="px-4 py-2 bg-gray-50 border-t text-sm text-gray-600 rounded-b-lg">
            <div className="flex justify-between items-center">
              <span>
                {currentDocument.type === 'attachment' && currentDocument.size && (
                  `Größe: ${(currentDocument.size / 1024 / 1024).toFixed(2)} MB`
                )}
                {currentDocument.contentType && (
                  <span className="ml-2">
                    Typ: {currentDocument.contentType}
                  </span>
                )}
              </span>
              
              {documents.length > 1 && (
                <span className="hidden sm:inline">
                  Verwenden Sie die Pfeiltasten oder die Navigationsbuttons zum Wechseln zwischen Dokumenten
                </span>
              )}
              {documents.length > 1 && (
                <span className="sm:hidden">
                  Verwenden Sie die Navigationsbuttons zum Wechseln zwischen Dokumenten
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper function to create preview documents from invoice attachments
export function createInvoiceAttachmentPreviewDocuments(
  invoice: Invoice
): PreviewDocument[] {
  const documents: PreviewDocument[] = [];

  // Add only the ZUGFeRD PDF (the version that would be sent via email)
  documents.push({
    id: `invoice-pdf-${invoice.id}`,
    name: `Rechnung_${invoice.invoiceNumber}.pdf`,
    type: 'invoice-pdf',
    invoice,
    pdfFormat: 'zugferd'
  });

  // Add attachments
  if (invoice.attachments) {
    invoice.attachments.forEach(attachment => {
      documents.push({
        id: attachment.id,
        name: attachment.name,
        type: 'attachment',
        content: attachment.content,
        contentType: attachment.contentType,
        size: attachment.size
      });
    });
  }

  return documents;
}

// Helper function to create preview documents from quote attachments
export function createQuoteAttachmentPreviewDocuments(
  quote: Quote
): PreviewDocument[] {
  const documents: PreviewDocument[] = [];

  // Add the quote PDF itself
  documents.push({
    id: `quote-pdf-${quote.id}`,
    name: `Angebot_${quote.quoteNumber}.pdf`,
    type: 'quote-pdf',
    quote
  });

  // Add attachments
  if (quote.attachments) {
    quote.attachments.forEach(attachment => {
      documents.push({
        id: attachment.id,
        name: attachment.name,
        type: 'attachment',
        content: attachment.content,
        contentType: attachment.contentType,
        size: attachment.size
      });
    });
  }

  return documents;
}

// Helper function to create preview documents from job attachments
export function createJobAttachmentPreviewDocuments(
  job: JobEntry
): PreviewDocument[] {
  const documents: PreviewDocument[] = [];

  // Add the job PDF itself
  documents.push({
    id: `job-pdf-${job.id}`,
    name: `Auftrag_${job.jobNumber || job.id.slice(-8).toUpperCase()}.pdf`,
    type: 'job-pdf',
    job
  });

  // Add attachments
  if (job.attachments) {
    job.attachments.forEach(attachment => {
      documents.push({
        id: attachment.id,
        name: attachment.name,
        type: 'attachment',
        content: attachment.content,
        contentType: attachment.contentType,
        size: attachment.size
      });
    });
  }

  return documents;
}
