import { useState } from 'react';
import { Clock, Edit2, Package, Plus, Trash2, Upload } from 'lucide-react';
import logger from '../utils/logger';
import { useCompany } from '../context/CompanyContext';
import { useFeedback } from '../context/FeedbackContext';
import { getTerminology } from '../utils/terminology';
import { formatCurrency, getCurrencySymbol } from '../utils/formatters';
import { apiService } from '../services/api';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { DialogShell } from './DialogShell';
import { ImportWizard } from './ImportWizard';
import type { HourlyRate, ImportResource, MaterialTemplate, NumberFormat } from '../types';

/**
 * Positionsvorlagen: Stundensätze und Materialien.
 *
 * Bis hierhin lag die Pflege in den Einstellungen unter „Rechnungen“, während
 * die Vorlagen nur eine Zusammenfassung mit Verweis dorthin zeigten – zwei
 * Orte für eine Sache. Jetzt liegt alles hier: Listen, Anlegen, Bearbeiten,
 * Löschen, Import und die Anzeigeoption für die Auswahlfelder.
 *
 * Die Anzeigeoption wird sofort gespeichert. Sie war zuvor Teil des großen
 * Einstellungsformulars und brauchte dessen Speichern-Knopf; als einzelner
 * Schalter ohne Formular drumherum wäre das nur noch verwirrend.
 */
export function PositionTemplatesPanel() {
  const { notify } = useFeedback();
  const {
    company,
    updateCompany,
    hourlyRates,
    setHourlyRates,
    materialTemplates,
    setMaterialTemplates,
    addHourlyRate,
    updateHourlyRate,
    deleteHourlyRate,
    addMaterialTemplate,
    updateMaterialTemplate,
    deleteMaterialTemplate,
  } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
  const locale = company.locale || 'de-DE';
  const currencySymbol = getCurrencySymbol(locale, company.numberFormat, company.currency);
  const money = (value: number) => formatCurrency(value, locale, company.numberFormat, company.currency);

  const [editingRate, setEditingRate] = useState<HourlyRate | null>(null);
  const [isAddingRate, setIsAddingRate] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialTemplate | null>(null);
  const [isAddingMaterial, setIsAddingMaterial] = useState(false);
  const [importResource, setImportResource] = useState<ImportResource | null>(null);

  const handleSaveRate = async (rate: Omit<HourlyRate, 'id'>) => {
    try {
      if (editingRate) {
        await updateHourlyRate(editingRate.id, rate);
      } else {
        await addHourlyRate(rate);
      }
      setEditingRate(null);
      setIsAddingRate(false);
      notify({ variant: 'success', message: 'Stundensatz wurde gespeichert.' });
    } catch (error) {
      logger.error('Error saving hourly rate:', { error: error instanceof Error ? error.message : String(error) });
      notify({ variant: 'error', message: 'Der Stundensatz konnte nicht gespeichert werden.' });
    }
  };

  const handleDeleteRate = async (id: string) => {
    try {
      await deleteHourlyRate(id);
      notify({ variant: 'success', message: 'Stundensatz wurde gelöscht.' });
    } catch (error) {
      logger.error('Error deleting hourly rate:', { error: error instanceof Error ? error.message : String(error) });
      notify({ variant: 'error', message: 'Der Stundensatz konnte nicht gelöscht werden.' });
    }
  };

  const handleSaveMaterial = async (material: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      if (editingMaterial) {
        await updateMaterialTemplate(editingMaterial.id, material);
      } else {
        await addMaterialTemplate(material);
      }
      setEditingMaterial(null);
      setIsAddingMaterial(false);
      notify({ variant: 'success', message: 'Materialvorlage wurde gespeichert.' });
    } catch (error) {
      logger.error('Error saving material template:', { error: error instanceof Error ? error.message : String(error) });
      notify({ variant: 'error', message: 'Die Materialvorlage konnte nicht gespeichert werden.' });
    }
  };

  const handleDeleteMaterial = async (id: string) => {
    try {
      await deleteMaterialTemplate(id);
      notify({ variant: 'success', message: 'Materialvorlage wurde gelöscht.' });
    } catch (error) {
      logger.error('Error deleting material template:', { error: error instanceof Error ? error.message : String(error) });
      notify({ variant: 'error', message: 'Die Materialvorlage konnte nicht gelöscht werden.' });
    }
  };

  const handleCombinedDropdownsChange = async (checked: boolean) => {
    try {
      await updateCompany({ showCombinedDropdowns: checked });
    } catch (error) {
      logger.error('Error saving dropdown preference:', { error: error instanceof Error ? error.message : String(error) });
      notify({ variant: 'error', message: 'Die Anzeigeoption konnte nicht gespeichert werden.' });
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white p-4 lg:p-6">
        <h2 className="text-base font-semibold text-gray-900">Positionsvorlagen</h2>
        <p className="mt-1 text-sm text-gray-500">
          Stundensätze und Materialien werden direkt in Rechnungs- und Angebotspositionen verwendet.
        </p>
        <label className="mt-4 flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <input
            type="checkbox"
            checked={company.showCombinedDropdowns === true}
            onChange={(event) => { void handleCombinedDropdownsChange(event.target.checked); }}
            className="custom-checkbox mt-0.5"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-gray-900">Allgemeine und {terminology.entity.specificLabel} Einträge in Auswahlfeldern kombinieren</span>
            <span className="mt-0.5 block text-xs text-gray-500">
              Zeigt in den Auswahlfeldern für Stundensätze und Materialien beide Arten von Einträgen an. Wird sofort gespeichert.
            </span>
          </span>
        </label>
      </section>

      <PositionList
        title="Stundensätze"
        icon={<Clock className="h-4 w-4 text-primary-custom" aria-hidden="true" />}
        emptyText="Noch keine Stundensätze angelegt."
        addLabel="Stundensatz hinzufügen"
        onAdd={() => setIsAddingRate(true)}
        onImport={() => setImportResource('hourlyRates')}
        items={hourlyRates.map((rate) => ({
          id: rate.id,
          name: rate.name,
          description: rate.description,
          isDefault: rate.isDefault,
          value: `${money(rate.rate)} / Stunde`,
          onEdit: () => setEditingRate(rate),
          onDelete: () => { void handleDeleteRate(rate.id); },
        }))}
      />

      <PositionList
        title="Materialvorlagen"
        icon={<Package className="h-4 w-4 text-primary-custom" aria-hidden="true" />}
        emptyText="Noch keine Materialvorlagen angelegt."
        addLabel="Material hinzufügen"
        onAdd={() => setIsAddingMaterial(true)}
        onImport={() => setImportResource('materials')}
        items={materialTemplates.map((template) => ({
          id: template.id,
          name: template.name,
          description: template.description,
          isDefault: template.isDefault,
          value: `${money(template.unitPrice)} / ${template.unit}`,
          onEdit: () => setEditingMaterial(template),
          onDelete: () => { void handleDeleteMaterial(template.id); },
        }))}
      />

      {importResource && (
        <ImportWizard
          resource={importResource}
          isOpen={true}
          onClose={() => setImportResource(null)}
          onImported={async () => {
            if (importResource === 'hourlyRates') setHourlyRates(await apiService.getHourlyRates());
            if (importResource === 'materials') setMaterialTemplates(await apiService.getMaterialTemplates());
          }}
        />
      )}

      {(isAddingRate || editingRate) && (
        <HourlyRateModal
          rate={editingRate}
          currencySymbol={currencySymbol}
          locale={locale}
          numberFormat={company.numberFormat}
          onSave={handleSaveRate}
          onClose={() => {
            setIsAddingRate(false);
            setEditingRate(null);
          }}
        />
      )}

      {(isAddingMaterial || editingMaterial) && (
        <MaterialTemplateModal
          template={editingMaterial}
          currencySymbol={currencySymbol}
          locale={locale}
          numberFormat={company.numberFormat}
          onSave={handleSaveMaterial}
          onClose={() => {
            setIsAddingMaterial(false);
            setEditingMaterial(null);
          }}
        />
      )}
    </div>
  );
}

interface PositionListItem {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  value: string;
  onEdit: () => void;
  onDelete: () => void;
}

interface PositionListProps {
  title: string;
  icon: React.ReactNode;
  emptyText: string;
  addLabel: string;
  items: PositionListItem[];
  onAdd: () => void;
  onImport: () => void;
}

/**
 * Liste einer Vorlagenart. Beide Arten teilen sich den Aufbau; die
 * Unterschiede liegen nur in Beschriftung und Wertformat.
 */
function PositionList({ title, icon, emptyText, addLabel, items, onAdd, onImport }: PositionListProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 lg:px-6">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h3 className="truncate text-sm font-semibold text-gray-900">{title}</h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 tabular-nums">{items.length}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onImport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Importieren</span>
          </button>
          <button
            type="button"
            onClick={onAdd}
            className="btn-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{addLabel}</span>
          </button>
        </div>
      </div>

      {items.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-2.5 lg:px-6">
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-gray-900">{item.name}</span>
                  {item.isDefault && (
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">Standard</span>
                  )}
                </span>
                {item.description && <span className="mt-0.5 block truncate text-xs text-gray-500">{item.description}</span>}
              </span>
              <span className="shrink-0 font-mono text-sm text-gray-900 tabular-nums">{item.value}</span>
              <span className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={item.onEdit} className="action-icon-button action-icon-blue" aria-label={`${item.name} bearbeiten`} title="Bearbeiten">
                  <Edit2 className="h-4 w-4" />
                </button>
                <button type="button" onClick={item.onDelete} className="action-icon-button action-icon-red" aria-label={`${item.name} löschen`} title="Löschen">
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-gray-500 lg:px-6">{emptyText}</p>
      )}
    </section>
  );
}

// Hourly Rate Modal Component
interface HourlyRateModalProps {
  rate: HourlyRate | null;
  currencySymbol: string;
  locale: string;
  numberFormat?: NumberFormat;
  onSave: (rate: Omit<HourlyRate, 'id'>) => void;
  onClose: () => void;
}

function HourlyRateModal({ rate, currencySymbol, locale, numberFormat, onSave, onClose }: HourlyRateModalProps) {
  const [formData, setFormData] = useState({
    name: rate?.name || '',
    description: rate?.description || '',
    rate: rate?.rate || 0,
    taxRate: rate?.taxRate ?? 19,
    isDefault: rate?.isDefault || false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.name && formData.rate > 0) {
      onSave(formData);
    }
  };

  return (
    <DialogShell
      titleId="hourly-rate-dialog-title"
      icon={Clock}
      title={rate ? 'Stundensatz bearbeiten' : 'Neuer Stundensatz'}
      description="Definieren Sie einen wiederverwendbaren Stundensatz für Angebote und Rechnungen."
      onClose={onClose}
      onSubmit={handleSubmit}
      size="md"
      footer={(
        <>
          <button type="button" onClick={onClose} className="min-h-12 rounded-lg border border-gray-300 bg-white px-6 py-2 text-base font-medium text-gray-700 transition hover:bg-gray-50">Abbrechen</button>
          <button type="submit" className="btn-primary min-h-12 rounded-lg px-6 py-2 text-base font-semibold text-white transition hover:brightness-90">Speichern</button>
        </>
      )}
    >
        <div className="space-y-4 pb-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
              placeholder="z.B. Standard-Stundensatz"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Beschreibung
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
              placeholder="Optionale Beschreibung"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Stundensatz ({currencySymbol}) *
            </label>
            <LocalizedNumberInput
              required
              min="0"
              step="0.01"
              value={formData.rate}
              locale={locale}
              numberFormat={numberFormat}
              onValueChange={(value) => setFormData(prev => ({ ...prev, rate: value === '' ? 0 : value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
              placeholder="0,00"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">MwSt.-Satz</label>
            <select
              value={formData.taxRate}
              onChange={(e) => setFormData(prev => ({ ...prev, taxRate: parseFloat(e.target.value) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
            >
              <option value={0}>0%</option>
              <option value={7}>7%</option>
              <option value={19}>19%</option>
            </select>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isDefaultRate"
              checked={formData.isDefault}
              onChange={(e) => setFormData(prev => ({ ...prev, isDefault: e.target.checked }))}
              className="custom-checkbox"
            />
            <label htmlFor="isDefaultRate" className="ml-2 text-sm text-gray-700">
              Als Standard-Stundensatz festlegen
            </label>
          </div>

        </div>
    </DialogShell>
  );
}

// Material Template Modal Component
interface MaterialTemplateModalProps {
  template: MaterialTemplate | null;
  currencySymbol: string;
  locale: string;
  numberFormat?: NumberFormat;
  onSave: (template: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onClose: () => void;
}

function MaterialTemplateModal({ template, currencySymbol, locale, numberFormat, onSave, onClose }: MaterialTemplateModalProps) {
  const [formData, setFormData] = useState({
    name: template?.name || '',
    description: template?.description || '',
    unitPrice: template?.unitPrice || 0,
    unit: template?.unit || 'Stück',
    taxRate: template?.taxRate ?? 19,
    isDefault: template?.isDefault || false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.name && formData.unitPrice > 0) {
      onSave(formData);
    }
  };

  return (
    <DialogShell
      titleId="material-template-dialog-title"
      icon={Package}
      title={template ? 'Materialvorlage bearbeiten' : 'Neue Materialvorlage'}
      description="Definieren Sie eine wiederverwendbare Position für Angebote und Rechnungen."
      onClose={onClose}
      onSubmit={handleSubmit}
      size="md"
      footer={(
        <>
          <button type="button" onClick={onClose} className="min-h-12 rounded-lg border border-gray-300 bg-white px-6 py-2 text-base font-medium text-gray-700 transition hover:bg-gray-50">Abbrechen</button>
          <button type="submit" className="btn-primary min-h-12 rounded-lg px-6 py-2 text-base font-semibold text-white transition hover:brightness-90">Speichern</button>
        </>
      )}
    >
        <div className="space-y-4 pb-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
              placeholder="z.B. Schrauben M8"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Beschreibung
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
              placeholder="Optionale Beschreibung"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Preis ({currencySymbol}) *
              </label>
              <LocalizedNumberInput
                required
                min="0"
                step="0.01"
                value={formData.unitPrice}
                locale={locale}
                numberFormat={numberFormat}
                onValueChange={(value) => setFormData(prev => ({ ...prev, unitPrice: value === '' ? 0 : value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                placeholder="0,00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Einheit
              </label>
              <input
                type="text"
                value={formData.unit}
                onChange={(e) => setFormData(prev => ({ ...prev, unit: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                placeholder="Stück"
              />
            </div>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isDefaultMaterial"
              checked={formData.isDefault}
              onChange={(e) => setFormData(prev => ({ ...prev, isDefault: e.target.checked }))}
              className="custom-checkbox"
            />
            <label htmlFor="isDefaultMaterial" className="ml-2 text-sm text-gray-700">
              Als Standard-Materialvorlage festlegen
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">MwSt.-Satz</label>
            <select
              value={formData.taxRate}
              onChange={(e) => setFormData(prev => ({ ...prev, taxRate: parseFloat(e.target.value) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
            >
              <option value={0}>0%</option>
              <option value={7}>7%</option>
              <option value={19}>19%</option>
            </select>
          </div>

        </div>
    </DialogShell>
  );
}
