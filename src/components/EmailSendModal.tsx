import React, { useState } from 'react';
import { X, Mail, FileText, Send, Plus, Trash2, Upload, CheckCircle } from 'lucide-react';
import { Invoice, Quote } from '../types';
import { AttachmentFile, formatFileSize, getFileIcon, validateFile } from '../utils/fileUtils';
import { generateUUID } from '../utils/uuid';
import { useCompany } from '../context/CompanyContext';
import { formatCurrency } from '../utils/formatters';
import { getTerminology } from '../utils/terminology';
import { useFeedback } from '../context/FeedbackContext';

interface EmailSendModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (formats: ('zugferd' | 'xrechnung')[], customText?: string, attachments?: AttachmentFile[], selectedDocumentAttachmentIds?: string[], selectedEmails?: string[], manualEmails?: string[]) => void;
  document: Invoice | Quote; // Can be either invoice or quote
  documentType?: 'invoice' | 'quote'; // Type of document
  customer: { email: string; additionalEmails?: { id: string; email: string; label?: string; isActive: boolean }[] };
  isLoading: boolean;
  isBulkMode?: boolean;
  bulkCount?: number;
}

export function EmailSendModal({
  isOpen,
  onClose,
  onSend,
  document,
  documentType = 'invoice',
  customer,
  isLoading,
  isBulkMode = false,
  bulkCount = 0
}: EmailSendModalProps) {
  const { notify } = useFeedback();
  const { company } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
  const [selectedFormats, setSelectedFormats] = useState<('zugferd' | 'xrechnung')[]>(['zugferd']);
  const [customText, setCustomText] = useState<string>('');
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [showCustomText, setShowCustomText] = useState<boolean>(false);
  const [selectedDocumentAttachmentIds, setSelectedDocumentAttachmentIds] = useState<string[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [manualEmails, setManualEmails] = useState<string[]>(['']);
  const [showManualEmails, setShowManualEmails] = useState<boolean>(false);
  
  // Determine if document is invoice or quote
  const isInvoice = documentType === 'invoice';
  const isQuote = documentType === 'quote';

  // Initialize selected emails when modal opens
  React.useEffect(() => {
    if (isOpen && customer) {
      const allEmails = [];
      // Only add customer email if it exists and is not empty
      if (customer.email && customer.email.trim()) {
        allEmails.push(customer.email);
      }
      if (customer.additionalEmails) {
        allEmails.push(...customer.additionalEmails.filter(e => e.isActive).map(e => e.email));
      }
      setSelectedEmails(allEmails); // Start with all available emails selected
    }
  }, [isOpen, customer]);

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

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    Array.from(files as FileList).forEach((file: File) => {
      // Validate file
      const validation = validateFile(file);
      if (!validation.valid) {
        notify({ variant: 'error', message: validation.error || 'Die Eingabe ist ungültig.' });
        return;
      }

      const newAttachment: AttachmentFile = {
        id: generateUUID(),
        file,
        name: file.name,
        size: file.size
      };

      setAttachments((prev: AttachmentFile[]) => [...prev, newAttachment]);
    });

    // Reset input
    event.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev: AttachmentFile[]) => prev.filter((att: AttachmentFile) => att.id !== id));
  };

  const handleSend = () => {
    const finalManualEmails = manualEmails.filter(email => email.trim() !== '');
    const totalEmailCount = selectedEmails.length + finalManualEmails.length;
    
    // Check if there are any email addresses available
    if (totalEmailCount === 0) {
      const hasCustomerEmail = customer.email && customer.email.trim();
      const hasAdditionalEmails = customer.additionalEmails && customer.additionalEmails.filter(e => e.isActive).length > 0;
      
      if (!hasCustomerEmail && !hasAdditionalEmails) {
        notify({ variant: 'warning', title: 'Keine E-Mail-Adresse vorhanden', message: `Fügen Sie zuerst mindestens eine E-Mail-Adresse in der ${terminology.entity.managementLabel} hinzu oder verwenden Sie die manuelle E-Mail-Eingabe.` });
        return;
      } else {
        notify({ variant: 'warning', message: 'Bitte wählen Sie mindestens eine E-Mail-Adresse aus oder geben Sie eine E-Mail-Adresse manuell ein.' });
        return;
      }
    }
    
    onSend(selectedFormats, showCustomText ? customText : undefined, attachments, selectedDocumentAttachmentIds, selectedEmails, finalManualEmails);
  };

  // Get document labels
  const documentLabel = isQuote ? 'Angebot' : 'Rechnung';
  const documentNumber = isQuote ? (document as Quote).quoteNumber : (document as Invoice).invoiceNumber;

  const formatOptions = isQuote
    ? [{
        value: 'zugferd' as const,
        label: 'PDF',
        description: 'PDF-Angebot',
        icon: FileText,
      }]
    : [
        {
          value: 'zugferd' as const,
          label: 'PDF',
          description: 'eRechnungskonforme PDF-Rechnung (ZUGFeRD)',
          icon: FileText,
        },
        {
          value: 'xrechnung' as const,
          label: 'XRechnung (XML)',
          description: 'Strukturierte XML-Rechnung (eRechnungskonform)',
          icon: FileText,
        },
      ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 lg:p-6 border-b border-gray-200">
          <div className="flex items-center space-x-2 lg:space-x-3">
            <div className="p-2 rounded-full bg-purple-100">
              <Mail className="h-5 w-5 lg:h-6 lg:w-6 text-purple-600" />
            </div>
            <h3 className="text-base lg:text-lg font-semibold text-gray-900">
              {isBulkMode ? `${bulkCount} ${documentLabel}${bulkCount > 1 ? 'en' : ''} per E-Mail versenden` : `${documentLabel} per E-Mail versenden`}
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
          {/* E-Mail Details */}
          <div className="bg-primary-custom/10 border border-primary-custom/30 rounded-lg p-3 lg:p-4">
            <h4 className="text-sm font-semibold text-primary-custom mb-2">
              📧 {documentLabel}sdetails
            </h4>
            <p className="text-sm text-primary-custom">
              <strong>{documentLabel}:</strong> {documentNumber}<br/>
              <strong>Betrag:</strong> {formatCurrency(document.total, company.locale, company.numberFormat, company.currency)}
            </p>
          </div>

          {/* Email Recipients Selection */}
          {!isBulkMode && (
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">
                E-Mail-Empfänger auswählen:
              </h4>

              {/* Customer Emails */}
              <div className="space-y-2 mb-4">
                {/* Primary Email - only show if exists */}
                {customer.email && customer.email.trim() ? (
                  <label className="flex items-center space-x-3 p-3 bg-blue-50 border border-blue-200 rounded-lg cursor-pointer hover:bg-blue-100">
                    <input
                      type="checkbox"
                      checked={selectedEmails.includes(customer.email)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedEmails([...selectedEmails, customer.email]);
                        } else {
                          setSelectedEmails(selectedEmails.filter(email => email !== customer.email));
                        }
                      }}
                      className="custom-checkbox"
                    />
                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                      <Mail className="h-4 w-4 text-blue-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {customer.email}
                        </p>
                        <p className="text-xs text-gray-500">Haupt-E-Mail-Adresse</p>
                      </div>
                    </div>
                  </label>
                ) : (
                  <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <Mail className="h-4 w-4 text-orange-500 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-orange-800">Keine Haupt-E-Mail-Adresse hinterlegt</p>
                        <p className="text-xs text-orange-600">Fügen Sie eine E-Mail-Adresse in der {terminology.entity.managementLabel} hinzu oder nutzen Sie die manuelle Eingabe unten.</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Additional Emails */}
                {customer.additionalEmails && customer.additionalEmails.filter(e => e.isActive).map((additionalEmail) => (
                  <label 
                    key={additionalEmail.id}
                    className="flex items-center space-x-3 p-3 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-100"
                  >
                    <input
                      type="checkbox"
                      checked={selectedEmails.includes(additionalEmail.email)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedEmails([...selectedEmails, additionalEmail.email]);
                        } else {
                          setSelectedEmails(selectedEmails.filter(email => email !== additionalEmail.email));
                        }
                      }}
                      className="custom-checkbox"
                    />
                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                      <Mail className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {additionalEmail.email}
                        </p>
                        {additionalEmail.label && (
                          <p className="text-xs text-gray-500">{additionalEmail.label}</p>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Manual Email Input */}
              <div className="border-t border-gray-200 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h5 className="text-sm font-medium text-gray-700">
                    Zusätzliche E-Mail-Adressen
                  </h5>
                  <button
                    type="button"
                    onClick={() => setShowManualEmails(!showManualEmails)}
                    className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Hinzufügen</span>
                  </button>
                </div>

                {showManualEmails && (
                  <div className="space-y-2">
                    {manualEmails.map((email, index) => (
                      <div key={index} className="flex items-center space-x-2">
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => {
                            const newEmails = [...manualEmails];
                            newEmails[index] = e.target.value;
                            setManualEmails(newEmails);
                          }}
                          placeholder="weitere@email.com"
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        {manualEmails.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const newEmails = manualEmails.filter((_, i) => i !== index);
                              setManualEmails(newEmails);
                            }}
                            className="p-2 text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setManualEmails([...manualEmails, ''])}
                      className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Weitere E-Mail hinzufügen</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Summary */}
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 mt-4">
                <p className="text-sm text-green-800">
                  <strong>📨 Versand an:</strong> {selectedEmails.length + manualEmails.filter(e => e.trim()).length} E-Mail-Adresse{selectedEmails.length + manualEmails.filter(e => e.trim()).length !== 1 ? 'n' : ''}
                </p>
                {selectedEmails.length === 0 && manualEmails.filter(e => e.trim()).length === 0 && (
                  <p className="text-sm text-red-600 mt-1">
                    ⚠️ Bitte wählen Sie mindestens eine E-Mail-Adresse aus
                  </p>
                )}
              </div>
            </div>
          )}
          
          {/* Format Selection - Only for Invoices */}
          {isInvoice && (
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">
                Wählen Sie die Dateiformate für den E-Mail-Anhang (Mehrfachauswahl möglich):
              </h4>
            
            <div className="space-y-3">
              {formatOptions.map((option) => {
                const IconComponent = option.icon;
                const isSelected = selectedFormats.includes(option.value);
                const isDisabled = false;
                
                return (
                  <label
                    key={option.value}
                    className={`block p-3 lg:p-4 border rounded-lg cursor-pointer transition-colors ${
                      isDisabled 
                        ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-50'
                        : isSelected
                        ? 'border-purple-500 bg-purple-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isDisabled}
                        onChange={() => !isDisabled && handleFormatToggle(option.value)}
                        className="custom-checkbox mt-1 disabled:opacity-50 flex-shrink-0"
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
          )}

          {/* Custom Email Text */}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
              <h4 className="text-sm font-medium text-gray-900">
                Eigener E-Mail-Text (optional)
              </h4>
              <button
                type="button"
                onClick={() => setShowCustomText(!showCustomText)}
                className="text-sm text-purple-600 hover:text-purple-700 font-medium self-start sm:self-auto"
              >
                {showCustomText ? 'Standard-Text verwenden' : 'Eigenen Text hinzufügen'}
              </button>
            </div>
            
            {showCustomText && (
              <div className="space-y-2">
                <textarea
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  placeholder="Geben Sie hier Ihren eigenen E-Mail-Text ein. Dieser wird zusätzlich zu den Standard-Rechnungsdetails angezeigt..."
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
                  rows={4}
                />
                <p className="text-xs text-gray-500">
                  💡 Ihr Text wird zusätzlich zu den Standard-Rechnungsinformationen angezeigt
                </p>
              </div>
            )}
          </div>

          {/* Additional Attachments */}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
              <h4 className="text-sm font-medium text-gray-900">
                Zusätzliche Anhänge (optional)
              </h4>
              <div className="relative">
                <input
                  type="file"
                  multiple
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png"
                />
                <button
                  type="button"
                  className="flex items-center space-x-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 transition-colors"
                >
                  <Upload className="h-4 w-4" />
                  <span className="hidden sm:inline">Dateien hinzufügen</span>
                  <span className="sm:hidden">Hinzufügen</span>
                </button>
              </div>
            </div>
            
            {attachments.length > 0 && (
              <div className="space-y-2">
                {attachments.map((attachment) => (
                  <div 
                    key={attachment.id}
                    className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg"
                  >
                    <div className="flex items-center space-x-3 min-w-0 flex-1">
                      <span className="text-lg flex-shrink-0" role="img" aria-label="file">
                        {getFileIcon(attachment.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{attachment.name}</p>
                        <p className="text-xs text-gray-500">{formatFileSize(attachment.size)}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeAttachment(attachment.id)}
                      className="p-1 text-red-500 hover:text-red-700 transition-colors flex-shrink-0 ml-2"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <p className="text-xs text-gray-500 mt-2">
              📎 Unterstützte Formate: PDF, DOC, DOCX, TXT, JPG, PNG (max. 25MB pro Datei)
            </p>
          </div>

          {/* Invoice Attachments Selection */}
          {!isBulkMode && document && document.attachments && document.attachments.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-900">
                  {documentLabel}sanhänge ({selectedDocumentAttachmentIds.length} von {document.attachments.length} ausgewählt)
                </h4>
                <button
                  onClick={() => {
                    const allSelected = document.attachments!.length > 0 && 
                                      document.attachments!.every(att => selectedDocumentAttachmentIds.includes(att.id));
                    if (allSelected) {
                      setSelectedDocumentAttachmentIds([]);
                    } else {
                      setSelectedDocumentAttachmentIds(document.attachments!.map(att => att.id));
                    }
                  }}
                  className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
                >
                  {document.attachments.length > 0 && 
                   document.attachments.every(att => selectedDocumentAttachmentIds.includes(att.id)) ? (
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
              
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {document.attachments.map((attachment) => (
                  <label
                    key={attachment.id}
                    className="flex items-center space-x-3 p-3 bg-blue-50 border border-blue-200 rounded-lg cursor-pointer hover:bg-blue-100"
                  >
                    <input
                      type="checkbox"
                      checked={selectedDocumentAttachmentIds.includes(attachment.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedDocumentAttachmentIds(prev => [...prev, attachment.id]);
                        } else {
                          setSelectedDocumentAttachmentIds(prev => prev.filter(id => id !== attachment.id));
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
                          {formatFileSize(attachment.size)} • bereits zur Rechnung gehörig
                        </p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              
              <p className="text-xs text-gray-500 mt-2">
                💼 Diese Anhänge sind bereits Teil der Rechnung und werden automatisch mitversendet, wenn ausgewählt
              </p>
            </div>
          )}
          
          {/* Summary */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-xs text-green-800">
              <strong>💡 Hinweis:</strong> Nach erfolgreichem Versand wird die Rechnung automatisch 
              als "Versendet" markiert, falls sie sich noch im Entwurf-Status befindet.
            </p>
          </div>
        </div>
        
        <div className="form-action-bar border-t border-gray-200 p-4 lg:p-6">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSend}
            disabled={isLoading || (selectedEmails.length === 0 && manualEmails.filter(e => e.trim()).length === 0)}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                <span className="hidden sm:inline">Wird versendet...</span>
                <span className="sm:hidden">Sende...</span>
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                <span className="hidden sm:inline">
                  E-Mail versenden 
                  ({selectedFormats.length} Format{selectedFormats.length > 1 ? 'e' : ''}
                  {!isBulkMode && `, ${selectedEmails.length + manualEmails.filter(e => e.trim()).length} Empfänger`}
                  {attachments.length > 0 && `, +${attachments.length} Anhang${attachments.length > 1 ? 'e' : ''}`})
                </span>
                <span className="sm:hidden">Versenden</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
