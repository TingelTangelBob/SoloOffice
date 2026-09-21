import { useState } from 'react';
import { X, Download, FileText, AlertCircle, CheckCircle } from 'lucide-react';
import { Invoice } from '../types';
import { formatFileSize, getFileIcon } from '../utils/fileUtils';
import { useCompany } from '../context/CompanyContext';
import { formatCurrency, formatDate } from '../utils/formatters';
import { formatCountLabel, getTerminology } from '../utils/terminology';
import { DialogShell } from './DialogShell';

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
  const { company } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
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
    <DialogShell
      titleId="download-invoices-dialog-title"
      icon={Download}
      title={isBulkMode ? 'Rechnungen herunterladen' : 'Rechnung herunterladen'}
      description={isBulkMode ? `${formatCountLabel(bulkCount, 'Rechnung', 'Rechnungen')} ausgewählt` : `${invoice.invoiceNumber} · ${invoice.customerName}`}
      onClose={isLoading ? () => {} : onClose}
      size={isBulkMode ? 'lg' : 'md'}
      fitContent
      footer={(
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={isLoading} className="min-h-12 rounded-lg border border-gray-300 bg-white px-5 py-2 text-base font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50">
            Abbrechen
          </button>
          <button type="button" onClick={handleDownload} disabled={isLoading} className="btn-primary inline-flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-lg px-5 py-2 text-base font-semibold text-white transition hover:brightness-90 disabled:opacity-50">
            {isLoading ? (
              <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> <span>Wird heruntergeladen …</span></>
            ) : (
              <><Download className="h-4 w-4 shrink-0" /> <span>Herunterladen{isBulkMode ? ` (${bulkCount})` : ''}</span></>
            )}
          </button>
        </div>
      )}
    >
      <div className="min-w-0 space-y-5 pb-2">
        {!isBulkMode && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm sm:grid-cols-4">
            <div><dt className="text-gray-500">Rechnung</dt><dd className="mt-1 truncate font-medium text-gray-900">{invoice.invoiceNumber}</dd></div>
            <div><dt className="text-gray-500">{terminology.entity.singular}</dt><dd className="mt-1 truncate font-medium text-gray-900">{invoice.customerName}</dd></div>
            <div><dt className="text-gray-500">Betrag</dt><dd className="mt-1 font-medium text-gray-900">{formatCurrency(invoice.total, company.locale, company.numberFormat, company.currency)}</dd></div>
            <div><dt className="text-gray-500">Status</dt><dd className="mt-1 font-medium text-gray-900">{invoice.status === 'draft' ? 'Entwurf' : invoice.status === 'sent' ? 'Versendet' : invoice.status === 'paid' ? 'Bezahlt' : invoice.status === 'overdue' ? 'Überfällig' : invoice.status}</dd></div>
          </dl>
        )}

        <section aria-labelledby="download-format-heading">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="download-format-heading" className="text-base font-semibold text-gray-900">Dateiformat</h3>
            <span className="text-sm text-gray-500">Mehrfachauswahl möglich</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
              {formatOptions.map((option) => {
                const IconComponent = option.icon;
                const isSelected = selectedFormats.includes(option.value);
                const isDisabled = false;
                
                return (
                  <label
                    key={option.value}
                    className={`block rounded-xl border p-3 transition-colors ${
                      isDisabled 
                        ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-50'
                        : isSelected
                        ? 'border-primary-custom bg-primary-custom/10 ring-1 ring-primary-custom/30'
                        : 'border-gray-200 hover:border-primary-custom/50'
                    }`}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isDisabled}
                        onChange={() => !isDisabled && handleFormatToggle(option.value)}
                        className="mt-1 h-4 w-4 shrink-0 accent-primary-custom disabled:opacity-50"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <IconComponent className="h-4 w-4 shrink-0 text-primary-custom" />
                          <span className="text-sm font-semibold text-gray-900">
                            {option.label}
                          </span>
                        </div>
                        <p className="text-xs leading-5 text-gray-500">
                          {option.description}
                        </p>

                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
        </section>

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
                          {formatFileSize(attachment.size)} • {formatDate(attachment.uploadedAt, company.locale, company.dateFormat)}
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
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
            <div className="flex min-w-0 items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-amber-900">Versandstatus</h3>
                <p className="mt-1 text-sm leading-5 text-amber-800">
                  {isBulkMode 
                    ? 'Ausgewählte Rechnungen beim Download als „Versendet“ markieren?'
                    : isPaid
                    ? 'Bereits bezahlte Rechnungen bleiben bezahlt.'
                    : 'Die Rechnung beim Download als „Versendet“ markieren?'
                  }
                </p>
                <label className={`mt-3 flex items-center gap-3 ${canMarkAsSent ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
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
                  <span className={`text-sm font-medium ${canMarkAsSent ? 'text-amber-900' : 'text-gray-500'}`}>
                    Als „Versendet“ markieren{!canMarkAsSent && ' (nicht verfügbar)'}
                  </span>
                </label>
              </div>
            </div>
          </div>
        <p className="text-xs leading-5 text-gray-500">
          Der Download startet nach der Bestätigung. Bei mehreren Rechnungen werden die Dateien nacheinander geladen.
        </p>
      </div>
    </DialogShell>
  );
}
