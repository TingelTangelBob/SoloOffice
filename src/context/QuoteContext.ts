import { createContext, useContext } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Quote } from '../types';

export interface QuoteContextType {
  quotes: Quote[];
  setQuotes: Dispatch<SetStateAction<Quote[]>>;
  addQuote: (quote: Omit<Quote, 'id' | 'createdAt'>) => Promise<Quote>;
  updateQuote: (id: string, quote: Partial<Quote>) => Promise<void>;
  deleteQuote: (id: string) => Promise<void>;
  refreshQuotes: () => Promise<void>;
  getQuoteById: (id: string) => Quote | undefined;
}

export const QuoteContext = createContext<QuoteContextType | undefined>(undefined);

export function useQuotes(): QuoteContextType {
  const context = useContext(QuoteContext);
  if (context === undefined) {
    throw new Error('useQuotes must be used within a QuoteProvider');
  }
  return context;
}
