import React, { useState, useEffect, useCallback, useRef } from 'react';
import logger from '../utils/logger';
import { Save, Trash2, Calculator, GripVertical, Percent, Eye, FileText, Plus, Check, ChevronDown } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import {
  CSS,
} from '@dnd-kit/utilities';
import { useQuotes } from '../context/QuoteContext';
import { useCustomers } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
import { useDocumentHelpers } from '../hooks/useDocumentHelpers';
import { Customer, Quote, QuoteItem, QuoteAttachment } from '../types';
import { AttachmentManager } from './AttachmentManager';
import { calculateInvoiceWithDiscounts, validateDiscount } from '../utils/discountUtils';
import { DocumentPreview } from './DocumentPreview';
import type { PreviewDocument } from '../utils/previewDocuments';
import { RatesAndMaterialsRedirectModal } from './RatesAndMaterialsRedirectModal';
import { ConfirmationModal } from './ConfirmationModal';
import { formatCustomerNumber } from '../utils/customerUtils';
import { generateUUID } from '../utils/uuid';
import { formatCurrency, getCurrencySymbol } from '../utils/formatters';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { getTerminology } from '../utils/terminology';
import { DialogShell } from './DialogShell';
import { useFeedback } from '../context/FeedbackContext';

// Sortable Item Component for Drag & Drop
interface SortableQuoteItemProps {
  item: QuoteItem;
  index: number;
  onUpdate: (id: string, field: keyof QuoteItem, value: string | number | undefined) => void;
  onRemove: (id: string) => void;
  isSmallBusiness: boolean;
  templateSuggestions: QuoteTemplateSuggestion[];
  onSelectTemplate: (itemId: string, suggestion: QuoteTemplateSuggestion) => void;
}

interface QuoteTemplateSuggestion {
  id: string;
  type: 'material' | 'hourly';
  label: string;
  detail: string;
  unitPrice: number;
  taxRate: number;
}

const getPositionGridTemplateColumns = (
  isSmallBusiness: boolean,
  discountsEnabled: boolean,
) => {
  const columns = [
    '2rem',
    'minmax(12rem, 3fr)',
    'minmax(5rem, 1fr)',
    'minmax(7rem, 1.25fr)',
  ];

  if (!isSmallBusiness) columns.push('minmax(5rem, 0.85fr)');
  if (discountsEnabled) {
    columns.push('minmax(8rem, 1.25fr)');
  }

  // Die Gesamtspalte bleibt immer gleich breit, damit sich die Tabelle beim
  // Eingeben eines Rabatts nicht verschiebt. Die Aktionsspalte benötigt nur
  // noch Platz für das Löschen-Icon.
  columns.push('11rem', '2rem');
  return columns.join(' ');
};

interface DiscountTypeDropdownProps {
  value: 'percentage' | 'fixed' | '' | undefined;
  currencySymbol: string;
  onChange: (value: 'percentage' | 'fixed') => void;
  onOpenChange?: (isOpen: boolean) => void;
  tone?: 'default' | 'amber';
}

function DiscountTypeDropdown({ value, currencySymbol, onChange, onOpenChange, tone = 'default' }: DiscountTypeDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedValue = value === 'fixed' ? 'fixed' : 'percentage';
  const options = [
    { value: 'percentage' as const, label: '%' },
    { value: 'fixed' as const, label: currencySymbol },
  ];
  const triggerTone = tone === 'amber'
    ? 'border-amber-200 bg-white text-amber-900 hover:bg-amber-100 focus:ring-amber-500'
    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100 focus:ring-blue-500';
  const menuBorder = tone === 'amber' ? 'border-amber-200' : 'border-gray-300';

  useEffect(() => {
    if (!isOpen) return undefined;

    const closeDropdown = (event: PointerEvent) => {
      if (event.target instanceof Node && !dropdownRef.current?.contains(event.target)) {
        setIsOpen(false);
        onOpenChange?.(false);
      }
    };

    document.addEventListener('pointerdown', closeDropdown);
    return () => document.removeEventListener('pointerdown', closeDropdown);
  }, [isOpen, onOpenChange]);

  return (
    <div ref={dropdownRef} className="absolute right-0 top-0 z-30 h-full">
      <button
        type="button"
        onClick={() => {
          const nextOpenState = !isOpen;
          setIsOpen(nextOpenState);
          onOpenChange?.(nextOpenState);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setIsOpen(false);
            onOpenChange?.(false);
          }
        }}
        className={`flex h-full min-h-0 w-12 items-center justify-center gap-0.5 rounded-r border px-1 text-sm font-medium transition-colors focus:z-10 focus:outline-none focus:ring-2 ${triggerTone}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Rabatteinheit auswählen"
      >
        <span>{options.find(option => option.value === selectedValue)?.label}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          className={`absolute right-0 top-full mt-1 w-12 overflow-hidden rounded-lg border bg-white p-1 shadow-xl ${menuBorder}`}
          role="listbox"
          aria-label="Rabatteinheit"
        >
          {options.map(option => {
            const isSelected = option.value === selectedValue;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                  onOpenChange?.(false);
                }}
                className={`flex min-h-0 h-8 w-full items-center justify-between rounded-md px-1 text-sm font-medium transition-colors ${
                  isSelected
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
                }`}
              >
                <span>{option.label}</span>
                {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SortableQuoteItem({ 
  item, 
  index, 
  onUpdate, 
  onRemove, 
  isSmallBusiness,
  templateSuggestions,
  onSelectTemplate,
}: SortableQuoteItemProps) {
  const { company } = useCompany();
  const discountsEnabled = company.discountsEnabled !== false;
  const currencySymbol = getCurrencySymbol(company.locale, company.numberFormat, company.currency);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Calculate discount amount for display
  const discountAmount = item.discountAmount || 0;
  const itemTotalBeforeDiscount = item.quantity * item.unitPrice;
  const itemTotalAfterDiscount = itemTotalBeforeDiscount - discountAmount;
  const [showSuggestions, setShowSuggestions] = useState(false);
  const itemDescription = String(item.description || '');
  const matchingTemplateSuggestions = itemDescription.trim().length >= 2
    ? templateSuggestions.filter(suggestion => suggestion.label.toLowerCase().includes(itemDescription.trim().toLowerCase())).slice(0, 5)
    : [];
  const [isDiscountDropdownOpen, setIsDiscountDropdownOpen] = useState(false);

  const renderDescriptionField = (compact = false) => (
    <div className="relative">
      <input
        type="text"
        required
        value={item.description}
        onChange={(e) => {
          onUpdate(item.id, 'description', e.target.value);
          setShowSuggestions(true);
        }}
        onFocus={() => setShowSuggestions(true)}
        className={`w-full ${compact ? 'px-3 py-2' : 'px-2 py-1.5'} text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500`}
        placeholder="Beschreibung der Position"
      />
      {showSuggestions && matchingTemplateSuggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
          {matchingTemplateSuggestions.map(suggestion => (
            <button
              key={`${suggestion.type}-${suggestion.id}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelectTemplate(item.id, suggestion);
                setShowSuggestions(false);
              }}
              className="quote-editor-option w-full rounded-md px-3 py-2 text-left text-sm hover:bg-blue-50"
            >
              <span className="block font-medium text-gray-900">{suggestion.label}</span>
              <span className="block text-xs text-gray-500">{suggestion.detail} · {formatCurrency(suggestion.unitPrice, company.locale, company.numberFormat, company.currency)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const gridTemplateColumns = getPositionGridTemplateColumns(
    isSmallBusiness,
    discountsEnabled,
  );

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      className={`relative border border-gray-200 rounded-lg p-3 bg-white ${isDiscountDropdownOpen ? 'z-50' : ''} ${isDragging ? 'shadow-lg ring-2 ring-blue-300' : ''}`}
    >
      {/* Desktop Layout - Single Row */}
      <div className="hidden items-center gap-3 lg:grid" style={{ gridTemplateColumns }}>
        {/* Drag Handle */}
        <div className="flex items-center justify-center">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="position-row-drag-handle"
            title="Verschieben"
          >
            <GripVertical className="w-5 h-5" />
          </button>
        </div>

        {/* Beschreibung - 3 columns */}
        <div className="min-w-0">
          <label className="block text-xs font-medium text-gray-700 mb-1 lg:sr-only">
            Beschreibung *
          </label>
          {renderDescriptionField()}
        </div>
        
        {/* Menge - 1 column */}
        <div className="min-w-0">
          <label className="block text-xs font-medium text-gray-700 mb-1 lg:sr-only">
            Menge *
          </label>
          <LocalizedNumberInput
            min="0"
            step="0.01"
            required
            value={item.quantity}
            locale={company.locale}
            numberFormat={company.numberFormat}
            onValueChange={(value) => onUpdate(item.id, 'quantity', value)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Einzelpreis - 1 column */}
        <div className="min-w-0">
          <label className="block text-xs font-medium text-gray-700 mb-1 lg:sr-only">
            Einzelpreis {currencySymbol}
          </label>
          <LocalizedNumberInput
            min="0"
            step="0.01"
            required
            value={item.unitPrice}
            locale={company.locale}
            numberFormat={company.numberFormat}
            onValueChange={(value) => onUpdate(item.id, 'unitPrice', value)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* MwSt - 1 column */}
        {!isSmallBusiness && (
          <div className="min-w-0">
            <label className="block text-xs font-medium text-gray-700 mb-1 lg:sr-only">
              MwSt %
            </label>
            <LocalizedNumberInput
              min="0"
              max="100"
              step="0.01"
              value={item.taxRate}
              locale={company.locale}
              numberFormat={company.numberFormat}
              onValueChange={(value) => onUpdate(item.id, 'taxRate', value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Rabatt Type & Value - Combined */}
        {discountsEnabled && (
          <div className="min-w-0">
            <label className="block text-xs font-medium text-gray-700 mb-1 lg:sr-only">
              Rabatt
            </label>
            <div className="relative min-w-0">
              <LocalizedNumberInput
                min="0"
                max={item.discountType === 'fixed' ? undefined : '100'}
                step="0.01"
                value={item.discountValue ?? 0}
                locale={company.locale || 'de-DE'}
                numberFormat={company.numberFormat}
                onValueChange={(value) => onUpdate(item.id, 'discountValue', value === '' ? 0 : value)}
                className="w-full min-w-0 rounded border border-gray-300 px-2 py-1.5 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={item.discountType === 'fixed' ? currencySymbol : '0'}
              />
              <DiscountTypeDropdown
                value={item.discountType}
                currencySymbol={currencySymbol}
                onOpenChange={setIsDiscountDropdownOpen}
                onChange={(value) => {
                  onUpdate(item.id, 'discountType', value);
                }}
              />
            </div>
          </div>
        )}

        {/* Gesamt - 1 column */}
        <div className="min-w-0">
          <output
            className={`flex min-h-[2.25rem] min-w-0 items-center justify-end gap-1 rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-right text-sm ${
              discountAmount > 0 ? 'text-green-600 font-semibold' : 'text-gray-900'
            }`}
            aria-label={`Gesamt ${currencySymbol}`}
            title={discountAmount > 0 ? `Vor Rabatt: ${formatCurrency(itemTotalBeforeDiscount, company.locale, company.numberFormat, company.currency)}` : undefined}
          >
            <span className="min-w-0 truncate">
              {formatCurrency(itemTotalAfterDiscount, company.locale, company.numberFormat, company.currency)}
            </span>
            {discountAmount > 0 && (
              <span className="shrink-0 whitespace-nowrap text-[10px] font-normal leading-4 text-gray-500 line-through">
                {formatCurrency(itemTotalBeforeDiscount, company.locale, company.numberFormat, company.currency)}
              </span>
            )}
          </output>
        </div>

        {/* Actions - 1 column */}
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="position-row-action position-row-delete"
            title="Position löschen"
            aria-label="Position löschen"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mobile Layout - Stacked */}
      <div className="lg:hidden space-y-3">
        {/* Header with Drag Handle and Actions */}
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <button
              type="button"
              {...attributes}
              {...listeners}
              className="position-row-drag-handle"
            >
              <GripVertical className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium text-gray-700">Position {index + 1}</span>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className="position-row-action position-row-delete"
              title="Position löschen"
              aria-label="Position löschen"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Form Fields */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Beschreibung *
            </label>
            {renderDescriptionField(true)}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Menge *
              </label>
              <LocalizedNumberInput
                min="0"
                step="0.01"
                required
                value={item.quantity}
                locale={company.locale}
                numberFormat={company.numberFormat}
                onValueChange={(value) => onUpdate(item.id, 'quantity', value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Einzelpreis {currencySymbol}
              </label>
              <LocalizedNumberInput
                min="0"
                step="0.01"
                required
                value={item.unitPrice}
                locale={company.locale}
                numberFormat={company.numberFormat}
                onValueChange={(value) => onUpdate(item.id, 'unitPrice', value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {!isSmallBusiness && (
            <div className="col-span-2 md:col-span-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                MwSt %
              </label>
              <LocalizedNumberInput
                min="0"
                max="100"
                step="0.01"
                value={item.taxRate}
                locale={company.locale}
                numberFormat={company.numberFormat}
                onValueChange={(value) => onUpdate(item.id, 'taxRate', value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {discountsEnabled && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Rabatt
              </label>
              <div className="relative min-w-0">
                <LocalizedNumberInput
                  min="0"
                  max={item.discountType === 'fixed' ? undefined : '100'}
                  step="0.01"
                  value={item.discountValue ?? 0}
                  locale={company.locale || 'de-DE'}
                  numberFormat={company.numberFormat}
                  onValueChange={(value) => onUpdate(item.id, 'discountValue', value === '' ? 0 : value)}
                  className="w-full min-w-0 rounded border border-gray-300 px-3 py-2 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={item.discountType === 'fixed' ? currencySymbol : '0'}
                />
                <DiscountTypeDropdown
                  value={item.discountType}
                  currencySymbol={currencySymbol}
                  onOpenChange={setIsDiscountDropdownOpen}
                  onChange={(value) => {
                    onUpdate(item.id, 'discountType', value);
                  }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,auto)] items-start gap-3 border-t border-gray-200 pt-2">
              <span className="pt-1 text-sm font-medium text-gray-700">Gesamt:</span>
              <div className="min-w-0 text-right">
                {discountAmount > 0 && (
                  <div className="min-h-4 whitespace-nowrap text-xs leading-4 text-gray-500 line-through">
                    {formatCurrency(itemTotalBeforeDiscount, company.locale, company.numberFormat, company.currency)}
                  </div>
                )}
                <div className={`text-lg font-semibold ${discountAmount > 0 ? 'text-green-600' : 'text-gray-900'}`}>
                  {formatCurrency(itemTotalAfterDiscount, company.locale, company.numberFormat, company.currency)}
                </div>
              </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface QuoteEditorProps {
  quote?: Quote | null;
  onClose: () => void;
  onCreateCustomer?: () => void;
  onNavigateToCustomers?: () => void;
  onNavigateToSettings?: () => void;
}

export function QuoteEditor({ quote, onClose, onCreateCustomer, onNavigateToCustomers, onNavigateToSettings }: QuoteEditorProps) {
  const { notify } = useFeedback();
  const { customers } = useCustomers();
  const { company } = useCompany();
  const { addQuote, updateQuote } = useQuotes();
  const { getMaterialTemplatesForCustomer, getHourlyRatesForCustomer, getCombinedMaterialTemplatesForCustomer, getCombinedHourlyRatesForCustomer } = useDocumentHelpers();
  const discountsEnabled = company.discountsEnabled !== false;
  const terminology = getTerminology(company.terminologyProfile);
  const currencySymbol = getCurrencySymbol(company.locale, company.numberFormat, company.currency);
  const formatMoney = (amount: number) => formatCurrency(
    amount,
    company.locale,
    company.numberFormat,
    company.currency
  );
  
  const [quoteNumber, setQuoteNumber] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [notes, setNotes] = useState('');
  const [globalDiscountType, setGlobalDiscountType] = useState<'percentage' | 'fixed' | ''>('');
  const [globalDiscountValue, setGlobalDiscountValue] = useState<string>('');
  const [showGlobalDiscountRow, setShowGlobalDiscountRow] = useState(false);
  const [attachments, setAttachments] = useState<QuoteAttachment[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const customerFieldRef = useRef<HTMLDivElement>(null);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [previewDocuments, setPreviewDocuments] = useState<PreviewDocument[]>([]);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const [redirectModalType, setRedirectModalType] = useState<'hourlyRates' | 'materials' | null>(null);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const positionGridTemplateColumns = getPositionGridTemplateColumns(
    company.isSmallBusiness || false,
    discountsEnabled,
  );
  const discountColumnStart = company.isSmallBusiness ? 5 : 6;

  // Drag & Drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required to start dragging
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (!showCustomerDropdown) return undefined;

    const closeCustomerDropdown = (event: PointerEvent) => {
      if (event.target instanceof Node && !customerFieldRef.current?.contains(event.target)) {
        setShowCustomerDropdown(false);
      }
    };

    document.addEventListener('pointerdown', closeCustomerDropdown);
    return () => document.removeEventListener('pointerdown', closeCustomerDropdown);
  }, [showCustomerDropdown]);

  // Calculate valid until date (30 days by default)
  function calculateValidUntil(issueDate: string) {
    const date = new Date(issueDate);
    date.setDate(date.getDate() + 30);
    return date.toISOString().split('T')[0];
  }

  const createEmptyItem = useCallback((order: number): QuoteItem => {
    return {
      id: generateUUID(),
      description: '',
      quantity: 1,
      unitPrice: 0,
      taxRate: company.isSmallBusiness ? 0 : 19,
      total: 0,
      order: order,
      discountType: discountsEnabled ? 'percentage' : undefined,
      discountValue: discountsEnabled ? 0 : undefined,
      discountAmount: 0
    };
  }, [company.isSmallBusiness, discountsEnabled]);

  // Initialize form
  useEffect(() => {
    if (quote) {
      // Edit mode
      setQuoteNumber(quote.quoteNumber);
      setSelectedCustomerId(quote.customerId);
      setIssueDate(new Date(quote.issueDate).toISOString().split('T')[0]);
      setValidUntil(new Date(quote.validUntil).toISOString().split('T')[0]);
      const existingItems = (quote.items || []).map(item => discountsEnabled
        ? {
            ...item,
            discountType: item.discountType || 'percentage',
            discountValue: item.discountValue ?? 0,
          }
        : item
      );
      setItems(existingItems.length > 0 && String(existingItems[existingItems.length - 1].description || '').trim()
        ? [...existingItems, createEmptyItem(existingItems.length + 1)]
        : existingItems);
      setNotes(quote.notes || '');
      setGlobalDiscountType(quote.globalDiscountType || '');
      setGlobalDiscountValue(quote.globalDiscountValue?.toString() || '');
      setShowGlobalDiscountRow(Boolean(quote.globalDiscountType || quote.globalDiscountValue));
      setAttachments(quote.attachments || []);
      
      // Set customer search term
      const customer = customers.find(c => c.id === quote.customerId);
      if (customer) {
        setCustomerSearchTerm(`${formatCustomerNumber(customer.customerNumber)} - ${customer.name}`);
      }
    } else {
      // Create mode - leave quote number empty, it will be generated by the backend
      const today = new Date().toISOString().split('T')[0];
      setIssueDate(today);
      setValidUntil(calculateValidUntil(today));
      setQuoteNumber('');
      setGlobalDiscountType('');
      setGlobalDiscountValue('');
      setShowGlobalDiscountRow(false);
      setItems([createEmptyItem(1)]);
    }
    setIsDirty(false);
  }, [quote, customers, createEmptyItem, discountsEnabled]);

  const requestClose = () => {
    if (isDirty) {
      setShowDiscardModal(true);
      return;
    }
    onClose();
  };

  const addGlobalDiscountRow = () => {
    setIsDirty(true);
    setShowGlobalDiscountRow(true);
    setGlobalDiscountType(previousType => previousType || 'percentage');
    setGlobalDiscountValue(previousValue => previousValue || '0');
  };

  const removeGlobalDiscountRow = () => {
    setIsDirty(true);
    setShowGlobalDiscountRow(false);
    setGlobalDiscountType('');
    setGlobalDiscountValue('');
  };


  const handleCustomerSelect = (customer: Customer) => {
    setSelectedCustomerId(customer.id);
    setCustomerSearchTerm(`${formatCustomerNumber(customer.customerNumber)} - ${customer.name}`);
    setShowCustomerDropdown(false);
  };

  const handleCustomerSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomerSearchTerm(e.target.value);
    setShowCustomerDropdown(true);
    
    // Clear selection if search term is cleared
    if (e.target.value === '') {
      setSelectedCustomerId('');
    }
  };

  const filteredCustomers = customers.filter(customer =>
    customer.name.toLowerCase().includes(customerSearchTerm.toLowerCase()) ||
    customer.customerNumber.toLowerCase().includes(customerSearchTerm.toLowerCase()) ||
    customer.email?.toLowerCase().includes(customerSearchTerm.toLowerCase())
  );

  const updateItem = (id: string, field: keyof QuoteItem, value: string | number | undefined) => {
    setIsDirty(true);
    setItems(currentItems => {
      const nextItems = currentItems.map(item => {
      if (item.id === id) {
        let parsedValue: string | number | undefined = value;
        
        // Convert numeric fields to numbers
        if (['quantity', 'unitPrice', 'taxRate', 'discountValue'].includes(field)) {
          if (value === undefined || value === '' || value === null) {
            parsedValue = 0;
          } else {
            parsedValue = parseFloat(String(value));
            if (isNaN(parsedValue)) {
              parsedValue = 0;
            }
          }
        }

        if (field === 'discountType' && !parsedValue) {
          parsedValue = 'percentage';
        }
        
        const updatedItem = {
          ...item,
          [field]: parsedValue,
        };
        
        // Recalculate total and discount when relevant fields change
        if (['quantity', 'unitPrice', 'discountType', 'discountValue'].includes(field)) {
          // Calculate discount amount
          const quantity = updatedItem.quantity || 0;
          const unitPrice = updatedItem.unitPrice || 0;
          const itemTotal = quantity * unitPrice;
          
          let discountAmount = 0;
          if (updatedItem.discountType && updatedItem.discountValue && updatedItem.discountValue > 0) {
            if (updatedItem.discountType === 'percentage') {
              const percentage = Math.min(Math.max(updatedItem.discountValue, 0), 100);
              discountAmount = (itemTotal * percentage) / 100;
            } else if (updatedItem.discountType === 'fixed') {
              discountAmount = Math.min(Math.max(updatedItem.discountValue, 0), itemTotal);
            }
          }
          
          return {
            ...updatedItem,
            discountAmount,
            total: itemTotal - discountAmount
          };
        }
        
        return updatedItem;
      }
      return item;
      });

      if (field === 'description' && String(value || '').trim() && nextItems[nextItems.length - 1]?.id === id) {
        return [...nextItems, createEmptyItem(nextItems.length + 1)];
      }
      return nextItems;
    });
  };

  const addItem = () => {
    setItems(currentItems => [...currentItems, createEmptyItem(currentItems.length + 1)]);
  };

  const addItemFromTemplate = (templateType: 'hourly' | 'material', templateId: string) => {
    let description = '';
    let unitPrice = 0;
    let taxRate = company.isSmallBusiness ? 0 : 19;
    if (templateType === 'hourly') {
      const template = hourlyRateTemplates.find(item => item.id === templateId);
      if (!template) return;
      description = template.name;
      unitPrice = Number(template.rate) || 0;
      taxRate = company.isSmallBusiness ? 0 : (template.taxRate ?? 19);
    } else {
      const template = materialTemplates.find(item => item.id === templateId);
      if (!template) return;
      description = template.name;
      unitPrice = Number(template.unitPrice) || 0;
      taxRate = company.isSmallBusiness ? 0 : (template.taxRate ?? 19);
    }
    setItems(currentItems => {
      const newItem: QuoteItem = {
        id: generateUUID(),
        description,
        quantity: 1,
        unitPrice,
        taxRate,
        total: unitPrice,
        order: currentItems.length + 1,
        discountType: discountsEnabled ? 'percentage' : undefined,
        discountValue: discountsEnabled ? 0 : undefined,
        discountAmount: 0,
      };
      return [...currentItems, newItem];
    });
    setShowTemplateDropdown(false);
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setItems((items) => {
        const oldIndex = items.findIndex(item => item.id === active.id);
        const newIndex = items.findIndex(item => item.id === over.id);
        
        const newItems = arrayMove(items, oldIndex, newIndex);
        // Update order values
        newItems.forEach((item, idx) => {
          item.order = idx + 1;
        });
        return newItems;
      });
    }
  };

  const calculateTotals = () => {
    const result = calculateInvoiceWithDiscounts({
      items,
      globalDiscountType: globalDiscountType || undefined,
      globalDiscountValue: globalDiscountValue ? parseFloat(globalDiscountValue) : undefined
    });

    return {
      subtotal: result.subtotal,
      itemDiscountAmount: result.itemDiscountAmount,
      globalDiscountAmount: result.globalDiscountAmount,
      totalDiscountAmount: result.totalDiscountAmount,
      discountedSubtotal: result.discountedSubtotal,
      taxAmount: result.taxAmount,
      total: result.total
    };
  };

  const handlePreview = (attachments: (QuoteAttachment)[], initialIndex: number) => {
    const docs: PreviewDocument[] = attachments.map((att) => ({
      id: att.id,
      name: att.name,
      type: 'attachment' as const,
      size: att.size,
      content: att.content,
      contentType: att.contentType
    }));
    
    setPreviewDocuments(docs);
    setPreviewInitialIndex(initialIndex);
    setShowPreview(true);
  };

  const handleClosePreview = () => {
    setShowPreview(false);
    setPreviewDocuments([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedCustomerId) {
      notify({ variant: 'warning', message: `Bitte wählen Sie einen ${terminology.entity.accusative} aus.` });
      return;
    }

    const filledItems = items.filter(item => String(item.description || '').trim());

    if (filledItems.length === 0) {
      notify({ variant: 'warning', message: 'Bitte fügen Sie mindestens eine Position hinzu.' });
      return;
    }

    // Validate all items
    for (const item of filledItems) {
      if (!item.description || item.quantity <= 0 || item.unitPrice < 0) {
        notify({ variant: 'warning', message: 'Bitte füllen Sie alle Pflichtfelder korrekt aus.' });
        return;
      }
    }

    // Validate global discount if present
    if (globalDiscountType && globalDiscountValue) {
      const validation = validateDiscount(
        globalDiscountType as 'percentage' | 'fixed',
        parseFloat(globalDiscountValue),
        calculateTotals().subtotal,
        company.locale,
        company.numberFormat,
        company.currency
      );
      
      if (!validation.isValid) {
        notify({ variant: 'error', message: validation.error || 'Die Eingabe ist ungültig.' });
        return;
      }
    }

    const totals = calculateTotals();
    const customer = customers.find(c => c.id === selectedCustomerId);

    const quoteData: Omit<Quote, 'id' | 'createdAt'> = {
      quoteNumber: quote ? quoteNumber : '', // Keep existing number for updates, empty for new quotes
      customerId: selectedCustomerId,
      customerName: customer?.name || '',
      issueDate: new Date(issueDate),
      validUntil: new Date(validUntil),
      items: filledItems.map(item => ({
        ...item,
        total: (item.quantity * item.unitPrice) - (item.discountAmount || 0)
      })),
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      total: totals.total,
      status: quote?.status || 'draft',
      notes,
      globalDiscountType: globalDiscountType || undefined,
      globalDiscountValue: globalDiscountValue ? parseFloat(globalDiscountValue) : undefined,
      globalDiscountAmount: totals.globalDiscountAmount,
      attachments
    };

    try {
      if (quote) {
        await updateQuote(quote.id, quoteData);
        logger.info('Angebot aktualisiert', { quoteNumber });
      } else {
        await addQuote(quoteData);
        logger.info('Angebot erstellt', { quoteNumber });
      }
      onClose();
    } catch (error) {
      logger.error('Fehler beim Speichern des Angebots', { error });
      notify({ variant: 'error', message: 'Fehler beim Speichern des Angebots' });
    }
  };

  const totals = calculateTotals();
  // Get templates based on dropdown mode
  const materialTemplates = company.showCombinedDropdowns 
    ? getCombinedMaterialTemplatesForCustomer(selectedCustomerId)
    : getMaterialTemplatesForCustomer(selectedCustomerId);
  
  const hourlyRateTemplates = company.showCombinedDropdowns 
    ? getCombinedHourlyRatesForCustomer(selectedCustomerId)
    : getHourlyRatesForCustomer(selectedCustomerId);

  const templateSuggestions: QuoteTemplateSuggestion[] = [
    ...hourlyRateTemplates.map(template => ({
      id: template.id,
      type: 'hourly' as const,
      label: 'displayName' in template && typeof template.displayName === 'string' ? template.displayName : template.name,
      detail: 'Stundensatz',
      unitPrice: typeof template.rate === 'number' ? template.rate : 0,
      taxRate: template.taxRate || (company.isSmallBusiness ? 0 : 19),
    })),
    ...materialTemplates.map(template => ({
      id: template.id,
      type: 'material' as const,
      label: 'displayName' in template && typeof template.displayName === 'string' ? template.displayName : template.name,
      detail: template.unit,
      unitPrice: typeof template.unitPrice === 'number' ? template.unitPrice : 0,
      taxRate: template.taxRate || (company.isSmallBusiness ? 0 : 19),
    })),
  ];

  const selectTemplateForItem = (itemId: string, suggestion: QuoteTemplateSuggestion) => {
    setItems(currentItems => {
      const nextItems = currentItems.map(item => {
        if (item.id !== itemId) return item;

        const updatedItem: QuoteItem = {
          ...item,
          description: suggestion.label,
          unitPrice: suggestion.unitPrice,
          taxRate: suggestion.taxRate,
          total: item.quantity * suggestion.unitPrice,
          discountAmount: 0,
          discountType: discountsEnabled ? 'percentage' : undefined,
          discountValue: discountsEnabled ? 0 : undefined,
        };
        return updatedItem;
      });
      return nextItems[nextItems.length - 1]?.id === itemId
        ? [...nextItems, createEmptyItem(nextItems.length + 1)]
        : nextItems;
    });
  };

  const handleQuotePreview = () => {
    const customer = customers.find(currentCustomer => currentCustomer.id === selectedCustomerId);
    if (!customer) {
      notify({ variant: 'warning', message: `Bitte wählen Sie zuerst einen ${terminology.entity.singular} aus.` });
      return;
    }

    const previewQuote: Quote = {
      id: quote?.id || generateUUID(),
      createdAt: quote?.createdAt || new Date(),
      updatedAt: new Date(),
      quoteNumber: quoteNumber || 'Vorschau',
      customerId: selectedCustomerId,
      customerName: customer.name,
      issueDate: new Date(issueDate),
      validUntil: new Date(validUntil),
      items: items.filter(item => String(item.description || '').trim()),
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      total: totals.total,
      status: quote?.status || 'draft',
      notes,
      globalDiscountType: globalDiscountType || undefined,
      globalDiscountValue: globalDiscountValue ? parseFloat(globalDiscountValue) : undefined,
      globalDiscountAmount: totals.globalDiscountAmount,
      attachments,
    };

    setPreviewDocuments([{
      id: `quote-preview-${previewQuote.id}`,
      name: `Angebot_${previewQuote.quoteNumber}.pdf`,
      type: 'quote-pdf',
      quote: previewQuote,
    }]);
    setPreviewInitialIndex(0);
    setShowPreview(true);
  };

  const hasNoTemplates = materialTemplates.length === 0 && hourlyRateTemplates.length === 0;

  return (
    <>
      <DialogShell
        titleId="quote-editor-dialog-title"
        icon={FileText}
        title={quote ? 'Angebot bearbeiten' : 'Neues Angebot'}
        description={quote ? `${quote.quoteNumber} bearbeiten und speichern.` : 'Erstellen Sie ein Angebot mit Kunde, Positionen und Zahlungsangaben.'}
        onClose={requestClose}
        onSubmit={handleSubmit}
        onChange={() => setIsDirty(true)}
        size="xl"
        zIndexClassName="z-[1000]"
        footer={(
          <>
            <button type="button" onClick={requestClose} className="inline-flex min-h-12 flex-1 items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2 text-base font-medium text-gray-700 transition hover:bg-gray-50 sm:flex-none">Abbrechen</button>
            <button type="button" onClick={handleQuotePreview} className="inline-flex min-h-12 flex-1 items-center justify-center rounded-lg border border-primary-custom px-5 py-2 text-base font-medium text-primary-custom transition hover:bg-primary-light-custom sm:flex-none"><Eye className="mr-2 h-5 w-5" />Vorschau</button>
            <button type="submit" className="btn-primary inline-flex min-h-12 flex-1 items-center justify-center rounded-lg px-6 py-2 text-base font-semibold text-white transition hover:brightness-90 sm:flex-none"><Save className="mr-2 h-5 w-5" />{quote ? 'Änderungen speichern' : 'Angebot erstellen'}</button>
          </>
        )}
      >
        <div className="space-y-4 pb-2 sm:space-y-5">
          {/* Basic Information */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
            <div className="col-span-2 min-[480px]:col-span-1 md:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Angebotsnummer
              </label>
              <input
                type="text"
                value={quoteNumber}
                placeholder={quote ? "" : "Wird automatisch generiert"}
                disabled={true}
                readOnly={true}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 mt-1">
                {quote ? "Angebotsnummern können nach der Erstellung nicht mehr geändert werden" : "Die Angebotsnummer wird beim Speichern automatisch generiert (Format: AN-YYYY-XXX)"}
              </p>
            </div>

            <div ref={customerFieldRef} className="relative col-span-2 min-[480px]:col-span-1 md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {terminology.entity.singular} *
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={customerSearchTerm}
                  onChange={handleCustomerSearchChange}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setShowCustomerDropdown(false);
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={terminology.entity.searchPlaceholder}
                />
                
                {showCustomerDropdown && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {filteredCustomers.length > 0 ? (
                      filteredCustomers.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => handleCustomerSelect(customer)}
                          className="quote-editor-option w-full px-4 py-3 text-left hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-b-0"
                        >
                          <div className="font-medium text-gray-900">
                            {formatCustomerNumber(customer.customerNumber)} - {customer.name}
                          </div>
                          {customer.email && (
                            <div className="text-sm text-gray-500">{customer.email}</div>
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-8 text-center">
                        <p className="text-gray-500 mb-4">{terminology.entity.noResults}</p>
                        {onCreateCustomer && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowCustomerDropdown(false);
                              onCreateCustomer();
                            }}
                            className="text-blue-600 hover:text-blue-700 font-medium"
                          >
                            {terminology.entity.newLabel}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Datum *
              </label>
              <input
                type="date"
                lang="de-DE"
                required
                value={issueDate}
                onChange={(e) => {
                  setIssueDate(e.target.value);
                  setValidUntil(calculateValidUntil(e.target.value));
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Gültig bis *
              </label>
              <input
                type="date"
                lang="de-DE"
                required
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Items Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Calculator className="w-5 h-5 text-blue-600" />
                Positionen
              </h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
                    disabled={!selectedCustomerId || hasNoTemplates}
                    className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    title={!selectedCustomerId ? `Bitte wählen Sie zuerst einen ${terminology.entity.accusative} aus` : hasNoTemplates ? 'Keine Vorlagen verfügbar' : 'Position aus Vorlage hinzufügen'}
                  >
                    <FileText className="w-4 h-4" />
                    <span className="hidden sm:inline">Vorlage</span>
                  </button>

                  {showTemplateDropdown && (
                    <div className="absolute right-0 mt-2 w-72 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
                      {hourlyRateTemplates.length > 0 && (
                        <div className="p-2 border-b border-gray-200">
                          <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                            Stundensätze
                          </div>
                          {hourlyRateTemplates.map((template) => {
                            const rate = typeof template.rate === 'number' ? template.rate : 0;
                            const templateName = 'displayName' in template && typeof template.displayName === 'string'
                              ? template.displayName
                              : template.name;
                            return (
                              <button
                                key={template.id}
                                type="button"
                                onClick={() => addItemFromTemplate('hourly', template.id)}
                                className="quote-editor-option w-full px-3 py-2 text-left hover:bg-blue-50 rounded transition-colors"
                              >
                                <div className="font-medium text-gray-900">
                                  {templateName}
                                </div>
                                <div className="text-sm text-gray-500">
                                  {formatMoney(rate)} / Stunde
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {materialTemplates.length > 0 && (
                        <div className="p-2">
                          <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                            Materialien
                          </div>
                          {materialTemplates.map((template) => {
                            const unitPrice = typeof template.unitPrice === 'number' ? template.unitPrice : 0;
                            const templateName = 'displayName' in template && typeof template.displayName === 'string'
                              ? template.displayName
                              : template.name;
                            return (
                              <button
                                key={template.id}
                                type="button"
                                onClick={() => addItemFromTemplate('material', template.id)}
                                className="quote-editor-option w-full px-3 py-2 text-left hover:bg-blue-50 rounded transition-colors"
                              >
                                <div className="font-medium text-gray-900">
                                  {templateName}
                                </div>
                                <div className="text-sm text-gray-500">
                                  {formatMoney(unitPrice)} / {template.unit}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {(hourlyRateTemplates.length === 0 && materialTemplates.length === 0) && (
                        <div className="p-4 text-center">
                          <p className="text-gray-500 text-sm mb-3">Keine Vorlagen verfügbar</p>
                          {onNavigateToSettings && (
                            <button
                              type="button"
                              onClick={() => {
                                setShowTemplateDropdown(false);
                                setRedirectModalType('materials');
                              }}
                              className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                            >
                              Vorlagen verwalten
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={addItem}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">Position</span>
                </button>

                {discountsEnabled && (
                  <button
                    type="button"
                    onClick={addGlobalDiscountRow}
                    disabled={showGlobalDiscountRow}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                    title={showGlobalDiscountRow ? 'Rabattzeile ist bereits vorhanden' : 'Gesamtrabatt hinzufügen'}
                  >
                    <Percent className="h-4 w-4" />
                    <span className="hidden sm:inline">Rabatt</span>
                  </button>
                )}
              </div>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <div
                className="position-table-header -mb-1 hidden items-center gap-3 px-3 pb-0.5 text-xs font-semibold uppercase tracking-wide text-gray-500 lg:grid"
                style={{ gridTemplateColumns: positionGridTemplateColumns }}
                aria-hidden="true"
              >
                <div />
                <div>Beschreibung</div>
                <div>Menge</div>
                <div>Einzelpreis {currencySymbol}</div>
                {!company.isSmallBusiness && <div>MwSt %</div>}
                {discountsEnabled && <div>Rabatt</div>}
                <div>Gesamt {currencySymbol}</div>
                <div />
              </div>
              <SortableContext
                items={items.map(item => item.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {items.map((item, index) => (
                    <SortableQuoteItem
                      key={item.id}
                      item={item}
                      index={index}
                      onUpdate={updateItem}
                      onRemove={removeItem}
                      isSmallBusiness={company.isSmallBusiness || false}
                      templateSuggestions={templateSuggestions}
                      onSelectTemplate={selectTemplateForItem}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {items.length === 0 && (
              <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                <p className="text-gray-500 mb-4">Noch keine Positionen hinzugefügt</p>
                <button
                  type="button"
                  onClick={addItem}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Erste Position hinzufügen
                </button>
              </div>
            )}

            {discountsEnabled && showGlobalDiscountRow && (
              <div
                className="quote-global-discount-row relative z-40 rounded-lg border border-gray-200 bg-gray-50 p-3"
                style={{ '--quote-position-grid-columns': positionGridTemplateColumns } as React.CSSProperties}
              >
                <div
                  className="flex min-w-0 items-center gap-2"
                  style={{ gridColumn: `1 / ${discountColumnStart}` }}
                >
                  <Percent className="h-5 w-5 shrink-0 text-amber-600" />
                  <p className="truncate text-sm font-semibold text-gray-800" title="Auf die Zwischensumme nach Positionsrabatten">
                    Gesamtrabatt
                  </p>
                </div>

                <div
                  className="relative min-w-0 flex-[1_1_9rem]"
                  style={{ gridColumn: discountColumnStart }}
                >
                  <LocalizedNumberInput
                    id="global-discount-value"
                    aria-label="Gesamtrabattwert"
                    min="0"
                    max={globalDiscountType === 'percentage' ? '100' : undefined}
                    step="0.01"
                    value={globalDiscountValue === '' ? 0 : Number(globalDiscountValue)}
                    locale={company.locale}
                    numberFormat={company.numberFormat}
                    onValueChange={(value) => setGlobalDiscountValue(value === '' ? '0' : String(value))}
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0"
                  />
                  <DiscountTypeDropdown
                    value={globalDiscountType}
                    currencySymbol={currencySymbol}
                    onChange={(value) => {
                      setIsDirty(true);
                      setGlobalDiscountType(value);
                    }}
                  />
                </div>

                <div
                  className="min-w-0 flex-[1_1_8rem] rounded border border-gray-300 bg-gray-100 px-2 py-1.5 text-right text-sm font-semibold text-gray-900"
                  style={{ gridColumn: discountColumnStart + 1 }}
                  aria-label={`Rabattbetrag -${formatMoney(totals.globalDiscountAmount)}`}
                >
                  -{formatMoney(totals.globalDiscountAmount)}
                </div>

                <button
                  type="button"
                  onClick={removeGlobalDiscountRow}
                  className="position-row-action position-row-delete"
                  style={{ gridColumn: discountColumnStart + 2 }}
                  title="Rabattzeile entfernen"
                  aria-label="Rabattzeile entfernen"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="theme-gradient-surface theme-gradient-surface-totals space-y-3 rounded-lg border p-6 lg:pr-14">
            <div className="flex justify-between text-sm">
              <span className="theme-gradient-label">Zwischensumme:</span>
              <span className="theme-gradient-value font-medium">{formatMoney(totals.subtotal)}</span>
            </div>

            {discountsEnabled && totals.itemDiscountAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="theme-gradient-label">Positionsrabatte:</span>
                <span className="theme-gradient-negative font-medium">-{formatMoney(totals.itemDiscountAmount)}</span>
              </div>
            )}

            {discountsEnabled && totals.globalDiscountAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="theme-gradient-label">Gesamtrabatt:</span>
                <span className="theme-gradient-negative font-medium">-{formatMoney(totals.globalDiscountAmount)}</span>
              </div>
            )}

            {discountsEnabled && (totals.itemDiscountAmount > 0 || totals.globalDiscountAmount > 0) && (
              <div className="flex justify-between border-t border-gray-300 pt-2 text-sm">
                <span className="theme-gradient-label">Zwischensumme nach Rabatten:</span>
                <span className="theme-gradient-value font-medium">{formatMoney(totals.discountedSubtotal)}</span>
              </div>
            )}

            {!company.isSmallBusiness && (
              <div className="flex justify-between text-sm">
                <span className="theme-gradient-label">MwSt.:</span>
                <span className="theme-gradient-value font-medium">{formatMoney(totals.taxAmount)}</span>
              </div>
            )}

            <div className="theme-gradient-divider flex justify-between border-t-2 pt-3 text-lg font-bold">
              <span className="theme-gradient-heading">Gesamtbetrag:</span>
              <span className="theme-gradient-total">{formatMoney(totals.total)}</span>
            </div>

            {company.isSmallBusiness && (
              <div className="text-xs text-gray-500 pt-2 border-t border-gray-200">
                Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung)
              </div>
            )}

            {totals.totalDiscountAmount > 0 && (
              <div className="text-xs text-green-700 bg-green-50 rounded p-2 border border-green-200">
                <strong>Ersparnis:</strong> {formatMoney(totals.totalDiscountAmount)}
                ({((totals.totalDiscountAmount / (totals.subtotal + totals.totalDiscountAmount)) * 100).toFixed(1)}%)
              </div>
            )}
          </div>

          {/* Notes & Attachments */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-5 lg:grid-cols-10">
            <div className="md:col-span-3 lg:col-span-7">
              <h3 className="mb-4 text-lg font-semibold text-gray-900">
                Notizen / Hinweise
              </h3>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className="min-h-[14rem] w-full resize-none rounded-lg border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Optional: Zusätzliche Informationen für das Angebot..."
              />
            </div>

            <div className="md:col-span-2 lg:col-span-3">
              <AttachmentManager
                attachments={attachments}
                onAttachmentsChange={setAttachments}
                allowUpload={true}
                title="Anhangs-Dokumente"
                uploadAreaClassName="flex min-h-[14rem] flex-col justify-center"
                allowPreview={true}
                onPreview={handlePreview}
              />
            </div>
          </div>

        </div>
      </DialogShell>

      {/* Document Preview Modal */}
      {showPreview && (
        <DocumentPreview
          isOpen={showPreview}
          onClose={handleClosePreview}
          documents={previewDocuments}
          initialIndex={previewInitialIndex}
        />
      )}

      {/* Redirect Modal for Templates */}
      {redirectModalType && onNavigateToCustomers && onNavigateToSettings && (
        <RatesAndMaterialsRedirectModal
          isOpen={true}
          onClose={() => setRedirectModalType(null)}
          onNavigateToCustomers={onNavigateToCustomers}
          onNavigateToSettings={onNavigateToSettings}
          type={redirectModalType}
        />
      )}

      <ConfirmationModal
        isOpen={showDiscardModal}
        onClose={() => setShowDiscardModal(false)}
        onConfirm={() => {
          setShowDiscardModal(false);
          onClose();
        }}
        title="Änderungen verwerfen?"
        message="Es gibt ungespeicherte Änderungen. Möchten Sie diese wirklich verwerfen?"
        confirmText="Änderungen verwerfen"
        cancelText="Weiter bearbeiten"
        isDestructive
      />
    </>
  );
}
