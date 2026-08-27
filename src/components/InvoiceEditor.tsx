import React, { useState, useEffect } from 'react';
import logger from '../utils/logger';
import { Save, X, Plus, Trash2, Calculator, Edit, ChevronUp, ChevronDown, GripVertical, Link2 } from 'lucide-react';
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
import { useInvoices } from '../context/InvoiceContext';
import { useCustomers } from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
import { useDocumentHelpers } from '../hooks/useDocumentHelpers';
import { Invoice, InvoiceItem, InvoiceAttachment, InvoiceTemplate, Customer } from '../types';
import { AttachmentManager } from './AttachmentManager';
import { calculateInvoiceWithDiscounts, updateItemWithDiscount, formatDiscountDisplay } from '../utils/discountUtils';
import { DocumentPreview } from './DocumentPreview';
import type { PreviewDocument } from '../utils/previewDocuments';
import { RatesAndMaterialsRedirectModal } from './RatesAndMaterialsRedirectModal';
import { findDuplicateCustomer, buildDuplicateCustomerMessage, formatCustomerNumber } from '../utils/customerUtils';
import { generateUUID } from '../utils/uuid';
import { formatCurrency, getCurrencySymbol } from '../utils/formatters';
import { LocalizedNumberInput } from './LocalizedNumberInput';
import { getTerminology } from '../utils/terminology';
import { DialogShell } from './DialogShell';
import { useFeedback } from '../context/FeedbackContext';

// Sortable Item Component for Drag & Drop
interface SortableInvoiceItemProps {
  item: InvoiceItem;
  onUpdate: (id: string, field: keyof InvoiceItem, value: string | number | undefined) => void;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  isFirst: boolean;
  isLast: boolean;
  isSmallBusiness: boolean;
}

function SortableInvoiceItem({ 
  item, 
  onUpdate, 
  onRemove, 
  onMoveUp, 
  onMoveDown, 
  isFirst, 
  isLast,
  isSmallBusiness 
}: SortableInvoiceItemProps) {
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

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      className={`border border-gray-200 rounded-lg p-3 ${isDragging ? 'shadow-lg' : ''}`}
    >
      {/* Desktop Layout - Single Row */}
      <div className={`hidden lg:grid gap-3 items-end ${discountsEnabled ? 'lg:grid-cols-12' : 'lg:grid-cols-10'}`}>
        {/* Beschreibung - 3 columns */}
        <div className="col-span-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Beschreibung *
          </label>
          <input
            type="text"
            required
            value={item.description}
            onChange={(e) => onUpdate(item.id, 'description', e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
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
            onBlur={(e) => {
              if (e.target.value === '') {
                onUpdate(item.id, 'quantity', 0);
              }
            }}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        
        {/* Einzelpreis - 1.5 columns */}
        <div className="col-span-1">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Preis *
          </label>
          <LocalizedNumberInput
            min="0"
            step="0.01"
            required
            value={item.unitPrice}
            locale={company.locale}
            numberFormat={company.numberFormat}
            onValueChange={(value) => onUpdate(item.id, 'unitPrice', value)}
            onBlur={(e) => {
              if (e.target.value === '') {
                onUpdate(item.id, 'unitPrice', 0);
              }
            }}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        
        {/* MwSt - 1 column */}
        <div className="col-span-1">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            MwSt.
          </label>
          <select
            value={isSmallBusiness ? 0 : item.taxRate}
            onChange={(e) => onUpdate(item.id, 'taxRate', parseFloat(e.target.value))}
            disabled={isSmallBusiness}
            className={`w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${
              isSmallBusiness ? 'bg-gray-100 cursor-not-allowed' : ''
            }`}
          >
            <option value={0}>0%</option>
            {!isSmallBusiness && <option value={7}>7%</option>}
            {!isSmallBusiness && <option value={19}>19%</option>}
          </select>
        </div>
        
        {/* Rabatt - 2 columns */}
        {discountsEnabled && (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Rabatt
            </label>
            <div className="flex gap-1">
              <select
                value={item.discountType || ''}
                onChange={(e) => {
                  const discountType = e.target.value as 'percentage' | 'fixed' | '';
                  onUpdate(item.id, 'discountType', discountType || undefined);
                  if (!discountType) {
                    onUpdate(item.id, 'discountValue', undefined);
                  }
                }}
                className="w-10 px-1 py-1.5 text-xs border border-gray-300 rounded-l focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">-</option>
                <option value="percentage">%</option>
                <option value="fixed">{currencySymbol}</option>
              </select>
              <LocalizedNumberInput
                min="0"
                step="0.01"
                value={item.discountValue || ''}
                locale={company.locale || 'de-DE'}
                numberFormat={company.numberFormat}
                onValueChange={(value) => onUpdate(item.id, 'discountValue', value === '' ? undefined : value)}
                disabled={!item.discountType}
                placeholder="0"
                className="flex-1 px-2 py-1.5 text-sm border border-l-0 border-gray-300 rounded-r focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
              />
            </div>
          </div>
        )}
        
        {/* Zwischensumme - 1.5 columns */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Summe
          </label>
          <div className="text-sm font-medium text-gray-900 py-1.5 px-2 bg-gray-50 border border-gray-200 rounded">
            {formatCurrency(
              (item.quantity * item.unitPrice) - (item.discountAmount || 0),
              company.locale,
              company.numberFormat,
              company.currency
            )}
          </div>
        </div>
        
        {/* Actions - 1 column */}
        <div className="col-span-2 flex items-center gap-1">
          <div className="flex items-center gap-1">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="min-h-0 h-9 w-9 p-0 inline-flex items-center justify-center text-gray-500 bg-gray-50 border border-gray-200 rounded hover:text-gray-800 hover:bg-gray-100 cursor-grab active:cursor-grabbing"
            title="Ziehen zum Verschieben"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMoveUp(item.id)}
            disabled={isFirst}
            className="min-h-0 h-9 w-9 p-0 inline-flex items-center justify-center text-gray-600 bg-white border border-gray-300 rounded hover:text-gray-900 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Nach oben"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMoveDown(item.id)}
            disabled={isLast}
            className="min-h-0 h-9 w-9 p-0 inline-flex items-center justify-center text-gray-600 bg-white border border-gray-300 rounded hover:text-gray-900 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Nach unten"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          </div>
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="min-h-0 h-9 w-9 ml-auto p-0 inline-flex items-center justify-center text-red-600 bg-red-50 border border-red-100 rounded hover:text-red-800 hover:bg-red-100"
            title="Löschen"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile/Tablet Layout - Stacked */}
      <div className="lg:hidden space-y-3">
        {/* Beschreibung - Full width */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Beschreibung *
          </label>
          <input
            type="text"
            required
            value={item.description}
            onChange={(e) => onUpdate(item.id, 'description', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        
        {/* First row: Menge, Preis, MwSt */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Menge *
            </label>
            <LocalizedNumberInput
              min="0"
              step="0.01"
              required
              value={item.quantity}
                locale={company.locale || 'de-DE'}
              numberFormat={company.numberFormat}
              onValueChange={(value) => onUpdate(item.id, 'quantity', value)}
              onBlur={(e) => {
                if (e.target.value === '') {
                  onUpdate(item.id, 'quantity', 0);
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Preis *
            </label>
            <LocalizedNumberInput
              min="0"
              step="0.01"
              required
              value={item.unitPrice}
              locale={company.locale}
              numberFormat={company.numberFormat}
              onValueChange={(value) => onUpdate(item.id, 'unitPrice', value)}
              onBlur={(e) => {
                if (e.target.value === '') {
                  onUpdate(item.id, 'unitPrice', 0);
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              MwSt. %
            </label>
            <select
              value={isSmallBusiness ? 0 : item.taxRate}
              onChange={(e) => onUpdate(item.id, 'taxRate', parseFloat(e.target.value))}
              disabled={isSmallBusiness}
              className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                isSmallBusiness ? 'bg-gray-100 cursor-not-allowed' : ''
              }`}
            >
              <option value={0}>0%</option>
              {!isSmallBusiness && <option value={7}>7%</option>}
              {!isSmallBusiness && <option value={19}>19%</option>}
            </select>
          </div>
        </div>
        
        {/* Second row: Rabatt, Summe */}
        <div className={`grid gap-3 ${discountsEnabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {discountsEnabled && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Rabatt
              </label>
              <div className="flex gap-1">
                <select
                  value={item.discountType || ''}
                  onChange={(e) => {
                    const discountType = e.target.value as 'percentage' | 'fixed' | '';
                    onUpdate(item.id, 'discountType', discountType || undefined);
                    if (!discountType) {
                      onUpdate(item.id, 'discountValue', undefined);
                    }
                  }}
                  className="w-12 px-1 py-1.5 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                >
                  <option value="">-</option>
                  <option value="percentage">%</option>
                  <option value="fixed">{currencySymbol}</option>
                </select>
                <LocalizedNumberInput
                  min="0"
                  step="0.01"
                  value={item.discountValue || ''}
                  locale={company.locale}
                  numberFormat={company.numberFormat}
                  onValueChange={(value) => onUpdate(item.id, 'discountValue', value === '' ? undefined : value)}
                  disabled={!item.discountType}
                  placeholder="0"
                  className="flex-1 px-2 py-1.5 border border-l-0 border-gray-300 rounded-r-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 text-xs min-w-0"
                />
              </div>
              {item.discountType && item.discountValue && (
                <p className="text-xs text-gray-500 mt-1 break-words">
                  -{formatDiscountDisplay(
                    item.discountType,
                    item.discountValue,
                    item.discountAmount,
                    company.locale,
                    company.numberFormat,
                    company.currency
                  )}
                </p>
              )}
            </div>
          )}
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Summe
            </label>
            <div className="text-xs font-medium text-gray-900 py-1.5 px-2 bg-gray-50 border border-gray-200 rounded-lg">
              {formatCurrency(
                (item.quantity * item.unitPrice) - (item.discountAmount || 0),
                company.locale,
                company.numberFormat,
                company.currency
              )}
            </div>
            {item.discountAmount && item.discountAmount > 0 && (
              <div className="text-xs text-gray-500 mt-1 break-words">
                ({formatCurrency(item.quantity * item.unitPrice, company.locale, company.numberFormat, company.currency)} - {formatCurrency(item.discountAmount, company.locale, company.numberFormat, company.currency)})
              </div>
            )}
          </div>
        </div>
        
        {/* Actions row */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <div className="flex items-center space-x-2">
            <button
              type="button"
              {...attributes}
              {...listeners}
              className="min-h-0 p-2 text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:text-gray-900 hover:bg-gray-100 cursor-grab active:cursor-grabbing"
              title="Ziehen zum Verschieben"
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onMoveUp(item.id)}
              disabled={isFirst}
              className="min-h-0 p-2 text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Nach oben verschieben"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onMoveDown(item.id)}
              disabled={isLast}
              className="min-h-0 p-2 text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Nach unten verschieben"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="min-h-0 p-2 text-red-600 bg-red-50 border border-red-100 rounded-lg hover:text-red-800 hover:bg-red-100"
            title="Löschen"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        
        {/* Small business notice for mobile */}
        {isSmallBusiness && (
          <p className="text-xs text-gray-500 text-center">
            MwSt. durch Kleinunternehmerregelung deaktiviert
          </p>
        )}
      </div>
    </div>
  );
}

interface InvoiceEditorProps {
  invoice?: Invoice | null;
  onClose: () => void;
  onCreateCustomer?: () => void;
  onNavigateToCustomers?: () => void;
  onNavigateToSettings?: () => void;
}

export function InvoiceEditor({ invoice, onClose, onCreateCustomer, onNavigateToCustomers, onNavigateToSettings }: InvoiceEditorProps) {
  const { confirm, notify } = useFeedback();
  const { customers, addCustomer, refreshCustomers } = useCustomers();
  const { addInvoice, updateInvoice, refreshInvoices } = useInvoices();
  const {
    company,
    getInvoiceTemplates,
    addInvoiceTemplate,
    updateInvoiceTemplate,
    deleteInvoiceTemplate,
  } = useCompany();
  const {
    getCombinedHourlyRatesForCustomer,
    getCombinedMaterialTemplatesForCustomer,
  } = useDocumentHelpers();
  const discountsEnabled = company.discountsEnabled !== false;
  const terminology = getTerminology(company.terminologyProfile);
  const currencySymbol = getCurrencySymbol(company.locale, company.numberFormat, company.currency);
  const formatMoney = (amount: number) => formatCurrency(
    amount,
    company.locale,
    company.numberFormat,
    company.currency
  );
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showInvoiceTemplateForm, setShowInvoiceTemplateForm] = useState(false);
  const [showInvoiceTemplateManager, setShowInvoiceTemplateManager] = useState(false);
  const [showRatesRedirectModal, setShowRatesRedirectModal] = useState<{
    isOpen: boolean;
    type: 'hourlyRates' | 'materials';
  }>({
    isOpen: false,
    type: 'hourlyRates'
  });
  const [editingInvoiceTemplate, setEditingInvoiceTemplate] = useState<InvoiceTemplate | null>(null);
  const [newCustomerData, setNewCustomerData] = useState({
    name: '',
    email: '',
    address: '',
    addressSupplement: '',
    postalCode: '',
    city: '',
    country: 'Deutschland',
    taxId: '',
    phone: ''
  });
  const [newInvoiceTemplateData, setNewInvoiceTemplateData] = useState({
    name: '',
    description: '',
    unitPrice: 0,
    unit: 'Stunde',
    taxRate: 19,
    isDefault: false
  });

  const closeInvoiceTemplateForm = () => {
    setNewInvoiceTemplateData({
      name: '',
      description: '',
      unitPrice: 0,
      unit: 'Stunde',
      taxRate: 19,
      isDefault: false
    });
    setEditingInvoiceTemplate(null);
    setShowInvoiceTemplateForm(false);
  };

  // Customer search states
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);
  
  // We'll define these helper functions after formData is available
  
  // Berechne das Standard-Fälligkeitsdatum basierend auf Rechnungsdatum und Unternehmenseinstellungen
  const calculateDueDate = (issueDate: string) => {
    // Überprüfung ob das Datum gültig ist
    if (!issueDate || issueDate.length < 10) {
      // Fallback zu heutigem Datum wenn ungültig
      const fallbackDate = new Date();
      const paymentDays = company.defaultPaymentDays !== undefined ? company.defaultPaymentDays : 30;
      const dueDateObj = new Date(fallbackDate.getTime() + paymentDays * 24 * 60 * 60 * 1000);
      return dueDateObj.toISOString().split('T')[0];
    }
    
    const paymentDays = company.defaultPaymentDays !== undefined ? company.defaultPaymentDays : 30;
    const issueDateObj = new Date(issueDate);
    
    // Überprüfung ob das Datum korrekt geparst wurde
    if (isNaN(issueDateObj.getTime())) {
      // Fallback zu heutigem Datum wenn ungültig
      const fallbackDate = new Date();
      const dueDateObj = new Date(fallbackDate.getTime() + paymentDays * 24 * 60 * 60 * 1000);
      return dueDateObj.toISOString().split('T')[0];
    }
    
    // Bei 0 Tagen ist das Fälligkeitsdatum das Rechnungsdatum selbst
    const dueDateObj = new Date(issueDateObj.getTime() + paymentDays * 24 * 60 * 60 * 1000);
    return dueDateObj.toISOString().split('T')[0];
  };
  
  const [formData, setFormData] = useState({
    invoiceNumber: '',
    customerId: '',
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: calculateDueDate(new Date().toISOString().split('T')[0]),
    status: 'draft' as Invoice['status'],
    notes: '',
    globalDiscountType: undefined as 'percentage' | 'fixed' | undefined,
    globalDiscountValue: undefined as number | undefined,
    globalDiscountAmount: undefined as number | undefined,
  });
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [attachments, setAttachments] = useState<InvoiceAttachment[]>([]);

  // Document Preview state
  const [documentPreview, setDocumentPreview] = useState<{
    isOpen: boolean;
    documents: PreviewDocument[];
    initialIndex: number;
  }>({
    isOpen: false,
    documents: [],
    initialIndex: 0
  });

  // Initialize form data when editing
  useEffect(() => {
    if (invoice) {
      setFormData({
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId,
        issueDate: new Date(invoice.issueDate).toISOString().split('T')[0],
        dueDate: new Date(invoice.dueDate).toISOString().split('T')[0],
        status: invoice.status,
        notes: invoice.notes || '',
        globalDiscountType: invoice.globalDiscountType,
        globalDiscountValue: invoice.globalDiscountValue,
        globalDiscountAmount: invoice.globalDiscountAmount,
      });
      // Sort items by order and ensure all items have an order value
      const sortedItems = [...invoice.items]
        .sort((a, b) => (a.order || 999) - (b.order || 999))
        .map((item, index) => ({
          ...item,
          order: item.order || index + 1  // Fallback to index-based order for existing items
        }));
      setItems(sortedItems);
      setAttachments(invoice.attachments || []);
    } else {
      // For new invoices, leave invoice number empty - it will be generated by the backend
      setFormData(prev => ({ ...prev, invoiceNumber: '' }));
    }
  }, [invoice]);

  // Filter customers based on search term
  const filteredCustomers = customers.filter(customer =>
    customer.name.toLowerCase().includes(customerSearchTerm.toLowerCase()) ||
    (customer.customerNumber && customer.customerNumber.toLowerCase().includes(customerSearchTerm.toLowerCase()))
  );
  
  // Get selected customer display name
  const selectedCustomer = customers.find(customer => customer.id === formData.customerId);
  const selectedCustomerDisplayName = selectedCustomer ? 
    `${formatCustomerNumber(selectedCustomer.customerNumber)} - ${selectedCustomer.name}` : '';
    
  // Handle customer selection
  const handleCustomerSelect = (customer: Customer) => {
    setFormData(prev => ({ ...prev, customerId: customer.id }));
    setCustomerSearchTerm(`${formatCustomerNumber(customer.customerNumber)} - ${customer.name}`);
    setIsCustomerDropdownOpen(false);
  };
  
  // Handle customer search input
  const handleCustomerSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomerSearchTerm(e.target.value);
    setIsCustomerDropdownOpen(true);
    
    // If search is cleared, clear the selected customer
    if (!e.target.value) {
      setFormData(prev => ({ ...prev, customerId: '' }));
    }
  };
  
  // Initialize search term when invoice is loaded
  useEffect(() => {
    if (formData.customerId && !customerSearchTerm) {
      setCustomerSearchTerm(selectedCustomerDisplayName);
    }
  }, [formData.customerId, selectedCustomerDisplayName, customerSearchTerm]);

  const addItem = () => {
    const newItem: InvoiceItem = {
      id: generateUUID(),
      description: '',
      quantity: 1,
      unitPrice: 0,
      taxRate: company?.isSmallBusiness ? 0 : 19,
      total: 0,
      order: items.length + 1,
      discountType: undefined,
      discountValue: undefined,
      discountAmount: 0,
    };
    setItems(prev => [...prev, newItem]);
  };

  const addItemFromTemplate = (templateType: 'invoice' | 'material' | 'hourly', templateId: string) => {
    let newItem: InvoiceItem;

    if (templateType === 'invoice') {
      const template = getInvoiceTemplates().find(t => t.id === templateId);
      if (!template) return;
      
      newItem = {
        id: generateUUID(),
        description: template.name,
        quantity: 1,
        unitPrice: Number(template.unitPrice || 0),
        taxRate: company?.isSmallBusiness ? 0 : template.taxRate,
        total: Number(template.unitPrice || 0),
        order: items.length + 1,
        discountType: undefined,
        discountValue: undefined,
        discountAmount: 0,
      };
    } else if (templateType === 'material') {
      // Search in combined templates (both general and customer-specific)
      const template = getCombinedMaterialTemplatesForCustomer(formData.customerId).find(t => t.id === templateId);
      if (!template) return;
      
      newItem = {
        id: generateUUID(),
        description: template.name,
        quantity: 1,
        unitPrice: Number(template.unitPrice || 0),
        taxRate: company?.isSmallBusiness ? 0 : (template.taxRate != null ? template.taxRate : 19),
        total: Number(template.unitPrice || 0),
        order: items.length + 1,
        discountType: undefined,
        discountValue: undefined,
        discountAmount: 0,
      };
    } else { // hourly
      // Search in combined templates (both general and customer-specific)
      const template = getCombinedHourlyRatesForCustomer(formData.customerId).find(t => t.id === templateId);
      if (!template) return;
      
      newItem = {
        id: generateUUID(),
        description: template.name,
        quantity: 1,
        unitPrice: Number(template.rate || 0),
        taxRate: company?.isSmallBusiness ? 0 : (template.taxRate != null ? template.taxRate : 19),
        total: Number(template.rate || 0),
        order: items.length + 1,
        discountType: undefined,
        discountValue: undefined,
        discountAmount: 0,
      };
    }

    setItems(prev => [...prev, newItem]);
  };

  const updateItem = (id: string, field: keyof InvoiceItem, value: string | number | undefined) => {
    setItems(prev => prev.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value };
        // Bei Kleinunternehmerregelung immer MwSt. auf 0 setzen
        if (company?.isSmallBusiness && field === 'taxRate') {
          updated.taxRate = 0;
        }
        
        // Berechne Rabatte und Gesamtsumme neu bei relevanten Änderungen
        if (field === 'quantity' || field === 'unitPrice' || field === 'taxRate' || 
            field === 'discountType' || field === 'discountValue') {
          const updatedWithDiscount = updateItemWithDiscount(updated);
          return updatedWithDiscount;
        }
        
        return updated;
      }
      return item;
    }));
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const moveItemUp = (id: string) => {
    setItems(prev => {
      const index = prev.findIndex(item => item.id === id);
      if (index <= 0) return prev; // Can't move first item up
      
      const newItems = [...prev];
      // Swap with previous item
      [newItems[index - 1], newItems[index]] = [newItems[index], newItems[index - 1]];
      
      // Update order values
      return newItems.map((item, i) => ({
        ...item,
        order: i + 1
      }));
    });
  };

  const moveItemDown = (id: string) => {
    setItems(prev => {
      const index = prev.findIndex(item => item.id === id);
      if (index >= prev.length - 1) return prev; // Can't move last item down
      
      const newItems = [...prev];
      // Swap with next item
      [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
      
      // Update order values
      return newItems.map((item, i) => ({
        ...item,
        order: i + 1
      }));
    });
  };

  // Drag & Drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      setItems((items) => {
        const oldIndex = items.findIndex(item => item.id === active.id);
        const newIndex = items.findIndex(item => item.id === over?.id);

        const newItems = arrayMove(items, oldIndex, newIndex);
        
        // Update order values
        return newItems.map((item, i) => ({
          ...item,
          order: i + 1
        }));
      });
    }
  };

  const calculateTotals = () => {
    // Verwende die neue Rabattberechnungsfunktion
    const invoiceData = {
      items,
      globalDiscountType: formData.globalDiscountType,
      globalDiscountValue: formData.globalDiscountValue,
      globalDiscountAmount: formData.globalDiscountAmount
    };
    
    const calculation = calculateInvoiceWithDiscounts(invoiceData);
    
    // Group items by tax rate for breakdown display
    const taxBreakdown = items.reduce((acc, item) => {
      const itemTotal = (item.quantity * item.unitPrice) - (item.discountAmount || 0);
      const taxRate = item.taxRate;
      const taxAmount = itemTotal * (taxRate / 100);
      
      if (acc[taxRate]) {
        acc[taxRate].taxableAmount += itemTotal;
        acc[taxRate].taxAmount += taxAmount;
      } else {
        acc[taxRate] = {
          taxableAmount: itemTotal,
          taxAmount: taxAmount
        };
      }
      
      return acc;
    }, {} as Record<number, { taxableAmount: number; taxAmount: number }>);
    
    // Adjust tax breakdown for global discount
    if (calculation.globalDiscountAmount > 0 && calculation.subtotal > 0) {
      const discountRatio = calculation.globalDiscountAmount / (calculation.subtotal - calculation.itemDiscountAmount);
      Object.keys(taxBreakdown).forEach(taxRateStr => {
        const taxRate = Number(taxRateStr);
        const breakdown = taxBreakdown[taxRate];
        breakdown.taxableAmount *= (1 - discountRatio);
        breakdown.taxAmount = (breakdown.taxableAmount * taxRate) / 100;
      });
    }
    
    // Check if invoice has only 0% tax rate
    const hasOnlyZeroTax = items.length > 0 && items.every(item => item.taxRate === 0);
    
    return { 
      subtotal: calculation.subtotal,
      itemDiscountAmount: calculation.itemDiscountAmount,
      globalDiscountAmount: calculation.globalDiscountAmount,
      totalDiscountAmount: calculation.totalDiscountAmount,
      discountedSubtotal: calculation.discountedSubtotal,
      taxAmount: calculation.taxAmount, 
      taxBreakdown, 
      total: calculation.total, 
      hasOnlyZeroTax 
    };
  };

  const handlePreview = (attachments: (InvoiceAttachment)[], initialIndex: number) => {
    // Convert attachments to preview documents
    const documents: PreviewDocument[] = attachments.map(attachment => ({
      id: attachment.id,
      name: attachment.name,
      type: 'attachment' as const,
      content: attachment.content,
      contentType: attachment.contentType,
      size: attachment.size
    }));
    
    setDocumentPreview({
      isOpen: true,
      documents,
      initialIndex
    });
  };

  const handleClosePreview = () => {
    setDocumentPreview({
      isOpen: false,
      documents: [],
      initialIndex: 0
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) {
      notify({ variant: 'warning', message: 'Bitte fügen Sie mindestens eine Position hinzu.' });
      return;
    }

    const customer = customers.find(c => c.id === formData.customerId);
    if (!customer) {
      notify({ variant: 'warning', message: `Bitte wählen Sie einen ${terminology.entity.accusative} aus.` });
      return;
    }

    const calculation = calculateTotals();

    const invoiceData: Omit<Invoice, 'id' | 'createdAt'> = {
      invoiceNumber: invoice ? formData.invoiceNumber : '', // Keep existing number for updates, empty for new invoices
      customerId: formData.customerId,
      customerName: customer.name,
      issueDate: new Date(formData.issueDate),
      dueDate: new Date(formData.dueDate),
      items,
      subtotal: calculation.subtotal,
      taxAmount: calculation.taxAmount,
      total: calculation.total,
      status: formData.status,
      notes: formData.notes,
      attachments,
      globalDiscountType: formData.globalDiscountType,
      globalDiscountValue: formData.globalDiscountValue,
      globalDiscountAmount: calculation.globalDiscountAmount,
    };

    try {
      if (invoice) {
        await updateInvoice(invoice.id, invoiceData);
      } else {
        await addInvoice(invoiceData);
        // Refresh invoices in other components
        await refreshInvoices();
      }
      onClose();
    } catch (error) {
      logger.error('Failed to save invoice', { error: (error as Error).message });
      notify({
        variant: 'error',
        title: invoice ? 'Rechnung konnte nicht gespeichert werden' : 'Rechnung konnte nicht erstellt werden',
        message: error instanceof Error ? error.message : 'Die Rechnung konnte wegen eines unbekannten Fehlers nicht gespeichert werden.',
      });
    }
  };

  const { 
    subtotal, 
    itemDiscountAmount, 
    globalDiscountAmount, 
    totalDiscountAmount, 
    discountedSubtotal, 
    taxAmount, 
    taxBreakdown, 
    total, 
    hasOnlyZeroTax 
  } = calculateTotals();

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-start">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 break-words">
              {invoice ? 'Rechnung bearbeiten' : 'Neue Rechnung'}
            </h2>
          <p className="text-gray-600 mt-1 text-sm sm:text-base break-words">
            {invoice ? `${invoice.invoiceNumber}` : 'Erstellen Sie eine neue Rechnung'}
          </p>
          {invoice && ((invoice.sourceQuoteNumber || invoice.sourceQuoteId) || (invoice.sourceJobs && invoice.sourceJobs.length > 0)) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900">
              <span className="inline-flex items-center gap-1.5 font-semibold"><Link2 className="h-3.5 w-3.5" />Quelle</span>
              {invoice.sourceQuoteNumber && <span>Angebot {invoice.sourceQuoteNumber}</span>}
              {invoice.sourceJobs && invoice.sourceJobs.length > 0 && (
                <span>Auftragseinheiten: {invoice.sourceJobs.map(source => source.jobNumber).join(', ')}</span>
              )}
            </div>
          )}
        </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 ml-4 flex-shrink-0"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Grundinformationen</h3>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rechnungsnummer
              </label>
              <input
                type="text"
                value={formData.invoiceNumber}
                placeholder={invoice ? "" : "Wird automatisch generiert"}
                disabled={true}
                readOnly={true}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 mt-1">
                {invoice ? "Rechnungsnummern können nach der Erstellung nicht mehr geändert werden" : `Die Rechnungsnummer wird beim Speichern nach dem Muster ${company.invoiceNumberPattern || 'RE-{YYYY}-{NNN}'} erzeugt.`}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {terminology.entity.singular} *
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={customerSearchTerm}
                    onChange={handleCustomerSearchChange}
                    onFocus={() => setIsCustomerDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setIsCustomerDropdownOpen(false), 200)}
                    placeholder={`${terminology.entity.singular} suchen oder auswählen...`}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  {isCustomerDropdownOpen && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {filteredCustomers.length > 0 ? (
                        filteredCustomers.map(customer => (
                          <button
                            key={customer.id}
                            type="button"
                            onClick={() => handleCustomerSelect(customer)}
                            className="w-full text-left px-3 py-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none border-b border-gray-100 last:border-b-0"
                          >
                            <div className="font-medium text-sm break-words">{formatCustomerNumber(customer.customerNumber)} - {customer.name}</div>
                            {customer.email && (
                              <div className="text-xs text-gray-500 break-words">{customer.email}</div>
                            )}
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-gray-500 text-sm">
                          {terminology.entity.noResults}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {onCreateCustomer && (
                  <button
                    type="button"
                    onClick={() => {
                      logger.debug('Plus button clicked in InvoiceEditor');
                      setShowCustomerForm(true);
                    }}
                    className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center justify-center text-sm sm:w-auto w-full"
                          title={terminology.entity.newLabel}
                  >
                    <Plus className="h-4 w-4 mr-2 sm:mr-0" />
                    <span className="sm:hidden">{terminology.entity.newLabel}</span>
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rechnungsdatum *
              </label>
              <input
                type="date"
                required
                value={formData.issueDate}
                onChange={(e) => {
                  const newIssueDate = e.target.value;
                  try {
                    setFormData(prev => ({ 
                      ...prev, 
                      issueDate: newIssueDate,
                      dueDate: calculateDueDate(newIssueDate)
                    }));
                  } catch (error) {
                    logger.warn('Error calculating due date', { error: (error as Error).message });
                    // Nur das Issue Date aktualisieren wenn Berechnung fehlschlägt
                    setFormData(prev => ({ 
                      ...prev, 
                      issueDate: newIssueDate
                    }));
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fälligkeitsdatum *
              </label>
              <input
                type="date"
                required
                value={formData.dueDate}
                onChange={(e) => setFormData(prev => ({ ...prev, dueDate: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Wird automatisch auf {company.defaultPaymentDays !== undefined ? company.defaultPaymentDays : 30} Tage nach Rechnungsdatum gesetzt. {(company.defaultPaymentDays !== undefined ? company.defaultPaymentDays : 30) === 0 && 'Bei 0 Tagen ist die Rechnung sofort fällig.'}
              </p>
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
          <div className="flex flex-col gap-4 mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Positionen</h3>
            
            {/* Mobile-first layout for controls */}
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
              {/* Template selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Aus Vorlage</label>
                <div className="flex gap-2">
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        const [templateType, templateId] = e.target.value.split(':');
                        addItemFromTemplate(templateType as 'invoice' | 'material' | 'hourly', templateId);
                        e.target.value = ''; // Reset dropdown
                      }
                    }}
                    className="min-w-0 flex-1 px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    defaultValue=""
                  >
                    <option value="">Vorlage wählen...</option>
                    
                    {/* Eigene Rechnungsvorlagen */}
                    {getInvoiceTemplates().length > 0 && (
                      <optgroup label="Eigene Positionen">
                        {getInvoiceTemplates().map((template) => (
                          <option key={`invoice:${template.id}`} value={`invoice:${template.id}`}>
                            {template.name} - {formatMoney(Number(template.unitPrice) || 0)}/{template.unit}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    
                    {/* Stundensätze - kombiniert (allgemein + profilspezifisch) */}
                    {getCombinedHourlyRatesForCustomer(formData.customerId).length > 0 && (
                      <optgroup label="Stundensätze">
                        {getCombinedHourlyRatesForCustomer(formData.customerId).map((rate) => (
                          <option key={`hourly:${rate.id}`} value={`hourly:${rate.id}`}>
                            {rate.displayName} - {formatMoney(Number(rate.rate) || 0)}/h
                          </option>
                        ))}
                      </optgroup>
                    )}
                    
                    {/* Materialien - kombiniert (allgemein + profilspezifisch) */}
                    {getCombinedMaterialTemplatesForCustomer(formData.customerId).length > 0 && (
                      <optgroup label="Materialien">
                        {getCombinedMaterialTemplatesForCustomer(formData.customerId).map((material) => (
                          <option key={`material:${material.id}`} value={`material:${material.id}`}>
                            {material.displayName} - {formatMoney(Number(material.unitPrice) || 0)}/{material.unit}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowRatesRedirectModal({
                      isOpen: true,
                      type: 'materials'
                    })}
                    className="min-h-0 p-2.5 text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:text-blue-800 hover:bg-blue-100 transition-colors flex-shrink-0"
                    title="Stundensätze und Materialien verwalten"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              {/* Manual add button */}
              <button
                type="button"
                onClick={addItem}
                className="btn-primary min-h-0 px-4 py-2.5 rounded-lg flex items-center justify-center space-x-2 transition-colors w-full md:w-auto whitespace-nowrap"
              >
                <Plus className="h-4 w-4" />
                <span>Manuell hinzufügen</span>
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
              <div className="space-y-4">
                {items.map((item, index) => (
                  <SortableInvoiceItem
                    key={item.id}
                    item={item}
                    onUpdate={updateItem}
                    onRemove={removeItem}
                    onMoveUp={moveItemUp}
                    onMoveDown={moveItemDown}
                    isFirst={index === 0}
                    isLast={index === items.length - 1}
                    isSmallBusiness={company?.isSmallBusiness || false}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {items.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Calculator className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <p>Keine Positionen hinzugefügt. Klicken Sie auf "Manuell hinzufügen" um zu beginnen.</p>
            </div>
          )}
        </div>

        {/* Global Discount Section */}
        {items.length > 0 && discountsEnabled && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Gesamtrabatt</h3>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Rabatttyp
                </label>
                <select
                  value={formData.globalDiscountType || ''}
                  onChange={(e) => {
                    const discountType = e.target.value as 'percentage' | 'fixed' | '';
                    setFormData(prev => ({ 
                      ...prev, 
                      globalDiscountType: discountType || undefined,
                      globalDiscountValue: discountType ? prev.globalDiscountValue : undefined
                    }));
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Kein Gesamtrabatt</option>
                  <option value="percentage">Prozentual (%)</option>
                  <option value="fixed">Festbetrag ({currencySymbol})</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Rabattwert
                </label>
                <div className="flex">
                  <LocalizedNumberInput
                    min="0"
                    step="0.01"
                    value={formData.globalDiscountValue || ''}
                    locale={company.locale}
                    numberFormat={company.numberFormat}
                    onValueChange={(value) => setFormData(prev => ({
                      ...prev,
                      globalDiscountValue: value === '' ? undefined : value
                    }))}
                    disabled={!formData.globalDiscountType}
                    placeholder="0"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 min-w-0"
                  />
                  <div className="px-3 py-2 bg-gray-100 border border-l-0 border-gray-300 rounded-r-lg text-gray-600 text-sm flex items-center flex-shrink-0">
                    {formData.globalDiscountType === 'percentage' ? '%' : currencySymbol}
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Rabattbetrag
                </label>
                <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 font-medium">
                  {formatMoney(globalDiscountAmount || 0)}
                </div>
              </div>
            </div>
            
            {formData.globalDiscountType && formData.globalDiscountValue && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>Gesamtrabatt:</strong> {formatDiscountDisplay(
                    formData.globalDiscountType,
                    formData.globalDiscountValue,
                    globalDiscountAmount,
                    company.locale,
                    company.numberFormat,
                    company.currency
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Totals */}
        {items.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Gesamtsumme</h3>
            <div className="space-y-2 text-sm sm:text-base">
              <div className="flex justify-between">
                <span className="text-gray-600">Zwischensumme:</span>
                <span className="font-medium">{formatMoney(subtotal)}</span>
              </div>
              
              {/* Show item discounts if any */}
              {discountsEnabled && itemDiscountAmount > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Artikelrabatte:</span>
                  <span>-{formatMoney(itemDiscountAmount)}</span>
                </div>
              )}
              
              {/* Show global discount if any */}
              {discountsEnabled && globalDiscountAmount > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Gesamtrabatt:</span>
                  <span>-{formatMoney(globalDiscountAmount)}</span>
                </div>
              )}
              
              {/* Show subtotal after discounts if discounts exist */}
              {discountsEnabled && (itemDiscountAmount > 0 || globalDiscountAmount > 0) && (
                <div className="flex justify-between border-t pt-2">
                  <span className="text-gray-600">Zwischensumme nach Rabatt:</span>
                  <span className="font-medium">{formatMoney(discountedSubtotal)}</span>
                </div>
              )}
              
              {/* Show each tax rate separately (exclude 0% rates) */}
              {Object.keys(taxBreakdown).filter(rate => Number(rate) > 0).length > 0 && (
                <>
                  {Object.entries(taxBreakdown)
                    .filter(([rate]) => Number(rate) > 0)
                    .sort(([rateA], [rateB]) => Number(rateA) - Number(rateB))
                    .map(([rate, breakdown]) => (
                    <div key={rate} className="flex justify-between">
                      <span className="text-gray-600">
                        MwSt. ({rate}%):
                      </span>
                      <span className="font-medium">{formatMoney(breakdown.taxAmount)}</span>
                    </div>
                  ))}
                </>
              )}
              
              {/* Show total tax amount if multiple rates > 0% exist */}
              {Object.keys(taxBreakdown).filter(rate => Number(rate) > 0).length > 1 && (
                <div className="flex justify-between text-sm border-t pt-1 mt-1">
                  <span className="text-gray-600">MwSt. gesamt:</span>
                  <span className="font-medium">{formatMoney(taxAmount)}</span>
                </div>
              )}
              
              <div className="flex justify-between text-lg font-bold border-t pt-2">
                <span>Gesamtbetrag:</span>
                <span>{formatMoney(total)}</span>
              </div>
              
              {/* Show total discount summary if any */}
              {totalDiscountAmount > 0 && (
                <div className="flex justify-between text-sm text-green-600 border-t pt-2">
                  <span>Gesamtersparnis:</span>
                  <span className="font-medium">{formatMoney(totalDiscountAmount)}</span>
                </div>
              )}
              
              {/* Klausel für ausschließlich 0% MwSt. */}
              {hasOnlyZeroTax && (
                <div className="border-t pt-3 mt-3">
                  <p className="text-sm font-bold text-gray-900 text-center">
                    {company?.isSmallBusiness 
                      ? 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung)'
                      : 'Gemäß § 13b UStG geht die Steuerschuld auf den Leistungsempfänger über'
                    }
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Notizen</h3>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
            rows={4}
            placeholder="Zusätzliche Informationen oder Zahlungshinweise..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {/* Attachments */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Anhänge</h3>
          <AttachmentManager
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            allowUpload={true}
            allowPreview={true}
            onPreview={handlePreview}
          />
        </div>

        {/* Actions */}
        <div className="form-action-bar">
          <button
            type="submit"
            className="btn-primary order-2 rounded-lg px-6 py-3 transition-colors sm:py-2"
          >
            <Save className="h-4 w-4" />
            <span>{invoice ? 'Aktualisieren' : 'Erstellen'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="order-1 rounded-lg border border-gray-300 px-6 py-3 text-gray-700 transition-colors hover:bg-gray-50 sm:py-2"
          >
            Abbrechen
          </button>
        </div>
      </form>

      {/* Customer Creation Modal */}
      {showCustomerForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-lg p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {terminology.entity.newLabel}
            </h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              
              // Check for duplicates
              const existingCustomer = findDuplicateCustomer(customers, newCustomerData);
              
              if (existingCustomer) {
                notify({
                  variant: 'warning',
                  title: `${terminology.entity.singular} existiert bereits`,
                  message: buildDuplicateCustomerMessage(existingCustomer, terminology.entity.singular, terminology.entity.numberShortLabel.replace(/\.$/, '')),
                });
                return;
              }
              
              try {
                const createdCustomer = await addCustomer(newCustomerData);
                
                // Pre-select the newly created customer
                if (createdCustomer && createdCustomer.id) {
                  setFormData(prev => ({ ...prev, customerId: createdCustomer.id }));
                }
                
                setNewCustomerData({
                  name: '',
                  email: '',
                  address: '',
                  addressSupplement: '',
                  postalCode: '',
                  city: '',
                  country: 'Deutschland',
                  taxId: '',
                  phone: ''
                });
                setShowCustomerForm(false);
                
                // Refresh customers in other components
                await refreshCustomers();
              } catch (error) {
                logger.error('Failed to create customer', { error: (error as Error).message });
                notify({ variant: 'error', message: `Fehler beim Erstellen des ${terminology.entity.genitive}. Bitte versuchen Sie es erneut.` });
              }
            }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  required
                  value={newCustomerData.name}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  E-Mail
                </label>
                <input
                  type="email"
                  value={newCustomerData.email}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  placeholder="optional"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Adresse *
                </label>
                <input
                  type="text"
                  required
                  value={newCustomerData.address}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, address: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Adresszusatz
                </label>
                <input
                  type="text"
                  value={newCustomerData.addressSupplement}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, addressSupplement: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  placeholder="z.B. 2. Stock, Hintereingang"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    PLZ *
                  </label>
                  <input
                    type="text"
                    required
                    value={newCustomerData.postalCode}
                    onChange={(e) => setNewCustomerData({ ...newCustomerData, postalCode: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Stadt *
                  </label>
                  <input
                    type="text"
                    required
                    value={newCustomerData.city}
                    onChange={(e) => setNewCustomerData({ ...newCustomerData, city: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Land *
                </label>
                <input
                  type="text"
                  required
                  value={newCustomerData.country}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, country: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  USt-IdNr.
                </label>
                <input
                  type="text"
                  value={newCustomerData.taxId}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, taxId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Telefon
                </label>
                <input
                  type="tel"
                  value={newCustomerData.phone}
                  onChange={(e) => setNewCustomerData({ ...newCustomerData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                />
              </div>
              <div className="form-action-bar pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-primary-custom text-white py-2 px-4 rounded-lg hover:bg-primary-custom/90 transition-colors"
                >
                  {terminology.entity.createLabel}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCustomerForm(false)}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-400 transition-colors"
                >
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invoice Template Form Modal */}
      {showInvoiceTemplateForm && (
        <DialogShell
          titleId="invoice-template-dialog-title"
          icon={Edit}
          title={editingInvoiceTemplate ? 'Rechnungsvorlage bearbeiten' : 'Neue Rechnungsvorlage erstellen'}
          description="Pflegen Sie Name, Preis, Einheit und steuerliche Zuordnung der Vorlage."
          onClose={closeInvoiceTemplateForm}
          size="md"
          zIndexClassName="z-[1000]"
        >
            <form onSubmit={async (e) => {
              e.preventDefault();
              
              if (!newInvoiceTemplateData.name || newInvoiceTemplateData.unitPrice <= 0) {
                notify({ variant: 'warning', message: 'Bitte geben Sie mindestens einen Namen und einen gültigen Preis ein.' });
                return;
              }

              // Check for duplicate names
              const templates = getInvoiceTemplates() || [];
              const existingTemplate = templates.find((t) =>
                t.id !== editingInvoiceTemplate?.id &&
                t.name.toLowerCase().replace(/\s+/g, '') === newInvoiceTemplateData.name.toLowerCase().replace(/\s+/g, '')
              );

              if (existingTemplate) {
                notify({ variant: 'warning', message: `Eine Rechnungsvorlage mit dem Namen "${newInvoiceTemplateData.name}" existiert bereits. Bitte wählen Sie einen anderen Namen.` });
                return;
              }

              try {
                if (editingInvoiceTemplate) {
                  await updateInvoiceTemplate(editingInvoiceTemplate.id, newInvoiceTemplateData);
                } else {
                  await addInvoiceTemplate(newInvoiceTemplateData);
                }
                
                // Reset form
                setNewInvoiceTemplateData({
                  name: '',
                  description: '',
                  unitPrice: 0,
                  unit: 'Stunde',
                  taxRate: 19,
                  isDefault: false
                });
                setEditingInvoiceTemplate(null);
                setShowInvoiceTemplateForm(false);
              } catch (error) {
                console.error('Error saving invoice template:', error);
                notify({ variant: 'error', message: 'Fehler beim Speichern der Rechnungsvorlage. Bitte versuchen Sie es erneut.' });
              }
            }} className="space-y-5 pb-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={newInvoiceTemplateData.name}
                  onChange={(e) => setNewInvoiceTemplateData({ ...newInvoiceTemplateData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  placeholder="z.B. Beratung, Analyse, Konzeption..."
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Beschreibung
                </label>
                <textarea
                  value={newInvoiceTemplateData.description}
                  onChange={(e) => setNewInvoiceTemplateData({ ...newInvoiceTemplateData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  placeholder="Optionale Beschreibung..."
                  rows={2}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Preis ({currencySymbol}) *
                  </label>
                  <LocalizedNumberInput
                    step="0.01"
                    min="0"
                    value={newInvoiceTemplateData.unitPrice}
                    locale={company.locale}
                    numberFormat={company.numberFormat}
                    onValueChange={(value) => setNewInvoiceTemplateData({ ...newInvoiceTemplateData, unitPrice: value === '' ? 0 : value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                    placeholder="0.00"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Einheit *
                  </label>
                  <input
                    type="text"
                    value={newInvoiceTemplateData.unit}
                    onChange={(e) => setNewInvoiceTemplateData({ ...newInvoiceTemplateData, unit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                    placeholder="z.B. Stunde, Tag, Projekt..."
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  MwSt.-Satz (%) *
                </label>
                <select
                  value={newInvoiceTemplateData.taxRate}
                  onChange={(e) => setNewInvoiceTemplateData({ ...newInvoiceTemplateData, taxRate: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
                  required
                >
                  <option value={0}>0% (Steuerbefreit)</option>
                  <option value={7}>7% (Ermäßigter Satz)</option>
                  <option value={19}>19% (Standard-Satz)</option>
                </select>
              </div>
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="invoiceTemplateDefault"
                  checked={newInvoiceTemplateData.isDefault}
                  onChange={(e) => setNewInvoiceTemplateData({ ...newInvoiceTemplateData, isDefault: e.target.checked })}
                  className="h-4 w-4 text-primary-custom border-gray-300 focus:ring-primary-custom rounded"
                />
                <label htmlFor="invoiceTemplateDefault" className="ml-2 text-sm text-gray-700">
                  Als Standard-Vorlage markieren
                </label>
              </div>
              
              <div className="form-action-bar pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-primary-custom text-white py-2 px-4 rounded-lg hover:bg-primary-custom/90 transition-colors"
                >
                  {editingInvoiceTemplate ? 'Änderungen speichern' : 'Vorlage erstellen'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeInvoiceTemplateForm();
                  }}
                  className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Abbrechen
                </button>
              </div>
            </form>
        </DialogShell>
      )}

      {/* Invoice Template Manager Modal */}
      {showInvoiceTemplateManager && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">Rechnungsvorlagen verwalten</h3>
              <button
                onClick={() => setShowInvoiceTemplateManager(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="p-6">
              <div className="mb-4">
                <button
                  onClick={() => {
                    setEditingInvoiceTemplate(null);
                    setNewInvoiceTemplateData({
                      name: '',
                      description: '',
                      unitPrice: 0,
                      unit: 'Stunde',
                      taxRate: 19,
                      isDefault: false
                    });
                    setShowInvoiceTemplateManager(false);
                    setShowInvoiceTemplateForm(true);
                  }}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center space-x-2 hover:bg-blue-700 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>Neue Vorlage erstellen</span>
                </button>
              </div>
              
              <div className="grid gap-4">
                {getInvoiceTemplates().map((template) => (
                  <div key={template.id} className="border border-gray-200 rounded-lg p-4 flex justify-between items-center">
                    <div>
                      <h4 className="font-medium text-gray-900">{template.name}</h4>
                      <p className="text-sm text-gray-600">{template.description}</p>
                      <p className="text-sm text-gray-500">
                        {formatMoney(Number(template.unitPrice) || 0)}/{template.unit} • {template.taxRate}% MwSt.
                        {template.isDefault && <span className="ml-2 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">Standard</span>}
                      </p>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => {
                          setEditingInvoiceTemplate(template);
                          setNewInvoiceTemplateData({
                            name: template.name,
                            description: template.description || '',
                            unitPrice: Number(template.unitPrice) || 0,
                            unit: template.unit,
                            taxRate: Number(template.taxRate) || 0,
                            isDefault: template.isDefault || false
                          });
                          setShowInvoiceTemplateManager(false);
                          setShowInvoiceTemplateForm(true);
                        }}
                        className="text-blue-600 hover:text-blue-800 p-2 rounded-lg hover:bg-blue-50 transition-colors"
                        title="Bearbeiten"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={async () => {
                          const confirmed = await confirm({
                            title: 'Rechnungsvorlage löschen',
                            message: `Möchten Sie die Vorlage „${template.name}“ wirklich löschen?`,
                            confirmText: 'Löschen',
                            isDestructive: true,
                          });
                          if (!confirmed) return;
                          try {
                            await deleteInvoiceTemplate(template.id);
                          } catch (error) {
                            logger.error('Error deleting template:', error);
                            notify({ variant: 'error', message: 'Fehler beim Löschen der Vorlage.' });
                          }
                        }}
                        className="text-red-600 hover:text-red-800 p-2 rounded-lg hover:bg-red-50 transition-colors"
                        title="Löschen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
                
                {getInvoiceTemplates().length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <p>Noch keine Rechnungsvorlagen erstellt.</p>
                    <p>Klicken Sie auf "Neue Vorlage erstellen" um zu beginnen.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Document Preview Modal */}
      <DocumentPreview
        isOpen={documentPreview.isOpen}
        onClose={handleClosePreview}
        documents={documentPreview.documents}
        initialIndex={documentPreview.initialIndex}
      />

      {/* Rates and Materials Redirect Modal */}
      <RatesAndMaterialsRedirectModal
        isOpen={showRatesRedirectModal.isOpen}
        onClose={() => setShowRatesRedirectModal({ isOpen: false, type: 'hourlyRates' })}
        onNavigateToCustomers={() => onNavigateToCustomers && onNavigateToCustomers()}
        onNavigateToSettings={() => onNavigateToSettings && onNavigateToSettings()}
        type={showRatesRedirectModal.type}
      />
    </div>
  );
}
