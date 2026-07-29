import { useState } from 'react';
import { X, Download, FileText, AlertCircle, CheckCircle } from 'lucide-react';
import { Invoice } from '../types';
import { formatFileSize, getFileIcon } from '../utils/fileUtils';

interface DownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownload: (formats: ('zugferd' | 'xrechnung')[], markAsSent: boolean, selectedAttachmentIds: string[]) => void;
  invoice: Invoice;
  isLoading: boolean;
  isBulkMode?: boolean;
  bulkCount?: number;
}

export function DownloadModal({
  isOpen,
  onClose,
  onDownload,
  invoice,
  isLoading,
  isBulkMode = false,
  bulkCount = 0
}: DownloadModalProps) {
  const [selectedFormats, setSelectedFormats] = useState<('zugferd' | 'xrechnung')[]>(['zugferd']);
  const [markAsSent, setMarkAsSent] = useState<boolean>(true);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);

  // Check if invoice is already paid - should not change status back to sent
  const isPaid = invoice && invoice.status === 'paid';
  const canMarkAsSent = !isPaid;

  if (!isOpen) return null;

  const handleFormatToggle = (format: 'zugferd' | 'xrechnung') => {
    setSelectedFormats(prev => {
      const newFormats = prev.includes(format) 
        ? prev.filter(f => f !== format)
        : [...prev, format];
      
      // Mindestens ein Format muss ausgewählt sein
      return newFormats.length === 0 ? ['zugferd'] : newFormats;
    });
  };

  const isFormatDisabled = (format: 'zugferd' | 'xrechnung') => {
    return false; // Keine Beschränkungen mehr
  };

  const formatOptions = [
    {
      value: 'zugferd' as const,
      label: 'PDF',
      description: 'eRechnungskonforme PDF-Rechnung (ZUGFeRD)',
      icon: FileText
    },
    {
      value: 'xrechnung' as const,
      label: 'XRechnung (XML)',
      description: 'Strukturierte XML-Rechnung (eRechnungskonform)',
      icon: FileText
    }
  ];

  const handleDownload = () => {
    onDownload(selectedFormats, markAsSent && canMarkAsSent, selectedAttachmentIds);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 lg:p-6 border-b border-gray-200">
          <div className="flex items-center space-x-2 lg:space-x-3">
            <div className="p-2 rounded-full bg-green-100">
              <Download className="h-5 w-5 lg:h-6 lg:w-6 text-green-600" />
            </div>
            <h3 className="text-base lg:text-lg font-semibold text-gray-900">
              {isBulkMode ? `${bulkCount} Rechnungen herunterladen` : 'Rechnung herunterladen'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 p-1"
            disabled={isLoading}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
          {/* Rechnung Details */}
          <div className="bg-primary-custom/10 border border-primary-custom/30 rounded-lg p-3 lg:p-4">
            <h4 className="text-sm font-semibold text-primary-custom mb-2">
              📄 Download Details
            </h4>
            {isBulkMode ? (
              <p className="text-sm text-primary-custom">
                <strong>Anzahl Rechnungen:</strong> {bulkCount}<br/>
                <strong>Aktion:</strong> Bulk-Download
              </p>
            ) : (
              <p className="text-sm text-primary-custom">
                <strong>Rechnung:</strong> {invoice.invoiceNumber}<br/>
                <strong>Kunde:</strong> {invoice.customerName}<br/>
                <strong>Betrag:</strong> €{invoice.total.toFixed(2)}<br/>
                <strong>Status:</strong> {invoice.status === 'draft' ? 'Entwurf' : 
                                       invoice.status === 'sent' ? 'Versendet' :
                                       invoice.status === 'paid' ? 'Bezahlt' : 
                                       invoice.status === 'overdue' ? 'Überfällig' : invoice.status}
              </p>
            )}
          </div>
          
          {/* Format Selection */}
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-3">
              Wählen Sie die gewünschten Dateiformate (Mehrfachauswahl möglich):
            </h4>
            
            <div className="space-y-3">
              {formatOptions.map((option) => {
                const IconComponent = option.icon;
                const isSelected = selectedFormats.includes(option.value);
                const isDisabled = isFormatDisabled(option.value);
                
                return (
                  <label
                    key={option.value}
                    className={`block p-3 lg:p-4 border rounded-lg cursor-pointer transition-colors ${
                      isDisabled 
                        ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-50'
                        : isSelected
                        ? 'border-green-500 bg-green-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isDisabled}
                        onChange={() => !isDisabled && handleFormatToggle(option.value)}
                        className="mt-1 h-4 w-4 text-green-600 border-gray-300 focus:ring-green-500 disabled:opacity-50 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 mb-1">
                          <IconComponent className="h-4 w-4 text-gray-600 flex-shrink-0" />
                          <span className="text-sm font-medium text-gray-900">
                            {option.label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600">
                          {option.description}
                        </p>

                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            
            {selectedFormats.length > 1 && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-xs text-green-800">
                  <strong>✓ Ausgewählt:</strong> {selectedFormats.map(f => {
                    const option = formatOptions.find(opt => opt.value === f);
                    return option?.label;
                  }).join(', ')}
                </p>
              </div>
            )}
          </div>

          {/* Attachment Selection */}
          {!isBulkMode && invoice && invoice.attachments && invoice.attachments.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-900">
                  Anhänge zum Download auswählen ({selectedAttachmentIds.length} von {invoice.attachments.length} ausgewählt)
                </h4>
                <button
                  onClick={() => {
                    const allSelected = invoice.attachments!.length > 0 && 
                                      invoice.attachments!.every(att => selectedAttachmentIds.includes(att.id));
                    if (allSelected) {
                      setSelectedAttachmentIds([]);
                    } else {
                      setSelectedAttachmentIds(invoice.attachments!.map(att => att.id));
                    }
                  }}
                  className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
                >
                  {invoice.attachments.length > 0 && 
                   invoice.attachments.every(att => selectedAttachmentIds.includes(att.id)) ? (
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
              </div>
              
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {invoice.attachments.map((attachment) => (
                  <label
                    key={attachment.id}
                    className="flex items-center space-x-3 p-3 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-100"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAttachmentIds.includes(attachment.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedAttachmentIds(prev => [...prev, attachment.id]);
                        } else {
                          setSelectedAttachmentIds(prev => prev.filter(id => id !== attachment.id));
                        }
                      }}
                      className="custom-checkbox"
                    />
                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                      <span className="text-lg" role="img" aria-label="file">
                        {getFileIcon(attachment.name)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {attachment.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatFileSize(attachment.size)} • {new Date(attachment.uploadedAt).toLocaleDateString('de-DE')}
                        </p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              
              <p className="text-xs text-gray-500 mt-2">
                💡 Ausgewählte Anhänge werden zusammen mit der Rechnung heruntergeladen
              </p>
            </div>
          )}

          {/* Mark as Sent Option */}
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <AlertCircle className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-orange-900 mb-2">
                  Status beim Download ändern
                </h4>
                <p className="text-sm text-orange-800 mb-3">
                  {isBulkMode 
                    ? 'Möchten Sie alle ausgewählten Rechnungen beim Download automatisch als "Versendet" markieren?'
                    : isPaid
                    ? 'Diese Rechnung ist bereits bezahlt. Der Status kann nicht auf "Versendet" zurückgesetzt werden.'
                    : 'Möchten Sie diese Rechnung beim Download automatisch als "Versendet" markieren?'
                  }
                </p>
                <label className={`flex items-center space-x-3 ${canMarkAsSent ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={markAsSent && canMarkAsSent}
                      onChange={() => canMarkAsSent && setMarkAsSent(!markAsSent)}
                      disabled={!canMarkAsSent}
                      className="sr-only"
                    />
                    <div className={`w-4 h-4 border-2 rounded flex items-center justify-center transition-colors ${
                      markAsSent && canMarkAsSent
                        ? 'bg-orange-600 border-orange-600' 
                        : canMarkAsSent
                        ? 'bg-white border-orange-300 hover:border-orange-400'
                        : 'bg-gray-200 border-gray-300'
                    }`}>
                      {markAsSent && canMarkAsSent && (
                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <span className={`text-sm font-medium ${canMarkAsSent ? 'text-orange-900' : 'text-gray-500'}`}>
                    Als "Versendet" markieren
                    {!canMarkAsSent && ' (nicht verfügbar für bezahlte Rechnungen)'}
                  </span>
                </label>
              </div>
            </div>
          </div>
          
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-xs text-green-800">
              <strong>💡 Hinweis:</strong> Der Download startet automatisch nach der Bestätigung. 
              {selectedFormats.length > 1 && ' Bei mehreren Dateien erfolgt der Download mit Abständen.'}
              {isBulkMode && ' Bei Bulk-Downloads werden längere Pausen zwischen den Downloads eingehalten.'}
              {' Sie können wählen, ob die Rechnung(en) dabei als versendet markiert werden sollen.'}
            </p>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row justify-end gap-3 p-4 lg:p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 order-2 sm:order-1"
          >
            Abbrechen
          </button>
          <button
            onClick={handleDownload}
            disabled={isLoading}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 order-1 sm:order-2"
          >
            {isLoading ? (
              <>
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                <span className="hidden sm:inline">Wird heruntergeladen...</span>
                <span className="sm:hidden">Download...</span>
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {selectedFormats.length === 1 
                    ? (selectedFormats[0] === 'zugferd' ? 'PDF' : 'XRechnung')
                    : `${selectedFormats.length} Dateien`} herunterladen
                  {isBulkMode && ` (${bulkCount} Rechnungen)`}
                  {markAsSent && canMarkAsSent && ' & als versendet markieren'}
                </span>
                <span className="sm:hidden">Herunterladen</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
