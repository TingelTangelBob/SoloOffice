import React, { useState, useEffect, useCallback } from 'react';
import logger from '../utils/logger';
import { Save, Trash2, Calculator, ChevronUp, ChevronDown, GripVertical, Percent, Eye, FileText, Plus } from 'lucide-react';
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

// Sortable Item Component for Drag & Drop
interface SortableQuoteItemProps {
  item: QuoteItem;
  index: number;
  onUpdate: (id: string, field: keyof QuoteItem, value: string | number | undefined) => void;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  isFirst: boolean;
  isLast: boolean;
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

function SortableQuoteItem({ 
  item, 
  index, 
  onUpdate, 
  onRemove, 
  onMoveUp, 
  onMoveDown, 
  isFirst, 
  isLast,
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
              className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-blue-50"
            >
              <span className="block font-medium text-gray-900">{suggestion.label}</span>
              <span className="block text-xs text-gray-500">{suggestion.detail} · {formatCurrency(suggestion.unitPrice, company.locale, company.numberFormat, company.currency)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // Calculate grid columns dynamically based on isSmallBusiness and discountsEnabled
  const getGridCols = () => {
    if (isSmallBusiness) {
      return discountsEnabled ? 'lg:grid-cols-10' : 'lg:grid-cols-8';
    } else {
      return discountsEnabled ? 'lg:grid-cols-10' : 'lg:grid-cols-9';
    }
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      className={`border border-gray-200 rounded-lg p-3 bg-white ${isDragging ? 'shadow-lg ring-2 ring-blue-300' : ''}`}
    >
      {/* Desktop Layout - Single Row */}
      <div className={`hidden lg:grid gap-3 items-end ${getGridCols()}`}>
        {/* Drag Handle */}
        <div className="col-span-1 flex items-center justify-center">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="p-1.5 text-gray-400 hover:text-gray-600 cursor-move touch-none"
            title="Verschieben"
          >
            <GripVertical className="w-5 h-5" />
          </button>
        </div>

        {/* Beschreibung - 3 columns */}
        <div className="col-span-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Beschreibung *
          </label>
          {renderDescriptionField()}
        </div>
        
        {/* Menge - 1 column */}
        <div className="col-span-1">
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
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Einzelpreis - 1 column */}
        <div className="col-span-1">
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
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* MwSt - 1 column */}
        {!isSmallBusiness && (
          <div className="col-span-1">
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
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Rabatt Type & Value - Combined */}
        {discountsEnabled && (
          <div className={isSmallBusiness ? "col-span-2" : "col-span-1"}>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Rabatt
            </label>
            <div className="flex gap-1">
              <select
                value={item.discountType || ''}
                onChange={(e) => {
                  const newType = e.target.value as 'percentage' | 'fixed' | '';
                  onUpdate(item.id, 'discountType', newType || undefined);
                  if (!newType) {
                    onUpdate(item.id, 'discountValue', undefined);
                  }
                }}
                className="w-16 px-1 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-</option>
                <option value="percentage">%</option>
                <option value="fixed">{currencySymbol}</option>
              </select>
              {item.discountType && (
                <LocalizedNumberInput
                  min="0"
                  max={item.discountType === 'percentage' ? '100' : undefined}
                  step="0.01"
                  value={item.discountValue || ''}
                  locale={company.locale || 'de-DE'}
                  numberFormat={company.numberFormat}
                  onValueChange={(value) => onUpdate(item.id, 'discountValue', value === '' ? undefined : value)}
                  className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={item.discountType === 'percentage' ? '%' : currencySymbol}
                />
              )}
            </div>
          </div>
        )}

        {/* Gesamt - 1 column */}
        <div className="col-span-1">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Gesamt {currencySymbol}
          </label>
          <div className="relative">
            <input
              type="text"
              disabled
              value={formatCurrency(itemTotalAfterDiscount, company.locale, company.numberFormat, company.currency)}
              className={`w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-gray-50 ${
                discountAmount > 0 ? 'text-green-600 font-semibold' : ''
              }`}
            />
            {discountAmount > 0 && (
              <div className="absolute -top-5 right-0 text-xs text-gray-500 line-through">
                {formatCurrency(itemTotalBeforeDiscount, company.locale, company.numberFormat, company.currency)}
              </div>
            )}
          </div>
        </div>

        {/* Actions - 1 column */}
        <div className={isSmallBusiness ? "col-span-1" : "col-span-1"}>
          <div className="flex gap-1 justify-end">
            <button
              type="button"
              onClick={() => onMoveUp(item.id)}
              disabled={isFirst}
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Nach oben verschieben"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onMoveDown(item.id)}
              disabled={isLast}
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Nach unten verschieben"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className="p-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
              title="Position löschen"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
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
              className="p-1.5 text-gray-400 hover:text-gray-600 cursor-move touch-none"
            >
              <GripVertical className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium text-gray-700">Position {index + 1}</span>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onMoveUp(item.id)}
              disabled={isFirst}
              className="p-1.5 text-gray-600 hover:text-gray-900 rounded disabled:opacity-30"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onMoveDown(item.id)}
              disabled={isLast}
              className="p-1.5 text-gray-600 hover:text-gray-900 rounded disabled:opacity-30"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className="p-1.5 text-red-600 hover:text-red-700 rounded"
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

          <div className="grid grid-cols-2 gap-3">
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
            <div>
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

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Rabatt
            </label>
            <div className="flex gap-2">
              <select
                value={item.discountType || ''}
                onChange={(e) => {
                  const newType = e.target.value as 'percentage' | 'fixed' | '';
                  onUpdate(item.id, 'discountType', newType || undefined);
                  if (!newType) {
                    onUpdate(item.id, 'discountValue', undefined);
                  }
                }}
                className="w-24 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Kein</option>
                <option value="percentage">Prozent</option>
                <option value="fixed">Euro</option>
              </select>
              {item.discountType && (
                <LocalizedNumberInput
                  min="0"
                  max={item.discountType === 'percentage' ? '100' : undefined}
                  step="0.01"
                  value={item.discountValue || ''}
                  locale={company.locale || 'de-DE'}
                  numberFormat={company.numberFormat}
                  onValueChange={(value) => onUpdate(item.id, 'discountValue', value === '' ? undefined : value)}
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={item.discountType === 'percentage' ? 'Prozentsatz' : `Betrag in ${currencySymbol}`}
                />
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-gray-200">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-gray-700">Gesamt:</span>
              <div className="text-right">
                {discountAmount > 0 && (
                  <div className="text-xs text-gray-500 line-through">
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
  const [attachments, setAttachments] = useState<QuoteAttachment[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [previewDocuments, setPreviewDocuments] = useState<PreviewDocument[]>([]);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const [redirectModalType, setRedirectModalType] = useState<'hourlyRates' | 'materials' | null>(null);
  const [showDiscardModal, setShowDiscardModal] = useState(false);

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
      discountType: undefined,
      discountValue: undefined,
      discountAmount: 0
    };
  }, [company.isSmallBusiness]);

  // Initialize form
  useEffect(() => {
    if (quote) {
      // Edit mode
      setQuoteNumber(quote.quoteNumber);
      setSelectedCustomerId(quote.customerId);
      setIssueDate(new Date(quote.issueDate).toISOString().split('T')[0]);
      setValidUntil(new Date(quote.validUntil).toISOString().split('T')[0]);
      const existingItems = quote.items || [];
      setItems(existingItems.length > 0 && String(existingItems[existingItems.length - 1].description || '').trim()
        ? [...existingItems, createEmptyItem(existingItems.length + 1)]
        : existingItems);
      setNotes(quote.notes || '');
      setGlobalDiscountType(quote.globalDiscountType || '');
      setGlobalDiscountValue(quote.globalDiscountValue?.toString() || '');
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
      setItems([createEmptyItem(1)]);
    }
    setIsDirty(false);
  }, [quote, customers, createEmptyItem]);

  const requestClose = () => {
    if (isDirty) {
      setShowDiscardModal(true);
      return;
    }
    onClose();
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
    setItems(currentItems => {
      const nextItems = currentItems.map(item => {
      if (item.id === id) {
        let parsedValue: string | number | undefined = value;
        
        // Convert numeric fields to numbers
        if (['quantity', 'unitPrice', 'taxRate', 'discountValue'].includes(field)) {
          if (value === undefined || value === '' || value === null) {
            parsedValue = field === 'discountValue' ? undefined : 0;
          } else {
            parsedValue = parseFloat(String(value));
            if (isNaN(parsedValue)) {
              parsedValue = 0;
            }
          }
        }
        
        const updatedItem = {
          ...item,
          [field]: parsedValue,
          ...(field === 'discountType' && !parsedValue ? { discountValue: undefined } : {})
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
    setItems(currentItems => [...currentItems, {
      id: generateUUID(),
      description,
      quantity: 1,
      unitPrice,
      taxRate,
      total: unitPrice,
      order: currentItems.length + 1,
    }]);
    setShowTemplateDropdown(false);
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const moveItemUp = (id: string) => {
    const index = items.findIndex(item => item.id === id);
    if (index > 0) {
      const newItems = [...items];
      [newItems[index - 1], newItems[index]] = [newItems[index], newItems[index - 1]];
      // Update order values
      newItems.forEach((item, idx) => {
        item.order = idx + 1;
      });
      setItems(newItems);
    }
  };

  const moveItemDown = (id: string) => {
    const index = items.findIndex(item => item.id === id);
    if (index < items.length - 1) {
      const newItems = [...items];
      [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
      // Update order values
      newItems.forEach((item, idx) => {
        item.order = idx + 1;
      });
      setItems(newItems);
    }
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
      alert(`Bitte wählen Sie einen ${terminology.entity.accusative} aus`);
      return;
    }

    const filledItems = items.filter(item => String(item.description || '').trim());

    if (filledItems.length === 0) {
      alert('Bitte fügen Sie mindestens eine Position hinzu');
      return;
    }

    // Validate all items
    for (const item of filledItems) {
      if (!item.description || item.quantity <= 0 || item.unitPrice < 0) {
        alert('Bitte füllen Sie alle Pflichtfelder korrekt aus');
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
        alert(validation.error);
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
      alert('Fehler beim Speichern des Angebots');
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
      const nextItems = currentItems.map(item => item.id === itemId ? {
        ...item,
        description: suggestion.label,
        unitPrice: suggestion.unitPrice,
        taxRate: suggestion.taxRate,
        total: item.quantity * suggestion.unitPrice,
        discountAmount: 0,
        discountType: undefined,
        discountValue: undefined,
      } : item);
      return nextItems[nextItems.length - 1]?.id === itemId
        ? [...nextItems, createEmptyItem(nextItems.length + 1)]
        : nextItems;
    });
  };

  const handleQuotePreview = () => {
    const customer = customers.find(currentCustomer => currentCustomer.id === selectedCustomerId);
    if (!customer) {
      alert(`Bitte wÃ¤hlen Sie zuerst einen ${terminology.entity.singular} aus`);
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
        <div className="space-y-6 pb-2">
          {/* Basic Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
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

            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {terminology.entity.singular} *
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={customerSearchTerm}
                  onChange={handleCustomerSearchChange}
                  onFocus={() => setShowCustomerDropdown(true)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                          className="w-full px-4 py-3 text-left hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-b-0"
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
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
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Gültig bis *
              </label>
              <input
                type="date"
                lang="de-DE"
                required
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <div className="hidden">
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
                                className="w-full px-3 py-2 text-left hover:bg-blue-50 rounded transition-colors"
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
                                className="w-full px-3 py-2 text-left hover:bg-blue-50 rounded transition-colors"
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
              </div>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
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
                      onMoveUp={moveItemUp}
                      onMoveDown={moveItemDown}
                      isFirst={index === 0}
                      isLast={index === items.length - 1}
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
          </div>

          {/* Global Discount */}
          {discountsEnabled && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
              <div className="flex items-center gap-3 mb-3">
                <Percent className="w-5 h-5 text-orange-600" />
                <h3 className="text-sm font-semibold text-gray-900">Rabattzeile</h3>
              </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Rabattart
                </label>
                <select
                  value={globalDiscountType}
                  onChange={(e) => {
                    setGlobalDiscountType(e.target.value as 'percentage' | 'fixed' | '');
                    if (!e.target.value) {
                      setGlobalDiscountValue('');
                    }
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                >
                  <option value="">Kein Rabatt</option>
                  <option value="percentage">Prozentual (%)</option>
                  <option value="fixed">Festbetrag ({currencySymbol})</option>
                </select>
              </div>

              {globalDiscountType && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      {globalDiscountType === 'percentage' ? 'Prozentsatz' : `Betrag in ${currencySymbol}`}
                    </label>
                    <LocalizedNumberInput
                      min="0"
                      max={globalDiscountType === 'percentage' ? '100' : undefined}
                      step="0.01"
                      value={globalDiscountValue}
                      locale={company.locale}
                      numberFormat={company.numberFormat}
                      onValueChange={(value) => setGlobalDiscountValue(value === '' ? '' : String(value))}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder={globalDiscountType === 'percentage' ? '0-100' : '0.00'}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Rabattbetrag
                    </label>
                    <div className="px-3 py-2 text-sm bg-orange-100 text-orange-900 font-semibold rounded-lg border border-orange-200">
                      -{formatMoney(totals.globalDiscountAmount)}
                    </div>
                  </div>
                </>
              )}
            </div>

            {globalDiscountType && globalDiscountValue && (
              <div className="mt-3 text-xs text-gray-600 bg-white/50 rounded p-2">
                <strong>Hinweis:</strong> Der Gesamtrabatt wird auf die Zwischensumme nach Positionsrabatten angewendet.
              </div>
            )}
            </div>
          )}

          {/* Totals */}
          <div className="theme-gradient-surface theme-gradient-surface-totals rounded-lg border p-6 space-y-3">
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

          {/* Attachments */}
          <div>
            <AttachmentManager
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              allowUpload={true}
              title="Anhangs-Dokumente"
              allowPreview={true}
              onPreview={handlePreview}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notizen / Hinweise
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Optional: Zusätzliche Informationen für das Angebot..."
            />
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
