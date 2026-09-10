export interface MoneyItem {
  description?: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
  discountType?: 'percentage' | 'fixed' | null;
  discountValue?: number | null;
  discountAmount?: number | null;
  total?: number;
}
export interface MoneyDocument {
  items: MoneyItem[];
  documentType?: 'invoice' | 'credit_note';
  globalDiscountType?: 'percentage' | 'fixed' | null;
  globalDiscountValue?: number | null;
  globalDiscountAmount?: number | null;
}
export function calculateDocumentMoney(data: MoneyDocument, options?: {
  documentType?: 'invoice' | 'credit_note' | 'quote';
  allowIncomplete?: boolean;
}): {
  items: Array<MoneyItem & { description: string; taxRate: number; total: number; discountAmount: number }>;
  subtotal: number;
  itemDiscountAmount: number;
  globalDiscountType: 'percentage' | 'fixed' | null;
  globalDiscountValue: number | null;
  globalDiscountAmount: number;
  totalDiscountAmount: number;
  discountedSubtotal: number;
  taxAmount: number;
  total: number;
  taxBreakdown: Record<number, { taxableAmount: number; taxAmount: number }>;
};
