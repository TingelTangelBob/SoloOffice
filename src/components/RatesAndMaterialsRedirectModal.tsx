import { X, User, Settings, DollarSign, Package } from 'lucide-react';

interface RatesAndMaterialsRedirectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToCustomers: () => void;
  onNavigateToSettings: () => void;
  type: 'hourlyRates' | 'materials';
}

export function RatesAndMaterialsRedirectModal({
  isOpen,
  onClose,
  onNavigateToCustomers,
  onNavigateToSettings,
  type
}: RatesAndMaterialsRedirectModalProps) {
  if (!isOpen) return null;

  const typeLabel = type === 'hourlyRates' ? 'Stundensätze' : 'Materialien';
  const typeIcon = type === 'hourlyRates' ? 
    <DollarSign className="h-8 w-8 text-blue-600" /> : 
    <Package className="h-8 w-8 text-green-600" />;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200] p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center space-x-3">
            {typeIcon}
            <h3 className="text-lg font-semibold text-gray-900">
              {typeLabel} verwalten
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1"
            title="Schließen"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="text-center mb-6">
          <p className="text-gray-600 mb-4">
            Wo möchten Sie {typeLabel.toLowerCase()} verwalten?
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => {
              onNavigateToCustomers();
              onClose();
            }}
            className="w-full bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg p-4 text-left transition-colors group"
          >
            <div className="flex items-center space-x-3">
              <User className="h-6 w-6 text-blue-600" />
              <div>
                <h4 className="font-medium text-blue-900 group-hover:text-blue-800">
                  Kundenspezifisch
                </h4>
                <p className="text-sm text-blue-700">
                  {typeLabel} für einzelne Kunden verwalten
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => {
              onNavigateToSettings();
              onClose();
            }}
            className="w-full bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg p-4 text-left transition-colors group"
          >
            <div className="flex items-center space-x-3">
              <Settings className="h-6 w-6 text-gray-600" />
              <div>
                <h4 className="font-medium text-gray-900 group-hover:text-gray-800">
                  Allgemein
                </h4>
                <p className="text-sm text-gray-700">
                  Standard-{typeLabel.toLowerCase()} in den Einstellungen verwalten
                </p>
              </div>
            </div>
          </button>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
