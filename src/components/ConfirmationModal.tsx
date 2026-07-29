import { AlertTriangle, X } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  isGoBDWarning?: boolean;
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Bestätigen',
  cancelText = 'Abbrechen',
  isDestructive = false,
  isGoBDWarning = false
}: ConfirmationModalProps) {
  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-full ${isGoBDWarning ? 'bg-amber-100' : isDestructive ? 'bg-red-100' : 'bg-primary-custom/10'}`}>
              <AlertTriangle className={`h-6 w-6 ${isGoBDWarning ? 'text-amber-600' : isDestructive ? 'text-red-600' : 'text-primary-custom'}`} />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="p-6">
          {isGoBDWarning && (
            <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <h4 className="text-sm font-semibold text-amber-800 mb-2">
                ⚠️ GoBD-Konformitätshinweis
              </h4>
              <p className="text-sm text-amber-700">
                Nach den Grundsätzen zur ordnungsmäßigen Führung und Aufbewahrung von Büchern (GoBD) 
                sind Änderungen an bereits versendeten Rechnungen kritisch zu bewerten.
              </p>
            </div>
          )}
          
          <p className="text-gray-600 leading-relaxed">{message}</p>
        </div>
        
        <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            className={`px-4 py-2 rounded-lg text-white transition-colors ${
              isDestructive 
                ? 'bg-red-600 hover:bg-red-700' 
                : isGoBDWarning
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'btn-primary'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
