import { X, User, Settings, DollarSign, Package } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { getTerminology } from '../utils/terminology';

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
  const { company } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
  if (!isOpen) return null;

  const typeLabel = type === 'hourlyRates' ? 'Stundensätze' : 'Materialien';
  const typeIcon = type === 'hourlyRates' ?
    <DollarSign className="h-7 w-7 shrink-0 text-primary-custom" /> :
    <Package className="h-7 w-7 shrink-0 text-primary-custom" />;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-3 sm:p-4">
      <div className="max-h-[calc(100vh-1.5rem)] w-full max-w-md overflow-y-auto rounded-lg bg-white p-4 shadow-2xl sm:max-h-[calc(100vh-2rem)] sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3 sm:mb-5">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {typeIcon}
            <h3 className="text-base font-semibold leading-6 text-gray-900 sm:text-lg">
              {typeLabel} verwalten
            </h3>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 text-gray-400 hover:text-gray-600"
            title="Schließen"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 text-center sm:mb-5">
          <p className="text-sm leading-5 text-gray-600">
            Wo möchten Sie {typeLabel.toLowerCase()} verwalten?
          </p>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => {
              onNavigateToCustomers();
              onClose();
            }}
            className="theme-option-button theme-option-button--primary group w-full rounded-lg border border-primary-custom/30 bg-primary-custom/5 p-3 text-left transition-colors hover:bg-primary-custom/10 sm:p-3.5"
          >
            <div className="flex items-center gap-2.5">
              <User className="h-5 w-5 shrink-0 text-primary-custom" />
              <div>
                <h4 className="text-sm font-medium text-gray-900 group-hover:text-primary-custom sm:text-base">
                  {terminology.entity.specificLabel.charAt(0).toUpperCase() + terminology.entity.specificLabel.slice(1)}
                </h4>
                <p className="text-xs leading-5 text-gray-700 sm:text-sm">
                  {typeLabel} für einzelne {terminology.entity.plural} verwalten
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => {
              onNavigateToSettings();
              onClose();
            }}
            className="theme-option-button theme-option-button--neutral group w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-left transition-colors hover:bg-gray-100 sm:p-3.5"
          >
            <div className="flex items-center gap-2.5">
              <Settings className="h-5 w-5 shrink-0 text-gray-600" />
              <div>
                <h4 className="text-sm font-medium text-gray-900 group-hover:text-gray-800 sm:text-base">
                  {terminology.organization.dataLabel}
                </h4>
                <p className="text-xs leading-5 text-gray-700 sm:text-sm">
                  Standard-{typeLabel.toLowerCase()} in den Einstellungen verwalten
                </p>
              </div>
            </div>
          </button>
        </div>

        <div className="mt-4 border-t border-gray-200 pt-3 sm:mt-5 sm:pt-4">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-200"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
